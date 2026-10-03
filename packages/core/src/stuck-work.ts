/**
 * When work stops waiting for us and starts waiting for nobody.
 *
 * A queued run that never got a worker, a sign-in sheet nobody filled in, a takeover the
 * user walked away from: each one stays "active" forever. It holds the bot's computer
 * lease, it keeps the thread looking busy, and the only notice the user ever got was the
 * one they already missed. We ran into this in production with a sign-in card that sat
 * untouched - the request simply looked frozen.
 *
 * So: remind once, then give the thread back. The thresholds come from how people use a
 * teaching assistant - a lesson, a staff meeting or a commute passes without a nag, but a
 * wait is never silent until the next day.
 */

/** Remind once a queued run or a human wait has been sitting this long. */
export const STUCK_WORK_NOTIFY_AFTER_MS = 4 * 60 * 60 * 1000;

/** Cancel once that same work has been sitting this long, and say so in the thread. */
export const STUCK_WORK_EXPIRE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Marker on a thread.meta event so one waiting episode is reminded once. */
export const STUCK_WORK_NOTICE = "stuck";

export const STUCK_WORK_STATUSES = ["queued", "waiting_input", "waiting_takeover"] as const;
export type StuckWorkStatus = (typeof STUCK_WORK_STATUSES)[number];

export type StuckWorkAction = "notify" | "expire" | "none";

export function isStuckWorkStatus(status: string): status is StuckWorkStatus {
  return (STUCK_WORK_STATUSES as readonly string[]).includes(status);
}

export function stuckWorkAgeMs(updatedAt: Date | string, now: Date): number {
  const at = updatedAt instanceof Date ? updatedAt.getTime() : Date.parse(updatedAt);
  if (!Number.isFinite(at)) return 0;
  return now.getTime() - at;
}

/**
 * `alreadyNotified` is about this episode only. Answering a sheet or reclaiming a run
 * bumps the row's updatedAt, which starts a fresh wait that may be reminded again.
 */
export function stuckWorkAction(input: {
  ageMs: number;
  alreadyNotified: boolean;
}): StuckWorkAction {
  if (input.ageMs >= STUCK_WORK_EXPIRE_AFTER_MS) return "expire";
  if (input.ageMs >= STUCK_WORK_NOTIFY_AFTER_MS && !input.alreadyNotified) return "notify";
  return "none";
}

/** True once a queued run or human wait is old enough to call out in the activity list. */
export function isAgedStuckWork(
  status: string,
  updatedAt: Date | string,
  now = Date.now(),
): boolean {
  if (!isStuckWorkStatus(status)) return false;
  return stuckWorkAgeMs(updatedAt, new Date(now)) >= STUCK_WORK_NOTIFY_AFTER_MS;
}

export function stuckWorkExpiredNonce(runId: string): string {
  return `stuck-expired:${runId}`;
}

/**
 * The line left in the thread when the wait is cancelled. Korean, like everything else the
 * product says to this user, and it names what was being waited for so the line explains
 * itself a day later.
 */
export function stuckWorkStatusMessage(status: StuckWorkStatus): string {
  switch (status) {
    case "queued":
      return "대기만 하다 시작하지 못해서 중단했어요. 다시 말씀해 주시면 바로 할게요.";
    case "waiting_input":
      return "답을 기다리다 중단했어요. 필요하시면 다시 말씀해 주세요.";
    case "waiting_takeover":
      return "화면에서 기다리다 중단했어요. 필요하시면 다시 말씀해 주세요.";
  }
}

export function stuckWorkStatusMessages(): readonly string[] {
  return STUCK_WORK_STATUSES.map((status) => stuckWorkStatusMessage(status));
}

export type StuckAttentionKind = "help" | "takeover" | "failure";

export function stuckWorkReminder(
  status: StuckWorkStatus,
  botName: string,
): { kind: StuckAttentionKind; title: string; body: string } {
  const name = botLabel(botName);
  switch (status) {
    case "queued":
      return {
        kind: "help",
        title: `${name}이 아직 시작하지 못했어요`,
        body: "작업이 대기 중이에요.",
      };
    case "waiting_input":
      return {
        kind: "help",
        title: `${name}이 답을 기다리고 있어요`,
        body: "입력해 주시면 이어서 할게요.",
      };
    case "waiting_takeover":
      return {
        kind: "takeover",
        title: `${name}이 화면에서 기다리고 있어요`,
        body: "직접 확인해 주셔야 이어갈 수 있어요.",
      };
  }
}

export function stuckWorkStoppedNotification(
  status: StuckWorkStatus,
  botName: string,
): { kind: "failure"; title: string; body: string } {
  return {
    kind: "failure",
    title: `${botLabel(botName)} 작업을 중단했어요`,
    body: stuckWorkStatusMessage(status),
  };
}

function botLabel(name: string): string {
  return name.trim() || "봇";
}
