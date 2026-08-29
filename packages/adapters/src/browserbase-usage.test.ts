import type { SandboxProvider } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { syncBrowserSessionUsage, toBrowserSessionUsageRow } from "./browserbase-usage.js";

describe("toBrowserSessionUsageRow", () => {
  it("computes billable seconds from provider timestamps", () => {
    const row = toBrowserSessionUsageRow({
      id: "session-1",
      status: "COMPLETED",
      region: "ap-southeast-1",
      startedAt: "2026-08-30T00:00:00.000Z",
      endedAt: "2026-08-30T00:03:30.000Z",
      userMetadata: { workspaceId: "ws-1", userId: "user-1", botId: "bot-1" },
    });
    expect(row).toMatchObject({
      workspaceId: "ws-1",
      userId: "user-1",
      botId: "bot-1",
      sessionId: "session-1",
      seconds: 210,
    });
  });

  it("counts a still-running session up to now and tolerates missing metadata", () => {
    const now = new Date("2026-08-30T00:05:00.000Z");
    const row = toBrowserSessionUsageRow(
      {
        id: "session-2",
        status: "RUNNING",
        createdAt: "2026-08-30T00:00:00.000Z",
        userMetadata: { workspaceId: "ws-1" },
      },
      now,
    );
    expect(row).toMatchObject({ seconds: 300, endedAt: null, userId: null, botId: null });
    expect(toBrowserSessionUsageRow({ id: "session-3", userMetadata: {} }, now)).toBeNull();
  });
});

describe("syncBrowserSessionUsage", () => {
  it("upserts every attributable session and survives provider failures", async () => {
    const upsert = vi.fn(async (_args: unknown) => ({}));
    const prisma = { browserSessionUsage: { upsert } } as unknown as PrismaClient;
    const sandbox = {
      listSessionUsage: async () => [
        {
          id: "s-1",
          status: "COMPLETED",
          startedAt: "2026-08-30T00:00:00.000Z",
          endedAt: "2026-08-30T00:01:00.000Z",
          userMetadata: { workspaceId: "ws-1", userId: "u-1" },
        },
        { id: "s-skip", userMetadata: {} },
      ],
    } as unknown as SandboxProvider;

    await expect(syncBrowserSessionUsage(prisma, sandbox)).resolves.toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]![0]).toMatchObject({
      where: { sessionId: "s-1" },
      create: expect.objectContaining({ seconds: 60, workspaceId: "ws-1" }),
    });

    const failing = {
      listSessionUsage: async () => {
        throw new Error("api down");
      },
    } as unknown as SandboxProvider;
    await expect(syncBrowserSessionUsage(prisma, failing)).resolves.toBe(false);

    const incapable = {} as SandboxProvider;
    await expect(syncBrowserSessionUsage(prisma, incapable)).resolves.toBe(false);
  });
});
