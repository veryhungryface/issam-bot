import type { MessageBlock } from "@rakazo/contracts";
import type { StuckWorkStatus } from "@rakazo/core";
import { ACTIVE_RUN_STATUSES, stuckWorkExpiredNonce, stuckWorkStatusMessage } from "@rakazo/core";
import type { Prisma } from "./client.js";
import { expireComputerExecutionLeases } from "./computers.js";
import { appendEventInTransaction, createSteeringContinuation } from "./events.js";
import { createThreadMessageInTransaction } from "./messages.js";

export interface ExpireStuckRunInput {
  runId: string;
  threadId: string;
  status: StuckWorkStatus;
  /** The episode's clock. A newer answer or claim moves updatedAt and must win. */
  updatedAt: Date;
  now: Date;
}

export interface ExpireStuckRunResult {
  seq: number;
  continuationRunId: string | null;
}

/**
 * Give the thread back when a queued run or a human wait has gone stale.
 *
 * Everything the wait was holding is released: the attempt, the task, the computer's
 * execution lease, and the steering the user may have typed while it sat there (which a
 * continuation run then picks up, so a message sent into the wait is never lost). `error`
 * carries the status line, which is how a stuck cancel is told apart from a user pressing
 * Stop - that leaves `error` empty.
 *
 * Returns null when the row already moved on, so a double sweep is harmless.
 */
export async function expireStuckRun(
  tx: Prisma.TransactionClient,
  input: ExpireStuckRunInput,
): Promise<ExpireStuckRunResult | null> {
  await tx.$queryRaw`SELECT id FROM threads WHERE id = ${input.threadId} FOR UPDATE`;
  const current = await tx.run.findUnique({
    where: { id: input.runId },
    select: { status: true, updatedAt: true },
  });
  // Re-read so the fence compares the timestamp at the precision Prisma just loaded.
  if (
    !current ||
    current.status !== input.status ||
    current.updatedAt.getTime() !== input.updatedAt.getTime()
  ) {
    return null;
  }
  const cancelled = await tx.run.updateMany({
    where: { id: input.runId, status: input.status, updatedAt: current.updatedAt },
    data: {
      status: "cancelled",
      error: stuckWorkStatusMessage(input.status),
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
    select: { spaceId: true, threadId: true, botId: true, taskId: true, userId: true },
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

  const text = stuckWorkStatusMessage(input.status);
  const blocks: MessageBlock[] = [{ kind: "meta", text }];
  const message = await createThreadMessageInTransaction(tx, {
    threadId: run.threadId,
    role: "system",
    blocks,
    botId: run.botId,
    clientNonce: stuckWorkExpiredNonce(input.runId),
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
    // The run is already cancelled above; this event is what tells the clients so.
    terminal: true,
  });
  // The "working" line belongs to a run that is no longer working.
  await tx.event.deleteMany({ where: { runId: input.runId, type: "thread.progress" } });

  await expireComputerExecutionLeases(tx, { runId: input.runId });
  // A takeover the user is actually holding stays on the screen until they release or it
  // is revoked; dropping controlRunId first is what makes maintenance treat it as idle.
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
  await tx.steeringMessage.updateMany({
    where: { runId: input.runId },
    data: { runId: null, claimedAt: null },
  });
  const continuationRunId = await createSteeringContinuation(tx, {
    spaceId: run.spaceId,
    threadId: run.threadId,
    botId: run.botId,
  });
  return { seq: cancelledEvent.seq, continuationRunId };
}

/**
 * A sign-in sheet left open on a cancelled run still says "조치 필요" and still accepts
 * nothing - the exact state the user reported once before. Close it the way Skip does.
 */
export async function closePendingSignInSheets(
  tx: Prisma.TransactionClient,
  run: { runId: string; spaceId: string; threadId: string; botId: string },
): Promise<void> {
  const sheets = await tx.message.findMany({
    where: { runId: run.runId, threadId: run.threadId },
    select: { id: true, blocks: true },
  });
  for (const sheet of sheets) {
    const blocks = Array.isArray(sheet.blocks) ? (sheet.blocks as MessageBlock[]) : [];
    let closed = false;
    const next = blocks.map((block) => {
      if (block.kind !== "browser_login" || block.status !== "pending") return block;
      closed = true;
      return { ...block, status: "cancelled" as const };
    });
    if (!closed) continue;
    await tx.message.update({
      where: { id: sheet.id },
      data: { blocks: next as unknown as Prisma.InputJsonValue },
    });
    await appendEventInTransaction(tx, {
      spaceId: run.spaceId,
      threadId: run.threadId,
      botId: run.botId,
      type: "thread.message.updated",
      runId: run.runId,
      payload: { messageId: sheet.id, blocks: next },
      terminal: true,
    });
  }
}
