import { computerSleepJob, type JobPublisher, type SandboxProvider } from "@rakazo/adapter-kit";
import { ACTIVE_RUN_STATUSES, AGENTS_PAUSED_STOPPED_MESSAGE } from "@rakazo/core";
import {
  cancelRunForAgentsPause,
  type PrismaClient,
  type ThreadEvents,
  withTransactionRetry,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { readRunComputers, stopRunComputers } from "./thread-target.js";

export interface AgentsPauseDeps {
  prisma: PrismaClient;
  sandbox: SandboxProvider;
  jobs: JobPublisher;
  events: ThreadEvents;
}

/**
 * The owner's emergency stop: the one switch for when something is burning money or doing harm.
 *
 * The flag goes on first, so the worker refuses anything that starts from here on; then every
 * active run is cancelled - the worker notices within a second and stops - with a line in its
 * thread saying why; then every awake browser is asked to shut down now rather than after its
 * idle timeout, which is what stops the Browserbase meter. That includes a screen the user was
 * holding for a cancelled run: the stop is for when the meter itself is the problem. Sleep
 * keeps each browser's Context, so sign-ins survive.
 */
export async function pauseAgents(
  deps: AgentsPauseDeps,
  ownerUserId: string,
): Promise<{ cancelledRuns: number; sleepingComputers: number }> {
  const now = new Date();
  await deps.prisma.deploymentSettings.upsert({
    where: { id: "default" },
    create: { id: "default", agentsPausedAt: now, agentsPausedBy: ownerUserId },
    update: { agentsPausedAt: now, agentsPausedBy: ownerUserId },
  });

  const active = await deps.prisma.run.findMany({
    where: { status: { in: [...ACTIVE_RUN_STATUSES] } },
    select: { id: true, threadId: true },
  });
  // Read before cancelling: cancelling expires the leases the screen teardown needs.
  const working = await readRunComputers(
    deps.prisma,
    active.map((run) => run.id),
  );
  let cancelledRuns = 0;
  for (const run of active) {
    const cancelled = await withTransactionRetry(() =>
      deps.prisma.$transaction((tx) =>
        cancelRunForAgentsPause(tx, {
          runId: run.id,
          threadId: run.threadId,
          message: AGENTS_PAUSED_STOPPED_MESSAGE,
          now,
        }),
      ),
    );
    if (!cancelled) continue;
    cancelledRuns += 1;
    await deps.events.notify(run.threadId, cancelled.seq).catch((error) => {
      getLogger().error("agents pause realtime notification", error);
    });
  }
  await stopRunComputers(deps.sandbox, working, (computer) => ({
    spaceId: computer.spaceId,
    userId: computer.userId,
  })).catch((error) => {
    // The runs are already cancelled and the worker stops them; a failed teardown only
    // leaves the browser to its idle timeout, which the sleep below shortens anyway.
    getLogger().error("agents pause computer teardown", error);
  });

  const awake = await deps.prisma.computer.findMany({
    where: { state: "running", providerRef: { not: null } },
    select: { id: true },
  });
  let sleepingComputers = 0;
  for (const computer of awake) {
    try {
      await deps.jobs.enqueue(computerSleepJob(computer.id, now));
      sleepingComputers += 1;
    } catch (error) {
      getLogger().error("agents pause computer sleep", error);
    }
  }
  getLogger().warn("agents paused", { ownerUserId, cancelledRuns, sleepingComputers });
  return { cancelledRuns, sleepingComputers };
}

/** Work may start again. Nothing the stop cancelled or skipped is replayed. */
export async function resumeAgents(
  deps: Pick<AgentsPauseDeps, "prisma">,
  ownerUserId: string,
): Promise<{ cancelledRuns: number; sleepingComputers: number }> {
  await deps.prisma.deploymentSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: { agentsPausedAt: null, agentsPausedBy: null },
  });
  getLogger().warn("agents resumed", { ownerUserId });
  return { cancelledRuns: 0, sleepingComputers: 0 };
}
