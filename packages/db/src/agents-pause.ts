import type { MessageBlock } from "@rakazo/contracts";
import { ACTIVE_RUN_STATUSES, agentsPausedNonce } from "@rakazo/core";
import type { Prisma } from "./client.js";
import { expireComputerExecutionLeases } from "./computers.js";
import { appendEventInTransaction } from "./events.js";
import { closePendingSignInSheets } from "./expire-stuck-run.js";
import { createThreadMessageInTransaction } from "./messages.js";

/** When the owner's emergency stop went on, or null while agents may work. */
export async function readAgentsPausedAt(
  db: Pick<Prisma.TransactionClient, "deploymentSettings">,
): Promise<Date | null> {
  const settings = await db.deploymentSettings.findUnique({
    where: { id: "default" },
    select: { agentsPausedAt: true },
  });
  return settings?.agentsPausedAt ?? null;
}

export interface CancelRunForAgentsPauseInput {
  runId: string;
  threadId: string;
  /** Said in the thread, and kept as the run's error so the cause outlives the message. */
  message: string;
  now: Date;
}

/**
 * Cancel one run for the emergency stop, whatever state it is in, and say so in its thread.
 *
 * Unlike a stuck-work expiry this frees no steering for a continuation: what the user typed
 * into the stopped work is dropped the way a Stop press drops it, since a continuation would
 * only be refused again. Computer leases are expired here, so a caller that must tear a live
 * screen down reads the lease first. Returns null when the run had already finished.
 */
export async function cancelRunForAgentsPause(
  tx: Prisma.TransactionClient,
  input: CancelRunForAgentsPauseInput,
): Promise<{ seq: number } | null> {
  await tx.$queryRaw`SELECT id FROM threads WHERE id = ${input.threadId} FOR UPDATE`;
  const cancelled = await tx.run.updateMany({
    where: {
      id: input.runId,
      threadId: input.threadId,
      status: { in: [...ACTIVE_RUN_STATUSES] },
    },
    data: {
      status: "cancelled",
      error: input.message,
      completedAt: input.now,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
  if (cancelled.count !== 1) return null;

  await tx.attempt.updateMany({
    where: {
      runId: input.runId,
      status: { in: ["running", "waiting_input", "waiting_takeover"] },
    },
    data: { status: "cancelled", finishedAt: input.now },
  });
  const run = await tx.run.findUniqueOrThrow({
    where: { id: input.runId },
    select: { spaceId: true, threadId: true, botId: true, taskId: true },
  });
  const sibling = await tx.run.findFirst({
    where: {
      taskId: run.taskId,
      id: { not: input.runId },
      status: { in: [...ACTIVE_RUN_STATUSES] },
    },
    select: { id: true },
  });
  if (!sibling) {
    await tx.task.updateMany({ where: { id: run.taskId }, data: { status: "cancelled" } });
  }
  await closePendingSignInSheets(tx, { ...run, runId: input.runId });

  const blocks: MessageBlock[] = [{ kind: "meta", text: input.message }];
  const message = await createThreadMessageInTransaction(tx, {
    threadId: run.threadId,
    role: "system",
    blocks,
    botId: run.botId,
    clientNonce: agentsPausedNonce(input.runId),
    markUnread: true,
  });
  await appendEventInTransaction(tx, {
    spaceId: run.spaceId,
    threadId: run.threadId,
    botId: run.botId,
    type: "thread.message.created",
    payload: { messageId: message.id, role: "system", blocks },
  });
  const cancelledEvent = await appendEventInTransaction(tx, {
    spaceId: run.spaceId,
    threadId: run.threadId,
    botId: run.botId,
    type: "run.cancelled",
    runId: input.runId,
    payload: {},
    terminal: true,
  });
  await tx.event.deleteMany({ where: { runId: input.runId, type: "thread.progress" } });

  await expireComputerExecutionLeases(tx, { runId: input.runId });
  // A takeover the user is actually holding stays theirs; only the run's claim on it goes.
  await tx.computer.updateMany({
    where: {
      controlRunId: input.runId,
      OR: [{ controlHolder: { not: "user" } }, { controlLeaseId: null }],
    },
    data: { controlRunId: null },
  });
  await tx.computer.updateMany({
    where: { executionRunId: input.runId },
    data: { executionRunId: null, executionBotId: null, executionLeaseExpiresAt: null },
  });
  await tx.steeringMessage.deleteMany({
    where: {
      OR: [
        { runId: input.runId },
        { runId: null, botId: run.botId, message: { threadId: run.threadId } },
      ],
    },
  });
  return { seq: cancelledEvent.seq };
}
