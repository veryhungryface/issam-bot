import { randomBytes } from "node:crypto";
import { BotSecretDestination, SecretHttpRequest } from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "@rakazo/db";
import { combineSignals, redactConnectorPayload } from "./connector-safety.js";
import { createSafeRemoteFetch, type RemoteTransportDependencies } from "./remote-mcp.js";
import type { EncryptedSecretStore } from "./secrets.js";
import { readBodyCapped, withAbort } from "./web-ssrf.js";

export type BotSecretScope = { userId: string; spaceId: string; botId: string };
function scopeFields({ userId, spaceId, botId }: BotSecretScope): BotSecretScope {
  return { userId, spaceId, botId };
}

const metadata = { name: true, origin: true, auth: true, updatedAt: true } as const;

function credentialHeader(destination: BotSecretDestination, plaintext: string) {
  if (destination.auth.type === "browser_login") {
    // A sign-in form credential is only ever typed into the bot's own page. Refusing here
    // keeps it out of secret_request, which would otherwise ship it to the site as a header.
    throw new Error("Browser sign-in credentials cannot be sent as an HTTP header");
  }
  const name = destination.auth.type === "header" ? destination.auth.name : "Authorization";
  const value =
    destination.auth.type === "bearer"
      ? `Bearer ${plaintext}`
      : destination.auth.type === "basic"
        ? `Basic ${Buffer.from(`${destination.auth.username}:${plaintext}`).toString("base64")}`
        : plaintext;
  try {
    const headers = new Headers({ [name]: value });
    if (headers.get(name) !== value) throw new Error("Header value was normalized");
  } catch {
    throw new Error("Credential cannot be used with this authentication method");
  }
  return { name, value };
}

export function normalizeSecretDestination(value: unknown): BotSecretDestination {
  const destination = BotSecretDestination.parse(value);
  return { ...destination, origin: new URL(destination.origin).origin };
}

export function sameSecretDestination(
  left: BotSecretDestination,
  right: BotSecretDestination,
): boolean {
  return (
    left.name === right.name &&
    left.origin === right.origin &&
    JSON.stringify(left.auth) === JSON.stringify(right.auth)
  );
}

export async function findBotSecret(prisma: PrismaClient, scope: BotSecretScope, name: string) {
  const row = await prisma.botSecret.findFirst({
    where: { ...scopeFields(scope), name },
    select: metadata,
  });
  return row ? normalizeSecretDestination(row) : null;
}

export async function storeBotSecret(input: {
  tx: Prisma.TransactionClient;
  secretStore: EncryptedSecretStore;
  scope: BotSecretScope;
  destination: BotSecretDestination;
  plaintext: string;
}): Promise<void> {
  const { tx, secretStore, scope, plaintext } = input;
  if (!plaintext || plaintext.length > 16_384) throw new Error("Invalid credential length");
  const destination = normalizeSecretDestination(input.destination);
  // Header round-trip validation only applies to credentials that become HTTP auth.
  if (destination.auth.type !== "browser_login") credentialHeader(destination, plaintext);
  // Serialize credential updates and deletions for a bot, including concurrent first saves.
  await tx.$queryRaw`SELECT id FROM bots WHERE id = ${scope.botId} FOR UPDATE`;
  const existing = await tx.botSecret.findFirst({
    where: { ...scopeFields(scope), name: destination.name },
  });
  if (existing && !sameSecretDestination(normalizeSecretDestination(existing), destination)) {
    throw new Error("Remove the existing credential before changing its destination");
  }
  if (!existing && (await tx.botSecret.count({ where: scopeFields(scope) })) >= 100) {
    throw new Error("Credential limit reached");
  }
  const id = existing?.id ?? randomBytes(12).toString("hex");
  const encrypted = await secretStore.put(
    plaintext,
    {
      operationId: id,
      traceId: id,
      userId: scope.userId,
      spaceId: scope.spaceId,
      signal: new AbortController().signal,
    },
    id,
  );
  if (existing) {
    await tx.botSecret.update({ where: { id }, data: { ciphertext: encrypted.ciphertext } });
  } else {
    await tx.botSecret.create({
      data: { id, ...scopeFields(scope), ...destination, ciphertext: encrypted.ciphertext },
    });
  }
}

/** Field values for one saved sign-in form, encrypted as a single record. */
export const BROWSER_LOGIN_SECRET_VERSION = 1;

export function serializeBrowserLogin(values: Record<string, string>): string {
  return JSON.stringify({ v: BROWSER_LOGIN_SECRET_VERSION, values });
}

