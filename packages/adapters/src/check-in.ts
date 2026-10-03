import { type JobPublisher, routineJobKey, routineWakeupJob } from "@rakazo/adapter-kit";
import {
  CHECK_IN_ROUTINE_KIND,
  CHECK_IN_ROUTINE_NAME,
  type CheckInSignals,
  checkInCrons,
  checkInRoutineId,
  formatCheckInPrompt,
  formatCheckInRecency,
  nextCronDateAcross,
} from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";

/**
 * The database side of a bot that speaks first. The schedule is a single
 * system-owned Routine row carrying five daily crons, so the existing routine
 * wakeup path (claim fencing, future-dated defer, crash reconciliation) does
 * all the hard work and the user's routine list stays the list they wrote.
 */

/** Only failures the user could still care about; a week-old one is history. */
const ROUTINE_FAILURE_LOOKBACK_MS = 24 * 60 * 60_000;

/** Enough recent check-in runs to find the last one that actually spoke. */
const CHECK_IN_SPOKE_RUN_WINDOW = 5;

/** How much of the user's last message to quote back as recency context. */
const LAST_MESSAGE_EXCERPT_CHARS = 200;

export type CheckInBotSettings = {
  id: string;
  spaceId: string;
  userId: string;
  checkInsEnabled: boolean;
  checkInQuietStartHour: number;
  checkInQuietEndHour: number;
};

/**
 * The time zone the five checks are spread across. This deployment serves one
 * country, so the same env var the prompt's clock uses is the user's zone.
 * An unparseable value would make croner silently fall back to UTC and fire at
 * 3am local, so it is rejected here instead.
 */
export function checkInTimeZone(
  timeZone: string | undefined = process.env.DEPLOYMENT_TIME_ZONE?.trim() || undefined,
): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** The bot's local hour right now, for the quiet-hours gate. */
export function checkInLocalHour(now: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hour12: false }).format(now),
  );
}

/**
 * Bring a bot's check-in schedule in line with its settings. Idempotent: the
 * row's id is derived from the bot, so repeated syncs and concurrent callers
 * converge on one schedule instead of stacking up extra ones.
 */
export async function syncBotCheckInRoutine(
  deps: { prisma: PrismaClient; jobs: JobPublisher },
  bot: CheckInBotSettings,
): Promise<void> {
  const routineId = checkInRoutineId(bot.id);
  const timezone = checkInTimeZone();
  const crons = checkInCrons(bot.checkInQuietStartHour, bot.checkInQuietEndHour);
  const nextRunAt = bot.checkInsEnabled ? nextCronDateAcross(crons, new Date(), timezone) : null;
  const active = bot.checkInsEnabled && nextRunAt !== null;
  // The prompt is rebuilt from live signals at wake time; the stored one only
  // has to be non-empty and has to explain the row if anyone ever reads it.
  const prompt = formatCheckInPrompt();
  await deps.prisma.routine.upsert({
    where: { id: routineId },
    create: {
      id: routineId,
      spaceId: bot.spaceId,
      botId: bot.id,
      userId: bot.userId,
      kind: CHECK_IN_ROUTINE_KIND,
      name: CHECK_IN_ROUTINE_NAME,
      prompt,
      crons,
      timezone,
      active,
      notify: true,
      nextRunAt,
    },
    update: { kind: CHECK_IN_ROUTINE_KIND, prompt, crons, timezone, active, nextRunAt },
  });
  if (active && nextRunAt) {
    await deps.jobs.enqueue(routineWakeupJob(routineId, nextRunAt));
    return;
  }
  await deps.jobs.cancel(routineJobKey(routineId)).catch((error) => {
    // A schedule that is already gone is the state we wanted anyway.
    getLogger().error("check-in schedule cancel", error);
  });
}

/** Sync many bots in one pass — the backfill path for bots that predate the feature. */
export async function syncBotCheckInRoutines(
  deps: { prisma: PrismaClient; jobs: JobPublisher },
  bots: readonly CheckInBotSettings[],
): Promise<void> {
  for (const bot of bots) {
    await syncBotCheckInRoutine(deps, bot).catch((error) => {
      // One bot's schedule must not take down a page load or a bot update.
      getLogger().error("check-in schedule sync", error);
    });
  }
}

