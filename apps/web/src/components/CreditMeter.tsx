import type { CreditStatus } from "@rakazo/contracts";
import { formatResetDay } from "@rakazo/core";

/**
 * The weekly credit, beside the account name and in the panel behind it.
 *
 * The pill is on screen all the time, so it says the one thing that matters in the width of
 * a few characters and then gets out of the way. That thing is how much is left as a share,
 * not as money: "10% 남음" needs no arithmetic to act on, where "920원 / 2,000원" asks the
 * reader to do the division and hands every teacher a running invoice they never asked to
 * see. Won stays in the owner's own limit screen (`CreditLimits`), which is where the
 * figures are actually acted on.
 *
 * It is deliberately not a button. A percentage is a readout; when it was a door it was the
 * third one onto a single screen — the account menu's Usage entry and the composer's
 * `/Settings: Usage` were the others — and three ways into one panel reads as three
 * different panels until you have pressed all three. Settings is the one way in now.
 */

export function formatKrw(krw: number): string {
  return `${Math.round(krw).toLocaleString("ko-KR")}원`;
}

export function formatMinutes(seconds: number): string {
  if (seconds <= 0) return "0분";
  const whole = Math.floor(seconds / 60);
  if (whole >= 60) return `${Math.floor(whole / 60)}시간 ${whole % 60}분`;
  if (whole === 0) return `${seconds}초`;
  return `${whole}분`;
}

/** What the pill says, and how loudly. */
const TONE: Record<CreditStatus["state"], string> = {
  // Quiet by default: a meter that is fine should not pull the eye every time it is passed.
  ok: "bg-muted text-muted-foreground",
  low: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  exhausted: "bg-destructive/15 text-destructive",
  unlimited: "bg-muted text-muted-foreground",
};

/**
 * `className` and `testId` exist for the phone copy of this pill.
 *
 * On a desktop the pill lives in the sidebar beside the account name. A phone keeps that
 * sidebar in a drawer, so a pill that only exists there is not the "always on screen"
 * meter it was asked to be — it is a meter you have to go looking for. The conversation
 * header is the one strip a phone always shows, so a second copy goes there, and it needs
 * the header's own `pointer-events-auto` (the header bar itself does not take pointer
 * events, so that its gradient never swallows a tap meant for the page) and a testid of
 * its own, so a test can say which of the two it means.
 */
export function CreditPill({
  status,
  className = "",
  testId = "credit-pill",
}: {
  status: CreditStatus;
  className?: string;
  testId?: string;
}) {
  // No limit, no meter. A percentage of no limit is not a small number, it is no number,
  // and the owner's spend belongs in the usage section rather than on a pill that every
  // screen carries. The owner used to get their week's won here; it was the one place the
  // money showed up uninvited.
  if (status.state === "unlimited") return null;
  const percent = status.remainingPercent ?? 0;
  const label = status.state === "exhausted" ? "한도 초과" : `${percent}% 남음`;
  return (
    // Plain text, no ARIA: the label is the content, so a screen reader reads the same
    // "10% 남음" everyone else sees, and the title adds when it comes back. It carried an
    // aria-label while it was a button, where the text alone did not say what pressing it
    // would do.
    <span
      data-testid={testId}
      data-state={status.state}
      title={`${formatResetDay(new Date(status.windowEnd))}에 초기화`}
      className={`shrink-0 rounded-full px-2 py-[3px] text-[11.5px] font-medium tabular-nums ${TONE[status.state]} ${className}`}
    >
      {label}
    </span>
  );
}

/**
 * The detail behind the pill, in the usage section of Settings.
 *
 * A percentage invites exactly one question — spent on what? — so this answers it in the
 * work that was actually done: runs, browser time, tokens. It answers in units the reader
 * recognizes rather than in won, because a teacher cannot act on a bill and the number
 * only ever made them cautious about asking a question. What the week costs is the owner's
 * concern and sits in the owner's limit screen.
 */
export function CreditDetail({ status }: { status: CreditStatus }) {
  const resetsAt = new Date(status.windowEnd);
  const limited = status.state !== "unlimited";
  const percent = status.remainingPercent ?? 100;
  return (
    <div data-testid="credit-detail" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-muted-foreground">이번 주 사용량</span>
          <span className="text-[13px] tabular-nums text-foreground">
            {!limited
              ? "한도 없음"
              : status.state === "exhausted"
                ? "한도 초과"
                : `${percent}% 남음`}
          </span>
        </div>
        {limited ? (
          <>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="남은 사용량"
            >
              <div
                className={
                  status.state === "exhausted"
                    ? "h-full rounded-full bg-destructive"
                    : status.state === "low"
                      ? "h-full rounded-full bg-amber-500"
                      : "h-full rounded-full bg-foreground/55"
                }
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="m-0 text-[12.5px] text-muted-foreground">
              {status.state === "exhausted"
                ? `한도를 모두 썼어요. ${formatResetDay(resetsAt)}에 다시 채워집니다.`
                : `${formatResetDay(resetsAt)}에 초기화됩니다.`}
            </p>
          </>
        ) : (
          <p className="m-0 text-[12.5px] text-muted-foreground">
            {formatResetDay(resetsAt)}에 새 주가 시작됩니다.
          </p>
        )}
      </div>

      <ul className="m-0 flex list-none flex-col gap-1 border-t border-border pt-2 pl-0 text-[12.5px] text-muted-foreground">
        <li className="m-0">봇 실행 {status.spent.runs.toLocaleString("ko-KR")}회</li>
        <li className="m-0">
          브라우저 {formatMinutes(status.spent.browserSeconds)}
          {status.spent.browserSessions > 0 ? ` · ${status.spent.browserSessions}세션` : ""}
        </li>
        <li className="m-0 text-muted-foreground/80">
          토큰 입력 {status.spent.inputTokens.toLocaleString("ko-KR")} / 출력{" "}
          {status.spent.outputTokens.toLocaleString("ko-KR")}
        </li>
      </ul>
    </div>
  );
}
