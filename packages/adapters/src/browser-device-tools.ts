import {
  BROWSER_DEVICE_ONLINE_WINDOW_MS,
  type BrowserJobReportableStatus,
  browserJobHasExpired,
  formatBrowserJobHandoff,
  formatBrowserJobReport,
  isBrowserDeviceOnline,
  normalizeBrowserJobPrompt,
  normalizeBrowserJobResult,
} from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";

/**
 * The bot's side of the teacher's own browser.
 *
 * The tool enqueues and returns. It does not wait: browser work on a school network runs
 * for minutes, and a run held open for minutes is exactly what emptied a teacher's weekly
 * credit once already. The extension reports back when it is done and the result arrives
 * in the thread as its own message.
 */

export const BROWSER_DEVICE_TOOL_NAMES = new Set(["my_browser_list", "my_browser_task"]);

export interface BrowserDeviceToolDeps {
  prisma: PrismaClient;
}

type DeviceRow = {
  id: string;
  name: string;
  lastSeenAt: Date | null;
};

function describeDevice(device: DeviceRow, now: Date) {
  return {
    deviceId: device.id,
    name: device.name,
    online: isBrowserDeviceOnline(device.lastSeenAt, now),
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
  };
}

/**
 * The teacher's paired browsers, as the bot sees them.
 *
 * Scoped to the user who owns the run, never to the space: a device is one person's own
 * machine with their own sessions on it, and a colleague in the same space has no business
 * driving it.
 */
export async function listBrowserDevicesFromTool(
  deps: BrowserDeviceToolDeps,
  input: { spaceId: string; userId: string },
  now: Date = new Date(),
) {
  const devices = await deps.prisma.browserDevice.findMany({
    where: { spaceId: input.spaceId, userId: input.userId, revokedAt: null },
    select: { id: true, name: true, lastSeenAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (devices.length === 0) {
    return {
      devices: [],
      note: "연결된 크롬이 없습니다. 설정에서 '내 크롬 연결'을 먼저 해야 합니다.",
    };
  }
  return { devices: devices.map((device) => describeDevice(device, now)) };
}

/**
 * Hand one instruction to one of the teacher's browsers.
 *
 * Refuses an offline device instead of queueing into the dark. A task nobody picks up is
 * worse than a refusal: the teacher is told it was sent, waits, and nothing ever comes.
 */
export async function createBrowserJobFromTool(
  deps: BrowserDeviceToolDeps,
  input: {
    spaceId: string;
    userId: string;
    botId: string;
    threadId: string;
    prompt: unknown;
    deviceId?: string;
  },
  now: Date = new Date(),
) {
  const prompt = normalizeBrowserJobPrompt(input.prompt);
  if (!prompt) return { error: "prompt is required." };

  const devices = await deps.prisma.browserDevice.findMany({
    where: {
      spaceId: input.spaceId,
      userId: input.userId,
      revokedAt: null,
      ...(input.deviceId ? { id: input.deviceId } : {}),
    },
    select: { id: true, name: true, lastSeenAt: true },
    orderBy: { createdAt: "asc" },
  });

  if (devices.length === 0) {
    return {
      error: input.deviceId
        ? "그 이름의 연결된 크롬이 없습니다."
        : "연결된 크롬이 없습니다. 설정에서 '내 크롬 연결'을 먼저 해야 합니다.",
    };
  }

  const online = devices.filter((device) => isBrowserDeviceOnline(device.lastSeenAt, now));
  if (online.length === 0) {
    const seconds = Math.round(BROWSER_DEVICE_ONLINE_WINDOW_MS / 1_000);
    return {
      error: `크롬이 연결돼 있지 않습니다. 최근 ${seconds}초 안에 신호가 없었어요. PC가 켜져 있고 크롬이 열려 있는지 확인해 주세요.`,
    };
  }
  // More than one awake machine and no name given is a choice the bot must not make for
  // the teacher: the two browsers are different desks with different things open.
  if (!input.deviceId && online.length > 1) {
    return {
      error: "크롬이 여러 대 연결돼 있습니다. deviceId로 어느 것인지 지정해 주세요.",
      devices: online.map((device) => describeDevice(device, now)),
    };
  }

  const device = online[0];
  if (!device) return { error: "연결된 크롬이 없습니다." };

  // One at a time per device. The extension runs a single agent against a single Chrome;
  // a second task would fight the first over the same tabs.
  const busy = await deps.prisma.browserJob.findFirst({
    where: { deviceId: device.id, status: { in: ["queued", "claimed"] } },
    select: { id: true, status: true, createdAt: true, claimedAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (busy && !browserJobHasExpired(busy, now)) {
    return { error: `${device.name}에서 아직 다른 작업이 진행 중입니다.` };
  }

  const job = await deps.prisma.browserJob.create({
    data: {
      spaceId: input.spaceId,
      deviceId: device.id,
      userId: input.userId,
      botId: input.botId,
      threadId: input.threadId,
      prompt,
    },
    select: { id: true },
  });

  return {
    ok: true as const,
    jobId: job.id,
    deviceId: device.id,
    deviceName: device.name,
    message: formatBrowserJobHandoff(device.name),
  };
}

/**
 * Sweep tasks whose machine stopped answering.
 *
 * Without this a Chrome closed mid-task leaves its row "claimed" and the device is blocked
 * for good; the teacher's next request would be refused as busy by a task that died.
 */
export async function expireStaleBrowserJobs(
  deps: BrowserDeviceToolDeps,
  now: Date = new Date(),
): Promise<number> {
  const open = await deps.prisma.browserJob.findMany({
    where: { status: { in: ["queued", "claimed"] } },
    select: { id: true, status: true, createdAt: true, claimedAt: true },
  });
  const stale = open.filter((job) => browserJobHasExpired(job, now)).map((job) => job.id);
  if (stale.length === 0) return 0;
  const updated = await deps.prisma.browserJob.updateMany({
    where: { id: { in: stale }, status: { in: ["queued", "claimed"] } },
    data: { status: "expired", finishedAt: now },
  });
  return updated.count;
}

/** The thread-ready text for a finished task. Shared so the api and tests word it alike. */
export function browserJobReport(input: {
  deviceName: string;
  status: BrowserJobReportableStatus;
  result: unknown;
}): string {
  return formatBrowserJobReport({
    deviceName: input.deviceName,
    status: input.status,
    result: normalizeBrowserJobResult(input.result),
  });
}
