import { createHash, randomBytes } from "node:crypto";
import {
  BROWSER_PAIR_BURST_LIMIT,
  BROWSER_PAIR_ID_BYTES,
  BROWSER_PAIR_TTL_MS,
  BROWSER_PAIR_VERIFIER_BYTES,
  decodeBrowserDevicePairing,
} from "@rakazo/core";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  type BrowserPairDeps,
  claimBrowserPairSession,
  describeBrowserPairSession,
  mountBrowserPairHttpRoutes,
} from "./browser-pair.js";

const WEB_ORIGIN = "https://issam-bot.test";

type SessionRow = {
  id: string;
  challenge: string;
  label: string | null;
  status: string;
  deviceId: string | null;
  ciphertext: string | null;
  claimedById: string | null;
  spaceId: string | null;
  claimedAt: Date | null;
  collectedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
};

type DeviceRow = {
  id: string;
  spaceId: string;
  userId: string;
  name: string;
  secretId: string;
  revokedAt: Date | null;
  createdAt: Date;
};

/**
 * A store rather than per-call stubs.
 *
 * What is worth testing here is a handover between two machines with races in it — two phones
 * on one QR, a retried accept, a decline after the mint. Stubbing each call in turn would let
 * every one of those pass without the handover ever happening.
 */
function createDeps() {
  const sessions = new Map<string, SessionRow>();
  const devices = new Map<string, DeviceRow>();
  const secrets = new Map<string, { id: string; userId: string; spaceId: string; kind: string }>();
  const users = new Map<string, { name: string | null; email: string }>([
    ["user-1", { name: "김선생", email: "teacher@school.test" }],
  ]);

  const matches = (row: SessionRow, where: Record<string, unknown>): boolean => {
    for (const [key, value] of Object.entries(where)) {
      if (key === "id" && row.id !== value) return false;
      if (key === "status" && row.status !== value) return false;
      if (key === "expiresAt") {
        const bound = (value as { lt?: Date }).lt;
        if (bound && !(row.expiresAt < bound)) return false;
      }
      if (key === "createdAt") {
        const bound = (value as { gt?: Date }).gt;
        if (bound && !(row.createdAt > bound)) return false;
      }
    }
    return true;
  };

  const deps = {
    prisma: {
      browserPairSession: {
        create: async ({ data }: { data: Partial<SessionRow> }) => {
          const row: SessionRow = {
            id: data.id as string,
            challenge: data.challenge as string,
            label: data.label ?? null,
            status: data.status ?? "pending",
            deviceId: null,
            ciphertext: null,
            claimedById: null,
            spaceId: null,
            claimedAt: null,
            collectedAt: null,
            expiresAt: data.expiresAt as Date,
            createdAt: new Date(),
          };
          sessions.set(row.id, row);
          return row;
        },
        findUnique: async ({ where }: { where: { id: string } }) => {
          const row = sessions.get(where.id);
          if (!row) return null;
          return {
            ...row,
            claimedBy: row.claimedById ? (users.get(row.claimedById) ?? null) : null,
            device: row.deviceId ? (devices.get(row.deviceId) ?? null) : null,
          };
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<SessionRow>;
        }) => {
          let count = 0;
          for (const row of sessions.values()) {
            if (!matches(row, where)) continue;
            Object.assign(row, data);
            count += 1;
          }
          return { count };
        },
        deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
          let count = 0;
          for (const [id, row] of [...sessions.entries()]) {
            if (!matches(row, where)) continue;
            sessions.delete(id);
            count += 1;
          }
          return { count };
        },
        count: async ({ where }: { where: Record<string, unknown> }) =>
          [...sessions.values()].filter((row) => matches(row, where)).length,
      },
      browserDevice: {
        create: async ({ data }: { data: Omit<DeviceRow, "id" | "revokedAt" | "createdAt"> }) => {
          const row: DeviceRow = {
            ...data,
            id: `device-${devices.size + 1}`,
            revokedAt: null,
            createdAt: new Date(),
          };
          devices.set(row.id, row);
          return row;
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: { id: string; revokedAt: null };
          data: Partial<DeviceRow>;
        }) => {
          const row = devices.get(where.id);
          if (!row || row.revokedAt !== null) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      },
      secret: {
        create: async ({ data }: { data: { id: string } & Record<string, unknown> }) => {
          secrets.set(data.id, data as never);
          return data;
        },
        deleteMany: async ({ where }: { where: { id: string } }) => {
          const existed = secrets.delete(where.id);
          return { count: existed ? 1 : 0 };
        },
      },
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(deps.prisma),
    } as unknown as BrowserPairDeps["prisma"],
    // Sealing is the store's job and is tested there; what matters here is that the record id
    // is part of it, so a ciphertext cannot be read out of the wrong row.
    secrets: {
      put: async (
        plaintext: string,
        _ctx: unknown,
        recordId = randomBytes(12).toString("hex"),
      ) => ({
        id: recordId,
        ciphertext: `${recordId}:${Buffer.from(plaintext).toString("base64")}`,
      }),
      load: (ciphertext: string, recordId: string) => {
        const [id, payload] = ciphertext.split(":");
        if (id !== recordId) throw new Error("wrong record");
        return Buffer.from(payload, "base64").toString("utf8");
      },
    } as unknown as BrowserPairDeps["secrets"],
    webOrigin: WEB_ORIGIN,
  } satisfies BrowserPairDeps;

  const app = new Hono();
  mountBrowserPairHttpRoutes(app, deps);
  return { deps, app, sessions, devices, secrets };
}