export type CheckInSituation = {
  signals: CheckInSignals;
  lastConversation?: string;
  routineTrouble?: string;
};

/**
 * Everything the gate and the prompt need, read from this workspace only.
 * All of it is either a count or a timestamp, except the quoted excerpt of the
 * user's own last message, which is escaped and labelled as data.
 */
export async function loadCheckInSituation(
  prisma: PrismaClient,
  input: { spaceId: string; botId: string; threadId: string; routineId: string; now: Date },
): Promise<CheckInSituation> {
  const failureSince = new Date(input.now.getTime() - ROUTINE_FAILURE_LOOKBACK_MS);
  const [openScratchpadItems, failures, lastMessage, lastUserMessage, spokeRuns] =
    await Promise.all([
      prisma.scratchpadItem.count({
        where: { spaceId: input.spaceId, botId: input.botId, status: { not: "done" } },
      }),
      prisma.run.count({
        where: {
          spaceId: input.spaceId,
          botId: input.botId,
          trigger: "routine",
          status: "failed",
          routineId: { not: input.routineId },
          updatedAt: { gte: failureSince },
        },
      }),
      prisma.message.findFirst({
        where: { threadId: input.threadId },
        orderBy: { seq: "desc" },
        select: { createdAt: true },
      }),
      prisma.message.findFirst({
        where: { threadId: input.threadId, role: "user" },
        orderBy: { seq: "desc" },
        select: { createdAt: true, blocks: true },
      }),
      prisma.run.findMany({
        where: { spaceId: input.spaceId, routineId: input.routineId },
        orderBy: { createdAt: "desc" },
        take: CHECK_IN_SPOKE_RUN_WINDOW,
        select: { id: true },
      }),
    ]);

  // Messages carry no relation back to Run, so "did a check-in ever speak" is a
  // lookup of this routine's own recent runs against the thread's bot messages.
  const spokeAt =
    spokeRuns.length === 0
      ? null
      : await prisma.message.findFirst({
          where: {
            threadId: input.threadId,
            role: "bot",
            runId: { in: spokeRuns.map((run) => run.id) },
          },
          orderBy: { seq: "desc" },
          select: { createdAt: true },
        });

  const elapsed = (at: Date | null | undefined): number | null =>
    at ? Math.max(0, input.now.getTime() - at.getTime()) : null;

  const signals: CheckInSignals = {
    openScratchpadItems,
    unreportedRoutineFailures: failures,
    msSinceThreadActivity: elapsed(lastMessage?.createdAt),
    msSinceCheckInSpoke: elapsed(spokeAt?.createdAt),
  };

  const sinceUserSpoke = elapsed(lastUserMessage?.createdAt);
  const excerpt = lastUserMessage ? excerptBlocks(lastUserMessage.blocks) : "";
  return {
    signals,
    lastConversation:
      sinceUserSpoke === null
        ? "never — the user has not written in this chat yet"
        : `${formatCheckInRecency(sinceUserSpoke)}${excerpt ? `, and the last thing the user said was: "${excerpt}"` : ""}`,
    routineTrouble:
      failures > 0
        ? `${failures} scheduled run${failures === 1 ? "" : "s"} failed in the last day and the user has not been told`
        : undefined,
  };
}

/** The prompt for one check-in wake, built from live signals rather than the stored row. */
export function checkInRunPrompt(situation: CheckInSituation): string {
  return formatCheckInPrompt({
    lastConversation: situation.lastConversation,
    routineTrouble: situation.routineTrouble,
  });
}

function excerptBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const text = blocks
    .filter(
      (block): block is { kind: string; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { kind?: unknown }).kind === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const clipped =
    text.length > LAST_MESSAGE_EXCERPT_CHARS
      ? `${text.slice(0, LAST_MESSAGE_EXCERPT_CHARS - 1)}…`
      : text;
  // The user's own words reach the model as quoted data; keep them from closing
  // the surrounding block or opening one of their own.
  return clipped.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
