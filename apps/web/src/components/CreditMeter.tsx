import type { CreditStatus } from "@rakazo/contracts";
import { CREDIT_RATES, formatResetDay } from "@rakazo/core";

/**
 * The weekly credit, beside the account name and in the panel behind it.
 *
 * The pill is on screen all the time, so it has to say the one thing that matters in the
 * width of a few characters and then get out of the way. That thing is how much is left,
 * not how much is gone: "64% 남음" needs no arithmetic to act on, where "720원 썼어요"
 * does. The owner has no limit, so their pill shows the week's spend instead — the figure
 * they actually watch, since they are the one the invoice reaches.
 */

export function formatKrw(krw: number): string {
  return `${Math.round(krw).toLocaleString("ko-KR")}원`;
}

function minutes(seconds: number): string {
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

export function CreditPill({ status, onClick }: { status: CreditStatus; onClick: () => void }) {
  const label =
    status.state === "unlimited"
      ? formatKrw(status.spentKrw)
      : status.state === "exhausted"
        ? "한도 초과"
        : `${status.remainingPercent}% 남음`;
  const title =
    status.state === "unlimited"
      ? `이번 주 사용액 ${formatKrw(status.spentKrw)} · 한도 없음`
      : `이번 주 ${formatKrw(status.spentKrw)} / ${formatKrw(status.limitKrw ?? 0)} 사용`;
  return (
    <button
      type="button"
      data-testid="credit-pill"
      data-state={status.state}
      onClick={onClick}
      title={title}
      aria-label={`사용량: ${label}`}
      className={`shrink-0 rounded-full px-2 py-[3px] text-[11.5px] font-medium tabular-nums transition-colors hover:brightness-95 ${TONE[status.state]}`}
    >
      {label}
    </button>
  );
}

/**
 * The detail behind the pill.
 *
 * A percentage invites exactly one question — spent on what? — so this answers it in the
 * two lines the money actually went to, and names the day the allowance comes back. The
 * rate card is shown because a bill nobody can check is a bill nobody trusts.
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
            {limited
              ? `${formatKrw(status.spentKrw)} / ${formatKrw(status.limitKrw ?? 0)}`
              : `${formatKrw(status.spentKrw)} · 한도 없음`}
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
                : `${formatKrw(status.remainingKrw ?? 0)} 남았어요 · ${formatResetDay(resetsAt)}에 초기화`}
            </p>
          </>
        ) : (
          <p className="m-0 text-[12.5px] text-muted-foreground">
            {formatResetDay(resetsAt)}에 새 주가 시작됩니다.
          </p>
        )}
      </div>

      <dl className="m-0 flex flex-col gap-1 border-t border-border pt-2 text-[12.5px]">
        <div className="flex justify-between gap-3">
          <dt className="m-0 text-muted-foreground">
            봇 실행 {status.spent.runs.toLocaleString("ko-KR")}회
          </dt>
          <dd className="m-0 tabular-nums text-foreground/80">
            {formatKrw(status.spent.modelKrw)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="m-0 text-muted-foreground">
            브라우저 {minutes(status.spent.browserSeconds)}
            {status.spent.browserSessions > 0 ? ` · ${status.spent.browserSessions}세션` : ""}
          </dt>
          <dd className="m-0 tabular-nums text-foreground/80">
            {formatKrw(status.spent.browserKrw)}
          </dd>
        </div>
        <div className="flex justify-between gap-3 text-muted-foreground/80">
          <dt className="m-0">
            토큰 입력 {status.spent.inputTokens.toLocaleString("ko-KR")} / 출력{" "}
            {status.spent.outputTokens.toLocaleString("ko-KR")}
          </dt>
        </div>
      </dl>

      <p className="m-0 text-[11.5px] leading-4 text-muted-foreground/70">
        단가 기준 {CREDIT_RATES.effectiveFrom} · 입력 1M당 ${CREDIT_RATES.usdPerMillionInputTokens},
        출력 1M당 ${CREDIT_RATES.usdPerMillionOutputTokens}, 브라우저 1시간당 $
        {CREDIT_RATES.usdPerBrowserHour} · $1 = {CREDIT_RATES.krwPerUsd.toLocaleString("ko-KR")}원
      </p>
    </div>
  );
}
