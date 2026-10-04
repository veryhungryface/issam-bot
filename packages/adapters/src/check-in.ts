import { type JobPublisher, routineJobKey, routineWakeupJob } from "@rakazo/adapter-kit";
import {
  botMessageAwaitsReply,
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

/**
 * A fresh bot's memory is just its "# Name" heading. Less real text than this
 * is not something the bot could follow up on.
 */
const MEMORY_WORTH_FOLLOWING_UP_CHARS = 20;

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

/** True when the stored schedule already matches the settings and is armed. */
export function checkInScheduleSettled(
  row: { kind: string; crons: string[]; timezone: string; active: boolean; nextRunAt: Date | null },
  want: { crons: string[]; timezone: string; active: boolean },
): boolean {
  return (
    row.kind === CHECK_IN_ROUTINE_KIND &&
    row.timezone === want.timezone &&
    row.active === want.active &&
    row.crons.length === want.crons.length &&
    row.crons.every((cron, index) => cron === want.crons[index]) &&
    // An inactive schedule has nothing to arm; an active one must have a next fire.
    (!want.active || row.nextRunAt !== null)
  );
}

/**
 * Bring a bot's check-in schedule in line with its settings. Idempotent: the
 * row's id is derived from the bot, so repeated syncs and concurrent callers
 * converge on one schedule instead of stacking up extra ones.
 *
 * A schedule that already matches is left strictly alone. This runs on every
 * app load, and recomputing nextRunAt each time would walk a check that is due
 * right now forward to the next slot and replace its queued job with it — the
 * user would silently lose that check. A nextRunAt in the past is the job
 * reconciler's business, not ours.
 */
export async function syncBotCheckInRoutine(
  deps: { prisma: PrismaClient; jobs: JobPublisher },
  bot: CheckInBotSettings,
): Promise<void> {
  const routineId = checkInRoutineId(bot.id);
  const timezone = checkInTimeZone();
  const crons = checkInCrons(bot.checkInQuietStartHour, bot.checkInQuietEndHour);
  const existing = await deps.prisma.routine.findUnique({
    where: { id: routineId },
    select: { kind: true, crons: true, timezone: true, active: true, nextRunAt: true },
  });
  const nextRunAt = bot.checkInsEnabled ? nextCronDateAcross(crons, new Date(), timezone) : null;
  const active = bot.checkInsEnabled && nextRunAt !== null;
  if (existing && checkInScheduleSettled(existing, { crons, timezone, active })) return;
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
  unansweredQuestion?: string;
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
  const [openScratchpadItems, failures, lastMessage, lastUserMessage, checkInRuns, botMemory] =
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
        select: { createdAt: true, role: true, blocks: true, runId: true },
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
        select: { id: true, createdAt: true },
      }),
      prisma.memoryDocument.findMany({
        where: { spaceId: input.spaceId, botId: input.botId, scope: "bot" },
        select: { content: true },
      }),
    ]);

  // Messages carry no relation back to Run, so "did a check-in ever speak" is a
  // lookup of this routine's own recent runs against the thread's bot messages.
  const spokeAt =
    checkInRuns.length === 0
      ? null
      : await prisma.message.findFirst({
          where: {
            threadId: input.threadId,
            role: "bot",
            runId: { in: checkInRuns.map((run) => run.id) },
          },
          orderBy: { seq: "desc" },
          select: { createdAt: true },
        });

  const elapsed = (at: Date | null | undefined): number | null =>
    at ? Math.max(0, input.now.getTime() - at.getTime()) : null;

  // A check-in that woke after something happened has already judged it,
  // whether it spoke or stayed silent. Judging the same situation again five
  // times a day would only buy more chances to say the same thing.
  const lastCheckInAt = checkInRuns[0]?.createdAt ?? null;
  const notJudgedSince = (at: Date) => lastCheckInAt === null || lastCheckInAt < at;

  const lastMessageFromCheckIn =
    lastMessage?.runId != null &&
    (await prisma.run.count({ where: { id: lastMessage.runId, routineId: input.routineId } })) > 0;
  const openQuestion =
    lastMessage?.role === "bot" &&
    !lastMessageFromCheckIn &&
    botMessageAwaitsReply(lastMessage.blocks) &&
    notJudgedSince(lastMessage.createdAt)
      ? lastMessage
      : null;

  const remembersSomething = botMemory.some(
    (document) => meaningfulMemoryChars(document.content) >= MEMORY_WORTH_FOLLOWING_UP_CHARS,
  );
  const quietUser =
    lastUserMessage && remembersSomething && notJudgedSince(lastUserMessage.createdAt)
      ? lastUserMessage
      : null;

  const signals: CheckInSignals = {
    openScratchpadItems,
    unreportedRoutineFailures: failures,
    msSinceThreadActivity: elapsed(lastMessage?.createdAt),
    msSinceCheckInSpoke: elapsed(spokeAt?.createdAt),
    msSinceUnansweredQuestion: elapsed(openQuestion?.createdAt),
    msSinceUserWentQuiet: elapsed(quietUser?.createdAt),
  };

  const sinceUserSpoke = elapsed(lastUserMessage?.createdAt);
  const excerpt = lastUserMessage ? excerptBlocks(lastUserMessage.blocks) : "";
  const questionExcerpt = openQuestion ? questionBlocksExcerpt(openQuestion.blocks) : "";
  const sinceAsked = elapsed(openQuestion?.createdAt);
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
    unansweredQuestion:
      questionExcerpt && sinceAsked !== null
        ? `asked ${formatCheckInRecency(sinceAsked)}: "${questionExcerpt}"`
        : undefined,
  };
}

/** The prompt for one check-in wake, built from live signals rather than the stored row. */
export function checkInRunPrompt(situation: CheckInSituation): string {
  return formatCheckInPrompt({
    lastConversation: situation.lastConversation,
    routineTrouble: situation.routineTrouble,
    unansweredQuestion: situation.unansweredQuestion,
  });
}

function textOf(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
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
}

function excerptBlocks(blocks: unknown): string {
  const text = textOf(blocks);
  if (!text) return "";
  const clipped =
    text.length > LAST_MESSAGE_EXCERPT_CHARS
      ? `${text.slice(0, LAST_MESSAGE_EXCERPT_CHARS - 1)}…`
      : text;
  return escapeQuoted(clipped);
}

/**
 * The question itself, not the message around it: a choice card's question,
 * else the end of the text, where a reply that asks something puts the ask.
 */
function questionBlocksExcerpt(blocks: unknown): string {
  const choice = Array.isArray(blocks)
    ? blocks.find(
        (block): block is { kind: "choice"; question: string } =>
          typeof block === "object" &&
          block !== null &&
          (block as { kind?: unknown }).kind === "choice" &&
          typeof (block as { question?: unknown }).question === "string",
      )
    : undefined;
  const text = choice?.question.replace(/\s+/g, " ").trim() || textOf(blocks);
  if (!text) return "";
  const clipped =
    text.length > LAST_MESSAGE_EXCERPT_CHARS
      ? `…${text.slice(text.length - (LAST_MESSAGE_EXCERPT_CHARS - 1))}`
      : text;
  return escapeQuoted(clipped);
}

/**
 * Message text reaches the model as quoted data; keep it from closing the
 * surrounding block or opening one of its own.
 */
function escapeQuoted(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Memory text that is not a heading — what the bot actually knows. */
function meaningfulMemoryChars(content: string): number {
  return content
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("")
    .replace(/\s+/g, "").length;
}
