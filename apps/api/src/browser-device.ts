import type { JobPublisher } from "@rakazo/adapter-kit";
import { runContinueJob } from "@rakazo/adapter-kit";
import type { EncryptedSecretStore } from "@rakazo/adapters";
import { browserJobReport, expireStaleBrowserJobs } from "@rakazo/adapters";
import {
  BROWSER_DEVICE_SECRET_KIND,
  browserJobHasExpired,
  hasValidBearerToken,
  isBrowserJobReportableStatus,
} from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import type { Hono } from "hono";
import { readBoundedBody } from "./http-body.js";

/**
 * The endpoints the browser extension talks to.
 *
 * Outside oRPC, like the webhook routes and for the same reason: the caller is not a signed
 * in browser tab, it is a device holding a bearer token. The token is minted once at
 * pairing, stored encrypted, and is the only thing standing between the internet and a
 * teacher's logged-in Chrome — so every failure here answers the same opaque 401, and a
 * device may only ever see its own queue.
 *
 * The extension polls. There is no push: a Chrome extension cannot be connected to, and
 * its MV3 service worker is killed after seconds of idle, so anything long-lived would be
 * a lie. Polling is what the extension already does and what survives a sleeping laptop.
 */

export const BROWSER_DEVICE_MAX_BODY_BYTES = 64 * 1024;

export type BrowserDeviceEvents = {
  sendUserMessage(input: {
    spaceId: string;
    threadId: string;
    botId: string;
    userId: string;
    blocks: Array<{ kind: "text"; text: string }>;
    prompt: string;
    trigger: "browser_device";
  }): Promise<{ messageId: string; runId: string | null; seq: number }>;
};

export type BrowserDeviceDeps = {
  prisma: PrismaClient;
  secrets: EncryptedSecretStore;
  events: BrowserDeviceEvents;
  jobs: JobPublisher;
};

export function browserDeviceClaimPath(deviceId: string): string {
  return `/api/v1/browser-devices/${deviceId}/claim`;
}

type AuthedDevice = {
  id: string;
  spaceId: string;
  userId: string;
  name: string;
};

/**
 * Resolve the device behind a bearer token, or nothing.
 *
 * Returns the same nothing for an unknown id, a revoked device, a secret of the wrong kind
 * and a bad token, so a caller holding one valid token cannot probe for which device ids
 * exist by watching the responses differ.
 */
