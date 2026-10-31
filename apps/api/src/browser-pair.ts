/**
 * Pairing a computer by letting a phone scan it.
 *
 * The pasted code is one string that carries the whole pairing, and it works when one screen
 * both mints and reads it. Here the two screens are different: the extension is on the
 * teacher's computer, and the camera that is already signed in is in their hand. So the
 * computer draws a QR and the phone reads it, and the token has to come back the other way.
 *
 * Which makes the QR's contents public. It is on a screen in a staff room, and a photograph of
 * it is not hard to come by. So the id in it buys nothing on its own: the extension keeps a
 * verifier, this server stores only its hash, and the pairing is handed to whoever can present
 * the verifier — the one computer that drew the QR. That is RFC 8628's device flow with PKCE's
 * hash, for RFC 8628's reason.
 *
 * And a scan is not consent. Anyone who can see the screen can scan it, including from an
 * account that is not the teacher's, so the phone minting a device is only half of it: the
 * computer is told who scanned and does not store anything until the person sitting at it says
 * yes. A stranger scanning a QR off a staff-room screen gets as far as a name on the teacher's
 * own screen, and no further.
 */

import { randomBytes } from "node:crypto";
import type { EncryptedSecretStore } from "@rakazo/adapters";
import {
  BROWSER_DEVICE_SECRET_KIND,
  BROWSER_PAIR_BURST_LIMIT,
  BROWSER_PAIR_BURST_WINDOW_MS,
  BROWSER_PAIR_ID_BYTES,
  BROWSER_PAIR_TTL_MS,
  browserPairExpired,
  browserPairUrl,
  encodeBrowserDevicePairing,
  normalizeBrowserDeviceName,
  normalizeBrowserPairChallenge,
  normalizeBrowserPairId,
  normalizeBrowserPairVerifier,
} from "@rakazo/core";
import { browserPairChallenge } from "@rakazo/core/node/browser-pair-challenge";
import type { PrismaClient } from "@rakazo/db";
import type { Hono } from "hono";
import { readBoundedBody } from "./http-body.js";

export const BROWSER_PAIR_MAX_BODY_BYTES = 8 * 1024;

/**
 * How long an expired session is kept.
 *
 * Deleting it the moment it lapses would leave a computer that was slow to poll unable to tell
 * "nobody scanned this in time" from "this id was never real", and those two need different
 * words on screen.
 */
const BROWSER_PAIR_GRAVE_MS = 60 * 60_000;

export type BrowserPairDeps = {
  prisma: PrismaClient;
  secrets: EncryptedSecretStore;
  /** The origin a phone should open, which is the web app's, not this server's. */
  webOrigin: string;
};

/**
 * Mint a device and its token.
 *
 * Shared by the pasted-code path and the scanned-QR path so there is one place where a token
 * comes into existence: the plaintext is returned once, here, and is otherwise only ever the
 * ciphertext in the secrets table.
 */
export async function mintBrowserDevice(
  deps: { prisma: PrismaClient; secrets: EncryptedSecretStore },
  input: { spaceId: string; userId: string; name: string; signal?: AbortSignal },
): Promise<{
  device: { id: string; name: string; createdAt: Date; secretId: string };
  token: string;
}> {
  const plaintext = randomBytes(32).toString("base64url");
  const stored = await deps.secrets.put(plaintext, {
    operationId: "browserDevices.pair",
    traceId: "browserDevices.pair",
    spaceId: input.spaceId,
    userId: input.userId,
    signal: input.signal ?? new AbortController().signal,
  });
  // One transaction: a device row whose secret never landed would answer 401 forever and look
  // like a pairing the teacher simply got wrong.
  const device = await deps.prisma.$transaction(async (tx) => {
    await tx.secret.create({
      data: {
        id: stored.id,
        userId: input.userId,
        spaceId: input.spaceId,
        kind: BROWSER_DEVICE_SECRET_KIND,
        ciphertext: stored.ciphertext,
      },
    });
    return tx.browserDevice.create({
      data: {
        spaceId: input.spaceId,
        userId: input.userId,
        name: input.name,
        secretId: stored.id,
      },
    });
  });
  return { device, token: plaintext };
}

