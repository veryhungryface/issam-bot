/**
 * Handing a task to the teacher's own browser.
 *
 * Every other computer this product drives is a Browserbase session: remote, empty, signed
 * in to nothing. This one is the opposite — a Chrome the teacher uses all day, already
 * signed in to the school systems, sitting on their desk. That is the only reason it is
 * worth having and the only reason it is dangerous, and the rules here follow from it.
 *
 * Whole tasks, not browser steps. The extension cannot be called; it polls every few
 * seconds, so a per-click round trip would spend minutes doing what one instruction does
 * in one pass. The bot writes an instruction in the teacher's own language, the extension's
 * agent carries it out, and one result comes back.
 *
 * Pure: the rules, the limits and the wording. Everything that touches a database or a
 * socket lives in the adapters and the api.
 */

/** Where a handed-off task can be. */
export const BROWSER_JOB_STATUSES = ["queued", "claimed", "done", "error", "expired"] as const;
export type BrowserJobStatus = (typeof BROWSER_JOB_STATUSES)[number];

/** Statuses the extension is allowed to report. It may not invent "queued" or "expired". */
export const BROWSER_JOB_REPORTABLE_STATUSES = ["done", "error"] as const;
export type BrowserJobReportableStatus = (typeof BROWSER_JOB_REPORTABLE_STATUSES)[number];

export function isBrowserJobReportableStatus(value: unknown): value is BrowserJobReportableStatus {
  return (
    typeof value === "string" &&
    (BROWSER_JOB_REPORTABLE_STATUSES as readonly string[]).includes(value)
  );
}

/** `Secret.kind` for a paired device's token, so a token cannot be loaded as another kind. */
export const BROWSER_DEVICE_SECRET_KIND = "browser-device";

/**
 * How long a device counts as reachable after its last poll.
 *
 * The extension polls every few seconds and its alarm revives a suspended service worker
 * twice a minute, so a gap this long means the machine is asleep, Chrome is shut, or the
 * teacher went home — not that one request was slow. The bot needs to know before it hands
 * over work that nobody will pick up.
 */
export const BROWSER_DEVICE_ONLINE_WINDOW_MS = 90_000;

export function isBrowserDeviceOnline(
  lastSeenAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastSeenAt) return false;
  const gap = now.getTime() - lastSeenAt.getTime();
  return gap >= 0 && gap <= BROWSER_DEVICE_ONLINE_WINDOW_MS;
}

/**
 * How long a claimed task may stay silent before it is written off.
 *
 * Real browser work on a slow school network takes minutes, so this is generous. What it
 * protects against is the other case: Chrome closed mid-task, or the extension updated
 * itself, and the row would otherwise sit "claimed" forever and block the device.
 */
export const BROWSER_JOB_CLAIM_TIMEOUT_MS = 15 * 60_000;

/** How long an unclaimed task waits before it is no longer worth running. */
export const BROWSER_JOB_QUEUE_TIMEOUT_MS = 30 * 60_000;

export function browserJobHasExpired(
  job: { status: string; createdAt: Date; claimedAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (job.status === "claimed") {
    const since = job.claimedAt ?? job.createdAt;
    return now.getTime() - since.getTime() > BROWSER_JOB_CLAIM_TIMEOUT_MS;
  }
  if (job.status === "queued") {
    return now.getTime() - job.createdAt.getTime() > BROWSER_JOB_QUEUE_TIMEOUT_MS;
  }
  return false;
}

export const BROWSER_JOB_PROMPT_MAX = 4_000;
export const BROWSER_JOB_RESULT_MAX = 20_000;
export const BROWSER_DEVICE_NAME_MAX = 60;

/**
 * The instruction, trimmed and capped, or `null` when there is nothing to send.
 *
 * Capped because the whole instruction crosses to a machine this server does not control
 * and comes back in a log; a model that decides to paste a thread into it should be cut
 * off here rather than at the far end.
 */
export function normalizeBrowserJobPrompt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > BROWSER_JOB_PROMPT_MAX ? text.slice(0, BROWSER_JOB_PROMPT_MAX) : text;
}

/** What the extension sent back, capped. Empty becomes a sentence rather than a blank. */
export function normalizeBrowserJobResult(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "결과 설명 없이 끝났습니다.";
  return text.length > BROWSER_JOB_RESULT_MAX ? text.slice(0, BROWSER_JOB_RESULT_MAX) : text;
}

export function normalizeBrowserDeviceName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) return null;
  return name.length > BROWSER_DEVICE_NAME_MAX ? name.slice(0, BROWSER_DEVICE_NAME_MAX) : name;
}

/**
 * What the thread is told when a handed-off task comes back.
 *
 * Korean, like the weekly credit message in `credit.ts`: this text is read by the teacher
 * in their own chat, not by an operator in a log. It names the machine, because a teacher
 * can have more than one and "작업이 끝났어요" from an unnamed browser is not an answer.
 */
export function formatBrowserJobReport(input: {
  deviceName: string;
  status: BrowserJobReportableStatus;
  result: string;
}): string {
  const lead =
    input.status === "done"
      ? `${input.deviceName}에서 작업을 마쳤어요.`
      : `${input.deviceName}에서 작업이 실패했어요.`;
  return `${lead}\n\n${input.result}`;
}

/** What the bot is told the moment it hands a task over. */
export function formatBrowserJobHandoff(deviceName: string): string {
  return `${deviceName}에 작업을 보냈습니다. 끝나면 결과가 이 대화에 올라옵니다.`;
}