async function authenticate(
  deps: BrowserDeviceDeps,
  deviceId: string | undefined,
  authorization: string | undefined,
): Promise<AuthedDevice | null> {
  if (!deviceId) return null;
  const device = await deps.prisma.browserDevice.findFirst({
    where: { id: deviceId, revokedAt: null },
    select: { id: true, spaceId: true, userId: true, name: true, secretId: true },
  });
  if (!device) return null;

  const secret = await deps.prisma.secret.findUnique({
    where: { id: device.secretId },
    select: { id: true, ciphertext: true, kind: true, userId: true, spaceId: true },
  });
  if (!secret || secret.kind !== BROWSER_DEVICE_SECRET_KIND) return null;
  if (secret.userId !== device.userId || secret.spaceId !== device.spaceId) return null;

  let expected: string;
  try {
    expected = deps.secrets.load(secret.ciphertext, secret.id);
  } catch {
    return null;
  }
  if (!hasValidBearerToken(authorization, expected)) return null;

  return { id: device.id, spaceId: device.spaceId, userId: device.userId, name: device.name };
}

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null | "too-large"> {
  const raw = await readBoundedBody(request, BROWSER_DEVICE_MAX_BODY_BYTES);
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

export function mountBrowserDeviceHttpRoutes(app: Hono, deps: BrowserDeviceDeps) {
  const logger = getLogger();

  const touch = (deviceId: string) =>
    deps.prisma.browserDevice
      .update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);

  /**
   * "Anything for me?" — and the only thing that marks a device reachable.
   *
   * The bot refuses to hand work to a device that has not polled recently, so this call is
   * both the question and the answer to it.
   */
  app.post("/api/v1/browser-devices/:deviceId/claim", async (c) => {
    const device = await authenticate(deps, c.req.param("deviceId"), c.req.header("authorization"));
    if (!device) return c.json({ error: "Unauthorized" }, 401);
    await touch(device.id);
    await expireStaleBrowserJobs(deps).catch(() => 0);

    const now = new Date();
    const queued = await deps.prisma.browserJob.findFirst({
      where: { deviceId: device.id, spaceId: device.spaceId, status: "queued" },
      select: { id: true, prompt: true, createdAt: true, status: true, claimedAt: true },
      orderBy: { createdAt: "asc" },
    });
    if (!queued || browserJobHasExpired(queued, now)) return c.json({ job: null });

    // Claim by id *and* status so two polls racing cannot both win the same task.
    const claimed = await deps.prisma.browserJob.updateMany({
      where: { id: queued.id, status: "queued" },
      data: { status: "claimed", claimedAt: now },
    });
    if (claimed.count === 0) return c.json({ job: null });

    return c.json({ job: { id: queued.id, prompt: queued.prompt } });
  });

  /** Keeps the device reachable while it is busy and has nothing to claim. */
  app.post("/api/v1/browser-devices/:deviceId/heartbeat", async (c) => {
    const device = await authenticate(deps, c.req.param("deviceId"), c.req.header("authorization"));
    if (!device) return c.json({ error: "Unauthorized" }, 401);
    await touch(device.id);
    return c.json({ ok: true });
  });

  /** What the extension did, and what it saved where. This is what reaches the teacher. */
  app.post("/api/v1/browser-devices/:deviceId/jobs/:jobId/finish", async (c) => {
    const device = await authenticate(deps, c.req.param("deviceId"), c.req.header("authorization"));
    if (!device) return c.json({ error: "Unauthorized" }, 401);
    await touch(device.id);

    const body = await readJsonBody(c.req.raw);
    if (body === "too-large") return c.json({ error: "Payload too large" }, 413);
    if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

    const status = body.status;
    if (!isBrowserJobReportableStatus(status)) {
      return c.json({ error: "status must be done or error" }, 400);
    }

    const job = await deps.prisma.browserJob.findFirst({
      // Scoped to the device as well as the id: a token may only ever finish its own work.
      where: { id: c.req.param("jobId"), deviceId: device.id, spaceId: device.spaceId },
      select: { id: true, status: true, botId: true, threadId: true, userId: true },
    });
    if (!job) return c.json({ error: "Unauthorized" }, 401);
    if (job.status !== "claimed") {
      // Already reported, or swept while the machine was quiet. Accept without a second
      // message: a retrying extension must not post the same result into the chat twice.
      return c.json({ ok: true, duplicate: true });
    }

    const report = browserJobReport({
      deviceName: device.name,
      status,
      result: body.result,
    });

    const settled = await deps.prisma.browserJob.updateMany({
      where: { id: job.id, status: "claimed" },
      data: { status, result: report, finishedAt: new Date() },
    });
    if (settled.count === 0) return c.json({ ok: true, duplicate: true });

    try {
      const sent = await deps.events.sendUserMessage({
        spaceId: device.spaceId,
        threadId: job.threadId,
        botId: job.botId,
        userId: job.userId,
        blocks: [{ kind: "text", text: report }],
        prompt: report,
        trigger: "browser_device",
      });
      if (sent.runId) await deps.jobs.enqueue(runContinueJob(sent.runId));
    } catch (error) {
      // The work is done and recorded; only the telling failed. Say so in the log rather
      // than answering 500 and inviting the extension to run the whole task again.
      logger.error("browser device result could not be delivered", {
        "browser_device.id": device.id,
        "browser_job.id": job.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json({ ok: true, delivered: false });
    }

    return c.json({ ok: true, delivered: true });
  });
}