/** Undo a device nobody accepted: the token dies, the row stays out of the way. */
async function revokeMintedDevice(
  deps: { prisma: PrismaClient },
  device: { id: string; secretId: string; spaceId: string; userId: string },
): Promise<void> {
  await deps.prisma.browserDevice.updateMany({
    where: { id: device.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await deps.prisma.secret.deleteMany({
    where: {
      id: device.secretId,
      spaceId: device.spaceId,
      userId: device.userId,
      kind: BROWSER_DEVICE_SECRET_KIND,
    },
  });
}

type SessionRow = {
  id: string;
  challenge: string;
  status: string;
  expiresAt: Date;
  ciphertext: string | null;
  deviceId: string | null;
  claimedBy: { name: string | null; email: string } | null;
  device: { name: string; secretId: string; spaceId: string; userId: string } | null;
};

const SESSION_SELECT = {
  id: true,
  challenge: true,
  status: true,
  expiresAt: true,
  ciphertext: true,
  deviceId: true,
  claimedBy: { select: { name: true, email: true } },
  device: { select: { name: true, secretId: true, spaceId: true, userId: true } },
} as const;

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null | "too-large"> {
  const raw = await readBoundedBody(request, BROWSER_PAIR_MAX_BODY_BYTES);
  if (raw === null) return "too-large";
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * What the phone is shown before it commits.
 *
 * Open to any signed-in teacher, because the id is public by design and there is nothing here
 * worth protecting: a label they typed on their own computer, and whether the QR is still good.
 */
export async function describeBrowserPairSession(
  deps: { prisma: PrismaClient },
  input: { sessionId: string },
  now: Date = new Date(),
): Promise<{ status: "pending" | "claimed" | "used" | "expired"; label: string | null }> {
  const id = normalizeBrowserPairId(input.sessionId);
  // An id that is not even the right shape is not a session that lapsed; say "unknown" by
  // calling it expired, which is the one word that sends the teacher back to the computer.
  if (!id) return { status: "expired", label: null };
  const session = await deps.prisma.browserPairSession.findUnique({
    where: { id },
    select: { status: true, label: true, expiresAt: true },
  });
  if (!session) return { status: "expired", label: null };
  if (session.status === "pending" && browserPairExpired(session, now)) {
    return { status: "expired", label: session.label };
  }
  return {
    status: session.status as "pending" | "claimed" | "used" | "expired",
    label: session.label,
  };
}

/**
 * The phone's half: mint the device, and leave the pairing where only the computer can reach it.
 *
 * The code is sealed under this row's id, so a leaked database row is not a pairing unless the
 * deployment's encryption key leaked with it.
 */
export async function claimBrowserPairSession(
  deps: BrowserPairDeps,
  input: {
    sessionId: string;
    name: string;
    spaceId: string;
    userId: string;
    signal?: AbortSignal;
  },
  now: Date = new Date(),
): Promise<
  | { ok: true; deviceId: string; deviceName: string }
  | { ok: false; reason: "expired" | "taken" | "name" }
> {
  const id = normalizeBrowserPairId(input.sessionId);
  if (!id) return { ok: false, reason: "expired" };
  const name = normalizeBrowserDeviceName(input.name);
  if (!name) return { ok: false, reason: "name" };

  const session = await deps.prisma.browserPairSession.findUnique({
    where: { id },
    select: { id: true, status: true, expiresAt: true },
  });
  if (!session) return { ok: false, reason: "expired" };
  if (session.status !== "pending") return { ok: false, reason: "taken" };
  if (browserPairExpired(session, now)) return { ok: false, reason: "expired" };

  const minted = await mintBrowserDevice(deps, {
    spaceId: input.spaceId,
    userId: input.userId,
    name,
    signal: input.signal,
  });
  const code = encodeBrowserDevicePairing({
    apiBase: deps.webOrigin,
    deviceId: minted.device.id,
    token: minted.token,
  });
  const sealed = await deps.secrets.put(
    code,
    {
      operationId: "browserPair.claim",
      traceId: "browserPair.claim",
      spaceId: input.spaceId,
      userId: input.userId,
      signal: input.signal ?? new AbortController().signal,
    },
    // Sealed under the session id, so a ciphertext lifted into another row will not open.
    id,
  );

  // Claim by id *and* status: two phones racing the same QR must not both mint a device that
  // the computer then has no way to tell apart.
  const claimed = await deps.prisma.browserPairSession.updateMany({
    where: { id, status: "pending" },
    data: {
      status: "claimed",
      claimedAt: now,
      claimedById: input.userId,
      spaceId: input.spaceId,
      deviceId: minted.device.id,
      ciphertext: sealed.ciphertext,
    },
  });
  if (claimed.count === 0) {
    // Another phone got there first. Undo the device this one minted rather than leaving a
    // token alive that no computer will ever collect.
    await revokeMintedDevice(deps, {
      id: minted.device.id,
      secretId: minted.device.secretId,
      spaceId: input.spaceId,
      userId: input.userId,
    });
    return { ok: false, reason: "taken" };
  }

  return { ok: true, deviceId: minted.device.id, deviceName: name };
}

export function mountBrowserPairHttpRoutes(app: Hono, deps: BrowserPairDeps) {
  /**
   * The computer opens a session and gets back what to draw.
   *
   * Unauthenticated, necessarily: a browser that has never been paired has nothing to
   * authenticate with, and this is how it gets something. What it can do with that is bounded
   * instead — the row holds no secret until a signed-in phone puts one there, it lapses in
   * minutes, and a flood of them is refused outright.
   */
  app.post("/api/v1/browser-pair/sessions", async (c) => {
    const body = await readJsonBody(c.req.raw);
    if (body === "too-large") return c.json({ error: "Payload too large" }, 413);
    if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

    const challenge = normalizeBrowserPairChallenge(body.challenge);
    if (!challenge) return c.json({ error: "challenge must be a base64url sha256 digest" }, 400);
    const label = normalizeBrowserDeviceName(body.label);

    const now = new Date();
    await deps.prisma.browserPairSession
      .deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - BROWSER_PAIR_GRAVE_MS) } } })
      .catch(() => undefined);

    const recent = await deps.prisma.browserPairSession.count({
      where: { createdAt: { gt: new Date(now.getTime() - BROWSER_PAIR_BURST_WINDOW_MS) } },
    });
    if (recent >= BROWSER_PAIR_BURST_LIMIT) {
      return c.json({ error: "Too many pairing attempts" }, 429);
    }

    const id = randomBytes(BROWSER_PAIR_ID_BYTES).toString("base64url");
    const expiresAt = new Date(now.getTime() + BROWSER_PAIR_TTL_MS);
    await deps.prisma.browserPairSession.create({ data: { id, challenge, label, expiresAt } });

    return c.json({
      sessionId: id,
      url: browserPairUrl(deps.webOrigin, id),
      expiresAt: expiresAt.toISOString(),
    });
  });

  /**
   * The computer asks what happened, and then says yes or no.
   *
   * Both phases need the verifier, so a photographed QR cannot even learn whether anyone
   * scanned it. The pairing itself only crosses on `accept`, which is the teacher at the
   * keyboard agreeing to the name the previous answer showed them.
   */
  app.post("/api/v1/browser-pair/sessions/:sessionId/collect", async (c) => {
    const body = await readJsonBody(c.req.raw);
    if (body === "too-large") return c.json({ error: "Payload too large" }, 413);
    if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

    const id = normalizeBrowserPairId(c.req.param("sessionId"));
    const verifier = normalizeBrowserPairVerifier(body.verifier);
    // One opaque answer for a bad id, an unknown id and a wrong verifier, so a caller holding
    // one of the three cannot work out which of them it is holding.
    if (!id || !verifier) return c.json({ error: "Unauthorized" }, 401);

    const session: SessionRow | null = await deps.prisma.browserPairSession.findUnique({
      where: { id },
      select: SESSION_SELECT,
    });
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    if (browserPairChallenge(verifier) !== session.challenge) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const now = new Date();
    if (session.status === "pending") {
      if (browserPairExpired(session, now)) {
        await deps.prisma.browserPairSession
          .updateMany({ where: { id, status: "pending" }, data: { status: "expired" } })
          .catch(() => undefined);
        return c.json({ status: "expired" });
      }
      return c.json({ status: "pending" });
    }
    if (session.status !== "claimed") return c.json({ status: session.status });

    const accept = body.accept === true;
    if (!accept && body.accept !== false) {
      // Phase one: who scanned it. Enough for the teacher to recognise their own account, or
      // to see that it is somebody else's and press 거절.
      return c.json({
        status: "claimed",
        deviceName: session.device?.name ?? null,
        claimedBy: {
          name: session.claimedBy?.name ?? null,
          email: session.claimedBy?.email ?? null,
        },
      });
    }

    // Settle by id *and* status so a retried accept cannot hand the same pairing out twice.
    const settled = await deps.prisma.browserPairSession.updateMany({
      where: { id, status: "claimed" },
      data: { status: "used", collectedAt: now, ciphertext: null },
    });
    if (settled.count === 0) return c.json({ status: "used" });

    if (!accept) {
      if (session.device && session.deviceId) {
        await revokeMintedDevice(deps, { ...session.device, id: session.deviceId });
      }
      return c.json({ status: "declined" });
    }

    if (!session.ciphertext) return c.json({ status: "used" });
    let code: string;
    try {
      code = deps.secrets.load(session.ciphertext, id);
    } catch {
      // The row is already settled, so there is no second chance at this one; the teacher draws
      // a new QR. Saying "used" rather than 500 is what sends them back to a working screen.
      return c.json({ status: "used" });
    }
    return c.json({ status: "ready", code, deviceName: session.device?.name ?? null });
  });
}
