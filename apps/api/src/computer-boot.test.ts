import type { AgentHomeStore, JobPublisher, SandboxProvider } from "@rakazo/adapter-kit";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { provisionComputerForBoot } from "./computer-boot.js";

describe("computer boot", () => {
  it("health-checks and reprovisions an already-running persisted session", async () => {
    const lease = {
      computerId: "computer-1",
      botId: "bot-1",
      runId: "boot:request-1",
      fence: 7,
    };
    const acquire = vi.fn().mockResolvedValue(lease);
    const provision = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    const scheduleSleep = vi.fn();
    const deps = {
      prisma: {} as PrismaClient,
      sandbox: {} as SandboxProvider,
      home: {} as AgentHomeStore,
      jobs: {} as JobPublisher,
      events: {} as ThreadEvents,
    };
    const context = {
      operationId: "boot",
      traceId: "boot",
      workspaceId: "workspace-1",
      userId: "user-1",
      botId: "bot-1",
      signal: new AbortController().signal,
    };

    await provisionComputerForBoot(
      deps,
      { id: "computer-1", state: "running", providerRef: "stale-session-ref" },
      "bot-1",
      context,
      {
        acquire,
        provision,
        release,
        scheduleSleep,
        randomId: () => "request-1",
      },
    );

    expect(acquire).toHaveBeenCalledWith(deps.prisma, {
      computerId: "computer-1",
      botId: "bot-1",
      runId: "boot:request-1",
    });
    expect(provision).toHaveBeenCalledWith(deps, "computer-1", {
      ...context,
      screenLeaseId: "boot:request-1:7",
    });
    expect(scheduleSleep).toHaveBeenCalledWith(deps.jobs, "computer-1");
    expect(release).toHaveBeenCalledWith(deps.prisma, lease);
  });
});