type Harness = ReturnType<typeof createDeps>;

function verifierPair() {
  const verifier = randomBytes(BROWSER_PAIR_VERIFIER_BYTES).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function open(app: Harness["app"], body: Record<string, unknown>) {
  const res = await app.request("/api/v1/browser-pair/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function collect(app: Harness["app"], sessionId: string, body: Record<string, unknown>) {
  const res = await app.request(`/api/v1/browser-pair/sessions/${sessionId}/collect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const CLAIM = { spaceId: "ws-1", userId: "user-1", name: "교무실 노트북" };

describe("opening a session", () => {
  it("hands back a url the phone's camera can open", async () => {
    const h = createDeps();
    const { challenge } = verifierPair();
    const { status, json } = await open(h.app, { challenge, label: "교무실 노트북" });
    expect(status).toBe(200);
    expect(json.url).toBe(`${WEB_ORIGIN}/pair/${json.sessionId}`);
    expect(String(json.sessionId)).toHaveLength(Math.ceil((BROWSER_PAIR_ID_BYTES * 4) / 3));
    expect(new Date(json.expiresAt as string).getTime() - Date.now()).toBeLessThanOrEqual(
      BROWSER_PAIR_TTL_MS,
    );
  });

  it("stores the hash and never the verifier", async () => {
    const h = createDeps();
    const { verifier, challenge } = verifierPair();
    const { json } = await open(h.app, { challenge });
    const row = h.sessions.get(json.sessionId as string);
    expect(row?.challenge).toBe(challenge);
    expect(JSON.stringify([...h.sessions.values()])).not.toContain(verifier);
  });

  it("refuses anything that is not a digest", async () => {
    const h = createDeps();
    expect((await open(h.app, { challenge: "nope" })).status).toBe(400);
    expect((await open(h.app, {})).status).toBe(400);
  });

  it("refuses a flood", async () => {
    const h = createDeps();
    for (let i = 0; i < BROWSER_PAIR_BURST_LIMIT; i += 1) {
      expect((await open(h.app, { challenge: verifierPair().challenge })).status).toBe(200);
    }
    expect((await open(h.app, { challenge: verifierPair().challenge })).status).toBe(429);
  });
});

describe("the round trip", () => {
  it("carries the pairing from the phone to the computer that drew the QR", async () => {
    const h = createDeps();
    const { verifier, challenge } = verifierPair();
    const { json: opened } = await open(h.app, { challenge, label: "교무실 노트북" });
    const sessionId = opened.sessionId as string;

    // The phone sees the label the teacher typed on the computer, so it needs no typing.
    expect(await describeBrowserPairSession(h.deps, { sessionId })).toEqual({
      status: "pending",
      label: "교무실 노트북",
    });

    // Nothing to collect yet, and the computer is told exactly that rather than an error.
    expect((await collect(h.app, sessionId, { verifier })).json).toEqual({ status: "pending" });

    const claimed = await claimBrowserPairSession(h.deps, { sessionId, ...CLAIM });
    expect(claimed).toMatchObject({ ok: true, deviceName: "교무실 노트북" });

    // Phase one: who scanned it. No pairing yet — the person at the keyboard has not agreed.
    const offered = await collect(h.app, sessionId, { verifier });
    expect(offered.json).toEqual({
      status: "claimed",
      deviceName: "교무실 노트북",
      claimedBy: { name: "김선생", email: "teacher@school.test" },
    });
    expect(JSON.stringify(offered.json)).not.toContain("issam1.");

    // Phase two: yes.
    const accepted = await collect(h.app, sessionId, { verifier, accept: true });
    expect(accepted.json.status).toBe("ready");
    const pairing = decodeBrowserDevicePairing(accepted.json.code);
    expect(pairing).toMatchObject({ apiBase: WEB_ORIGIN });
    expect(h.devices.get(pairing?.deviceId ?? "")?.revokedAt).toBeNull();

    // And once only: a retried accept must not hand the same pairing out twice.
    expect((await collect(h.app, sessionId, { verifier, accept: true })).json).toEqual({
      status: "used",
    });
    expect(h.sessions.get(sessionId)?.ciphertext).toBeNull();
  });

  it("kills the token when the person at the keyboard says no", async () => {
    const h = createDeps();
    const { verifier, challenge } = verifierPair();
    const { json: opened } = await open(h.app, { challenge });
    const sessionId = opened.sessionId as string;
    const claimed = await claimBrowserPairSession(h.deps, { sessionId, ...CLAIM });
    if (!claimed.ok) throw new Error("claim failed");

    expect((await collect(h.app, sessionId, { verifier, accept: false })).json).toEqual({
      status: "declined",
    });
    // A scan the teacher refused must not leave a live token behind for anyone to use.
    expect(h.devices.get(claimed.deviceId)?.revokedAt).toBeInstanceOf(Date);
    expect([...h.secrets.keys()]).toEqual([]);
    expect(h.sessions.get(sessionId)?.ciphertext).toBeNull();
  });

  it("lets only the second phone lose, and takes its token back with it", async () => {
    const h = createDeps();
    const { challenge } = verifierPair();
    const { json: opened } = await open(h.app, { challenge });
    const sessionId = opened.sessionId as string;

    const first = await claimBrowserPairSession(h.deps, { sessionId, ...CLAIM });
    const second = await claimBrowserPairSession(h.deps, { sessionId, ...CLAIM });
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "taken" });
    // The loser minted a device before it found out. It must not stay alive.
    const alive = [...h.devices.values()].filter((device) => device.revokedAt === null);
    expect(alive).toHaveLength(1);
    expect(h.secrets.size).toBe(1);
  });
});

describe("what the id alone is worth", () => {
  it("nothing: a photographed QR cannot even tell whether anyone scanned it", async () => {
    const h = createDeps();
    const { challenge } = verifierPair();
    const { json: opened } = await open(h.app, { challenge });
    const sessionId = opened.sessionId as string;
    await claimBrowserPairSession(h.deps, { sessionId, ...CLAIM });

    const stranger = await collect(h.app, sessionId, {
      verifier: randomBytes(BROWSER_PAIR_VERIFIER_BYTES).toString("base64url"),
    });
    expect(stranger.status).toBe(401);
    expect(stranger.json).toEqual({ error: "Unauthorized" });
  });

  it("answers the same 401 for a bad id, an unknown id and a missing verifier", async () => {
    const h = createDeps();
    const unknown = randomBytes(BROWSER_PAIR_ID_BYTES).toString("base64url");
    const verifier = randomBytes(BROWSER_PAIR_VERIFIER_BYTES).toString("base64url");
    for (const call of [
      collect(h.app, "not-an-id", { verifier }),
      collect(h.app, unknown, { verifier }),
      collect(h.app, unknown, {}),
    ]) {
      const { status, json } = await call;
      expect(status).toBe(401);
      expect(json).toEqual({ error: "Unauthorized" });
    }
  });

  it("will not open one row's ciphertext against another row", async () => {
    const h = createDeps();
    const a = verifierPair();
    const b = verifierPair();
    const first = (await open(h.app, { challenge: a.challenge })).json.sessionId as string;
    const second = (await open(h.app, { challenge: b.challenge })).json.sessionId as string;
    await claimBrowserPairSession(h.deps, { sessionId: first, ...CLAIM });

    // Move the sealed pairing to the other session, as a leaked row would let someone do.
    const stolen = h.sessions.get(first)?.ciphertext ?? null;
    const target = h.sessions.get(second);
    if (!target) throw new Error("missing session");
    Object.assign(target, { status: "claimed", ciphertext: stolen, claimedById: "user-1" });

    expect((await collect(h.app, second, { verifier: b.verifier, accept: true })).json).toEqual({
      status: "used",
    });
  });
});

describe("expiry", () => {
  it("tells the computer its QR lapsed, which is not the same as never having existed", async () => {
    const h = createDeps();
    const { verifier, challenge } = verifierPair();
    const sessionId = (await open(h.app, { challenge })).json.sessionId as string;
    const row = h.sessions.get(sessionId);
    if (!row) throw new Error("missing session");
    row.expiresAt = new Date(Date.now() - 1);

    expect((await collect(h.app, sessionId, { verifier })).json).toEqual({ status: "expired" });
    expect(h.sessions.get(sessionId)?.status).toBe("expired");
    expect(await describeBrowserPairSession(h.deps, { sessionId })).toEqual({
      status: "expired",
      label: null,
    });
  });

  it("refuses a claim on a lapsed QR before it mints anything", async () => {
    const h = createDeps();
    const sessionId = (await open(h.app, { challenge: verifierPair().challenge })).json
      .sessionId as string;
    const row = h.sessions.get(sessionId);
    if (!row) throw new Error("missing session");
    row.expiresAt = new Date(Date.now() - 1);

    expect(await claimBrowserPairSession(h.deps, { sessionId, ...CLAIM })).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(h.devices.size).toBe(0);
  });
});