export function parseBrowserLogin(plaintext: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(plaintext) as { v?: number; values?: Record<string, unknown> };
    if (parsed?.v !== BROWSER_LOGIN_SECRET_VERSION || !parsed.values) return null;
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.values)) {
      if (typeof value !== "string") return null;
      values[key] = value;
    }
    return values;
  } catch {
    return null;
  }
}

/** Deterministic credential name so one origin reuses one saved sign-in per bot. */
export function browserLoginSecretName(origin: string): string {
  const host = (() => {
    try {
      return new URL(origin).hostname;
    } catch {
      return origin;
    }
  })();
  const slug = host
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `login_${slug}`.slice(0, 64);
}

/** Find a saved sign-in for this origin, if the user kept one for this bot. */
export async function findBrowserLogin(
  prisma: PrismaClient,
  scope: BotSecretScope,
  origin: string,
): Promise<{ id: string; ciphertext: string } | null> {
  const row = await prisma.botSecret.findFirst({
    where: { ...scopeFields(scope), name: browserLoginSecretName(origin), origin },
    select: { id: true, ciphertext: true, auth: true },
  });
  if (!row) return null;
  const auth = row.auth as { type?: string } | null;
  if (auth?.type !== "browser_login") return null;
  return { id: row.id, ciphertext: row.ciphertext };
}

export function listBotSecrets(prisma: PrismaClient, scope: BotSecretScope) {
  return prisma.botSecret.findMany({
    where: scopeFields(scope),
    select: metadata,
    orderBy: { name: "asc" },
    take: 100,
  });
}

export async function forgetBotSecret(prisma: PrismaClient, scope: BotSecretScope, name: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bots WHERE id = ${scope.botId} FOR UPDATE`;
    await tx.botSecret.deleteMany({ where: { ...scopeFields(scope), name } });
  });
  return { removed: true };
}

/** Credentials are resolved only inside this destination-bound HTTP boundary. */
export async function requestWithBotSecret(input: {
  prisma: PrismaClient;
  secretStore: EncryptedSecretStore;
  scope: BotSecretScope;
  request: unknown;
  signal: AbortSignal;
  remote?: RemoteTransportDependencies;
  registerRedactions?: (values: string[]) => void;
}): Promise<unknown> {
  const request = SecretHttpRequest.parse(input.request);
  const row = await input.prisma.botSecret.findFirst({
    where: { ...scopeFields(input.scope), name: request.name },
  });
  if (!row) return { error: "Credential is unavailable. Use request_secret to save it first." };
  const destination = normalizeSecretDestination(row);
  const url = new URL(request.url);
  if (url.origin !== destination.origin || url.username || url.password || url.hash) {
    return { error: "This credential cannot be sent to that destination." };
  }
  const plaintext = input.secretStore.load(row.ciphertext, row.id);
  const headers = new Headers({ accept: "application/json", "content-type": request.contentType });
  const { name: headerName, value: headerValue } = credentialHeader(destination, plaintext);
  const redactions = [
    ...new Set([
      plaintext,
      headerValue,
      Buffer.from(plaintext).toString("base64"),
      encodeURIComponent(plaintext),
      headerValue.replace(/^Basic /, ""),
    ]),
  ].filter(Boolean);
  input.registerRedactions?.(redactions);
  const controller = new AbortController();
  const signal = combineSignals(input.signal, controller.signal, AbortSignal.timeout(30_000));
  const fetch = createSafeRemoteFetch(input.remote?.fetch, input.remote?.resolveHostname);
  try {
    headers.set(headerName, headerValue);
    const response = await withAbort(
      fetch(url, { method: request.method, headers, body: request.body, signal }),
      signal,
    );
    const bytes = await readBodyCapped(response, 1_000_000, signal);
    const text = new TextDecoder().decode(bytes);
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* Plain text responses are supported. */
    }
    // Redact before truncating, so an output boundary cannot expose part of a value.
    const safe = JSON.stringify(redactConnectorPayload(body, redactions));
    return {
      status: response.status,
      body: safe.length > 20_000 ? safe.slice(0, 20_000) : JSON.parse(safe),
      truncated: safe.length > 20_000,
    };
  } catch {
    return { error: "Authenticated request failed. Check the destination and credential." };
  } finally {
    controller.abort();
    await withAbort(fetch.close(), AbortSignal.timeout(1000)).catch(() => undefined);
  }
}
