import { randomUUID } from "node:crypto";
import type { AdapterContext } from "@rakazo/adapter-kit";
import {
  acquireComputerExecutionLease,
  type ComputerExecutionLease,
  type ComputerProvisionDeps,
  provisionComputer,
  releaseComputerExecutionLease,
  scheduleComputerSleep,
  screenLeaseIdForRun,
} from "@rakazo/adapters";

export interface ComputerBootOperations {
  acquire: typeof acquireComputerExecutionLease;
  provision: typeof provisionComputer;
  release: typeof releaseComputerExecutionLease;
  scheduleSleep: typeof scheduleComputerSleep;
  findHeldTakeoverLease: typeof findHeldTakeoverLease;
  randomId: () => string;
}

const defaultOperations: ComputerBootOperations = {
  acquire: acquireComputerExecutionLease,
  provision: provisionComputer,
  release: releaseComputerExecutionLease,
  scheduleSleep: scheduleComputerSleep,
  findHeldTakeoverLease,
  randomId: randomUUID,
};

/**
 * A boot request is also a health check for an ephemeral provider session.
 * Never skip provisioning solely because the persisted computer row says running.
 */
export async function provisionComputerForBoot(
  deps: ComputerProvisionDeps,
  computer: { id: string; state: string; providerRef: string | null },
  botId: string,
  context: AdapterContext,
  operations: ComputerBootOperations = defaultOperations,
): Promise<void> {
  const manualRunId = `boot:${operations.randomId()}`;
  const heldTakeoverLease = await operations.findHeldTakeoverLease(deps.prisma, computer.id, botId);
  if (heldTakeoverLease) {
    await operations.provision(deps, computer.id, {
      ...context,
      runId: heldTakeoverLease.runId,
      screenLeaseId: screenLeaseIdForRun(heldTakeoverLease, heldTakeoverLease.runId),
    });
    operations.scheduleSleep(deps.jobs, computer.id);
    return;
  }
  const lease: ComputerExecutionLease | null = await operations.acquire(deps.prisma, {
    computerId: computer.id,
    runId: manualRunId,
    botId,
  });
  try {
    await operations.provision(deps, computer.id, {
      ...context,
      screenLeaseId: screenLeaseIdForRun(lease, manualRunId),
    });
    operations.scheduleSleep(deps.jobs, computer.id);
  } finally {
    await operations.release(deps.prisma, lease);
  }
}

async function findHeldTakeoverLease(
  prisma: ComputerProvisionDeps["prisma"],
  computerId: string,
  botId: string,
): Promise<ComputerExecutionLease | null> {
  const lease = await prisma.computerExecutionLease.findUnique({
    where: { computerId_botId: { computerId, botId } },
    select: { runId: true, fence: true, expiresAt: true },
  });
  if (!lease || lease.expiresAt.getTime() <= Date.now()) return null;
  const waitingRun = await prisma.run.findFirst({
    where: { id: lease.runId, botId, status: "waiting_takeover" },
    select: { id: true },
  });
  return waitingRun ? { computerId, botId, runId: lease.runId, fence: lease.fence } : null;
}
