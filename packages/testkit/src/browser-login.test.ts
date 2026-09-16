import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FakeSandboxProvider } from "@rakazo/adapters";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeIntegration = hasDb ? describe : describe.skip;

const ORIGIN = "https://auth.example.test";
const PASSWORD = "unlikely-plaintext-2f9a41";

describeIntegration("browser sign-in fills the page without the model seeing values", () => {
  let handles: Awaited<ReturnType<typeof import("../../../apps/api/src/app.ts")["createApp"]>>;
  const dataDir = mkdtempSync(path.join(tmpdir(), "rakazo-browser-login-"));
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    const { createApp } = await import("../../../apps/api/src/app.ts");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      defaultProvider: "scripted",
      defaultModel: "scripted",
    });
  });
  afterAll(async () => {
    await handles?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("asks once, fills the page, saves, then reuses the saved credential", async () => {
    const sandbox = handles.sandbox as unknown as FakeSandboxProvider;
    sandbox.pageOrigin = ORIGIN;
    sandbox.filledLogins.length = 0;

    const cookie = await signup(handles.app, `browser-login-${stamp}@rakazo.test`, "Login");
    const bot = await rpc<{ id: string }>(handles.app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: true,
    });

    // The scripted runtime asks for a sign-in on the page it has open.
    await rpc(handles.app, cookie, "threads/send", {
      botId: bot.id,
      text: "sign in to the portal",
    });
    const pending = await waitForLoginSheet(handles.app, cookie, bot.id);
    expect(pending.block.origin).toBe(ORIGIN);
    expect(pending.block.fields.map((field) => field.id)).toContain("password");

    const filled = await rpc<{ filled: string[]; saved: boolean }>(
      handles.app,
      cookie,
      "computer/fillLogin",
      {
        botId: bot.id,
        runId: pending.runId,
        messageId: pending.messageId,
        values: { username: "teacher", password: PASSWORD },
        save: true,
      },
    );
    expect(filled.saved).toBe(true);
    expect(filled.filled).toContain("password");

    // The value reached the page, and only the page.
    expect(sandbox.filledLogins.at(-1)).toMatchObject({
      origin: ORIGIN,
      values: { password: PASSWORD },
    });
    const transcript = await rpc<{ messages: unknown[] }>(handles.app, cookie, "threads/get", {
      botId: bot.id,
    });
    expect(JSON.stringify(transcript.messages)).not.toContain(PASSWORD);

    // A second request signs in from the saved credential with no new sheet. Wait for the
    // first run to finish: a message sent mid-run steers that run instead of starting one.
    await waitFor(async () => {
      const snapshot = await rpc<{ run?: { status: string } | null }>(
        handles.app,
        cookie,
        "threads/get",
        { botId: bot.id },
      );
      expect(["completed", "failed", "cancelled", undefined]).toContain(snapshot.run?.status);
    });
    sandbox.filledLogins.length = 0;
    await rpc(handles.app, cookie, "threads/send", {
      botId: bot.id,
      text: "sign in to the portal once more",
    });
    await waitFor(async () => {
      expect(sandbox.filledLogins.at(-1)?.values.password).toBe(PASSWORD);
    });
    const saved = await rpc<Array<{ origin: string }>>(
      handles.app,
      cookie,
      "computer/savedLogins",
      {
        botId: bot.id,
      },
    );
    expect(saved.map((row) => row.origin)).toContain(ORIGIN);
  });

  it("refuses to fill once the page has left the origin the user was shown", async () => {
    const sandbox = handles.sandbox as unknown as FakeSandboxProvider;
    sandbox.pageOrigin = ORIGIN;
    sandbox.filledLogins.length = 0;
    const cookie = await signup(handles.app, `browser-login-nav-${stamp}@rakazo.test`, "Nav");
    const bot = await rpc<{ id: string }>(handles.app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: true,
    });
    await rpc(handles.app, cookie, "threads/send", {
      botId: bot.id,
      text: "sign in to the portal",
    });
    const pending = await waitForLoginSheet(handles.app, cookie, bot.id);

    sandbox.pageOrigin = "https://elsewhere.example.test";
    const response = await request(handles.app, cookie, "computer/fillLogin", {
      botId: bot.id,
      runId: pending.runId,
      messageId: pending.messageId,
      values: { username: "teacher", password: PASSWORD },
      save: false,
    });
    expect(response.ok).toBe(false);
    expect(sandbox.filledLogins.some((entry) => entry.values.password === PASSWORD)).toBe(false);
  });
});

type LoginBlock = {
  kind: "browser_login";
  origin: string;
  fields: Array<{ id: string }>;
  status?: string;
};

async function waitForLoginSheet(
  app: { request: (path: string, init: RequestInit) => Promise<Response> },
  cookie: string,
  botId: string,
): Promise<{ runId: string; messageId: string; block: LoginBlock }> {
  let found: { runId: string; messageId: string; block: LoginBlock } | undefined;
  await waitFor(async () => {
    const snapshot = await rpc<{
      messages: Array<{ id: string; runId?: string | null; blocks: Array<{ kind: string }> }>;
    }>(app, cookie, "threads/get", { botId });
    for (const message of snapshot.messages) {
      const block = message.blocks.find(
        (entry) => entry.kind === "browser_login" && (entry as LoginBlock).status !== "filled",
      );
      if (block && message.runId) {
        found = { runId: message.runId, messageId: message.id, block: block as LoginBlock };
        return;
      }
    }
    throw new Error("sign-in sheet not shown yet");
  });
  return found!;
}

async function waitFor(check: () => Promise<void>, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      await check();
      return;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw last ?? new Error("timeout");
}

async function signup(
  app: { request: (path: string, init: RequestInit) => Promise<Response> },
  email: string,
  name: string,
): Promise<string> {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ email, password: "password12", name }),
  });
  const match = (response.headers.get("set-cookie") ?? "").match(
    /better-auth\.session_token=([^;]+)/,
  );
  if (!match) throw new Error(`signup failed: ${response.status}`);
  return `better-auth.session_token=${match[1]}`;
}

async function request(
  app: { request: (path: string, init: RequestInit) => Promise<Response> },
  cookie: string,
  route: string,
  body: unknown,
): Promise<{ ok: boolean; payload: { json?: unknown; error?: { message?: string } } }> {
  const response = await app.request(`/rpc/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173", cookie },
    body: JSON.stringify({ json: body }),
  });
  const payload = (await response.json()) as { json?: unknown; error?: { message?: string } };
  return { ok: response.ok && !payload.error, payload };
}

async function rpc<T>(
  app: { request: (path: string, init: RequestInit) => Promise<Response> },
  cookie: string,
  route: string,
  body: unknown = {},
): Promise<T> {
  const result = await request(app, cookie, route, body);
  if (!result.ok) {
    throw new Error(result.payload.error?.message ?? `${route} failed`);
  }
  return result.payload.json as T;
}
