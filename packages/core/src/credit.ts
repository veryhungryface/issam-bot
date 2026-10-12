/**
 * The weekly credit: what a run costs, what a week allows, and how much is left.
 *
 * Usage was already recorded before this file existed — tokens in `usage_records`, browser
 * seconds in `browser_session_usage` — but nothing turned those numbers into money, and
 * nothing stopped anyone. `docs/COST_LIMITS.md` describes the limits as if they were
 * enforced; they were not, because no code read the environment variables it names. This is
 * the piece that was missing: one rate card, one window, one answer to "how much is left".
 *
 * Everything here is pure. The rate card is a value with an effective date rather than
 * numbers sprinkled through queries, so a price change is one edit and a historical
 * estimate can still be recomputed against the card that was current when it was spent.
 */

/** What one model charges per million tokens, in the provider's own currency. */
export interface ModelTokenRates {
  usdPerMillionInputTokens: number;
  usdPerMillionOutputTokens: number;
}

/** What the providers charge. Rates are the provider's own units; `krwPerUsd` converts. */
export interface CreditRates {
  /** Which card this is, persisted alongside an estimate so old estimates stay explainable. */
  version: string;
  /** The day these rates were read from the providers, as `YYYY-MM-DD`. */
  effectiveFrom: string;
  /** Token prices by model id, as `usage_records.model` records them. */
  models: Record<string, ModelTokenRates>;
  /**
   * What a model with no row above is charged.
   *
   * Priced per model rather than once for the deployment because the two are not the same
   * number and the gap is large: on this card the cheapest and dearest models are twenty
   * times apart. A single blended rate would silently misprice every week that a model
   * switch touched — the deployment moved from gpt-5.6-luna to gpt-6-luna mid-flight, and
   * a global card would have kept charging the old price until someone noticed.
   *
   * Keep this tracking whatever `PI_DEFAULT_MODEL` resolves to, so an unpriced model is
   * charged what the deployment's own model costs rather than a guess in either direction.
   * Charging the dearest known rate would be safer for the invoice but would lock someone
   * out of a deployment over a missing table row, which is worse than a small misprice.
   */
  fallbackTokenRates: ModelTokenRates;
  usdPerBrowserHour: number;
  krwPerUsd: number;
}

/**
 * Rates as of 2026-10-12.
 *
 * Token prices are OpenAI's list prices. gpt-6-luna and gpt-6-sol landed on 2026-09-22 at
 * half their predecessors' input price or less, and OpenAI has said the figures are
 * permanent rather than introductory. The 5.6 rows stay because a week already spent on
 * them has to keep costing what it cost.
 *
 * Browser time is Browserbase's $0.12 per browser-hour, the Developer-tier overage rate —
 * the marginal price of one more hour, which is what a limit should be built on, rather
 * than the blended price of a plan's included hours.
 *
 * The exchange rate is the one number here that moves daily. It is deliberately a round
 * figure: a credit limit is a budget, not an invoice, and a limit that drifts with the
 * currency market would make "64% left" mean something different every morning.
 */
export const CREDIT_RATES: CreditRates = {
  version: "2026-10-12",
  effectiveFrom: "2026-10-12",
  models: {
    "gpt-6-luna": { usdPerMillionInputTokens: 0.1, usdPerMillionOutputTokens: 0.5 },
    "gpt-6-sol": { usdPerMillionInputTokens: 2, usdPerMillionOutputTokens: 10 },
    "gpt-5.6-luna": { usdPerMillionInputTokens: 0.2, usdPerMillionOutputTokens: 1.2 },
    "gpt-5.6-sol": { usdPerMillionInputTokens: 4, usdPerMillionOutputTokens: 20 },
  },
  fallbackTokenRates: { usdPerMillionInputTokens: 0.1, usdPerMillionOutputTokens: 0.5 },
  usdPerBrowserHour: 0.12,
  krwPerUsd: 1_450,
};

/** The card's rate for one model id, or the fallback when the card does not name it. */
export function modelTokenRates(model: string, rates: CreditRates = CREDIT_RATES): ModelTokenRates {
  return rates.models[model] ?? rates.fallbackTokenRates;
}

/** Tokens one model spent. `usage_records` holds a row per call, with the model on it. */
export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** What one run, or one week, consumed. */
export interface CreditUsage {
  /** Token usage grouped by model, because models are not priced alike. */
  models: ModelUsage[];
  browserSeconds: number;
}

const MILLION = 1_000_000;
const SECONDS_PER_HOUR = 3_600;

/**
 * What a slice of usage cost, in won, unrounded.
 *
 * Kept fractional on purpose. A single run costs a few won, and rounding each one to the
 * nearest won before adding them up would lose most of a light user's week.
 */
export function estimateCostKrw(usage: CreditUsage, rates: CreditRates = CREDIT_RATES): number {
  return costBreakdownKrw(usage, rates).totalKrw;
}

/** The same figure split up, for the detail view that answers "what did I spend it on?". */
export function costBreakdownKrw(
  usage: CreditUsage,
  rates: CreditRates = CREDIT_RATES,
): { inputKrw: number; outputKrw: number; browserKrw: number; totalKrw: number } {
  let inputUsd = 0;
  let outputUsd = 0;
  for (const row of usage.models) {
    const modelRates = modelTokenRates(row.model, rates);
    inputUsd += (Math.max(0, row.inputTokens) / MILLION) * modelRates.usdPerMillionInputTokens;
    outputUsd += (Math.max(0, row.outputTokens) / MILLION) * modelRates.usdPerMillionOutputTokens;
  }
  const browserUsd =
    (Math.max(0, usage.browserSeconds) / SECONDS_PER_HOUR) * rates.usdPerBrowserHour;
  const inputKrw = inputUsd * rates.krwPerUsd;
  const outputKrw = outputUsd * rates.krwPerUsd;
  const browserKrw = browserUsd * rates.krwPerUsd;
  return { inputKrw, outputKrw, browserKrw, totalKrw: inputKrw + outputKrw + browserKrw };
}
/**
 * The week the credit is measured over: Monday 00:00 Korean time to the next Monday.
 *
 * Korea has no daylight saving, so the offset is a constant and the boundary can be
 * arithmetic rather than a timezone database. A UTC week would roll over at 9am Monday
 * local, in the middle of a working morning, which is exactly when someone would notice
 * their credit jump and not understand why.
 */
export const CREDIT_WEEK_OFFSET_MINUTES = 540;

export interface CreditWindow {
  start: Date;
  end: Date;
}

export function creditWeek(now: Date, offsetMinutes = CREDIT_WEEK_OFFSET_MINUTES): CreditWindow {
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  // getUTCDay on the shifted clock is the local day of week: 0 is Sunday, so Monday is 1.
  const daysSinceMonday = (shifted.getUTCDay() + 6) % 7;
  const localMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() - daysSinceMonday,
  );
  const start = new Date(localMidnight - offsetMinutes * 60_000);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60_000);
  return { start, end };
}

/** The default weekly allowance, in won, when nothing more specific is set. */
export const DEFAULT_WEEKLY_CREDIT_KRW = 2_000;

/**
 * Which limit applies to one person.
 *
 * `null` means no limit. The deployment owner is always unlimited: they pay the provider
 * invoices, and a budget that locks the person holding the credit card out of their own
 * deployment is a bug dressed up as a feature. Everyone else gets their own override if
 * one is set, and the deployment default otherwise.
 */
export function resolveWeeklyCreditKrw(input: {
  isDeploymentOwner: boolean;
  userLimitKrw: number | null | undefined;
  deploymentLimitKrw: number | null | undefined;
}): number | null {
  if (input.isDeploymentOwner) return null;
  if (input.userLimitKrw != null) return input.userLimitKrw > 0 ? input.userLimitKrw : 0;
  const fallback = input.deploymentLimitKrw ?? DEFAULT_WEEKLY_CREDIT_KRW;
  return fallback > 0 ? fallback : 0;
}

/** How a remaining balance should read on screen. */
export type CreditState = "unlimited" | "ok" | "low" | "exhausted";

/** Below this much left, the pill stops being neutral and starts warning. */
export const CREDIT_LOW_PERCENT = 20;

export interface CreditStatus {
  state: CreditState;
  /** `null` when unlimited. */
  limitKrw: number | null;
  spentKrw: number;
  /** `null` when unlimited. Never negative: an overspend reads as nothing left, not as debt. */
  remainingKrw: number | null;
  /** `null` when unlimited. The number the pill shows, 0–100, rounded. */
  remainingPercent: number | null;
}

export function creditStatus(input: { limitKrw: number | null; spentKrw: number }): CreditStatus {
  const spentKrw = Math.max(0, input.spentKrw);
  if (input.limitKrw === null) {
    return {
      state: "unlimited",
      limitKrw: null,
      spentKrw,
      remainingKrw: null,
      remainingPercent: null,
    };
  }
  const limitKrw = Math.max(0, input.limitKrw);
  const remainingKrw = Math.max(0, limitKrw - spentKrw);
  // A zero limit is "blocked", not "100% left": dividing by it would say the opposite.
  const remainingPercent = limitKrw === 0 ? 0 : Math.round((remainingKrw / limitKrw) * 100);
  const state: CreditState =
    remainingKrw <= 0 ? "exhausted" : remainingPercent <= CREDIT_LOW_PERCENT ? "low" : "ok";
  return { state, limitKrw, spentKrw, remainingKrw, remainingPercent };
}

/**
 * Whether new work may start.
 *
 * Checked before a run begins, not during one. A run that is halfway through a browser
 * session has already spent most of what it will spend, and killing it there wastes that
 * money without finishing the job — so a week can end slightly over its limit, and the
 * overspend comes out of the next check rather than out of a half-done task.
 */
export function creditAllowsRun(status: CreditStatus): boolean {
  return status.state !== "exhausted";
}

/** What the person is told when it will not start. */
export function creditExhaustedMessage(status: CreditStatus, resetsAt: Date): string {
  const limit = status.limitKrw ?? 0;
  return `이번 주 사용량 한도(${limit.toLocaleString("ko-KR")}원)를 모두 썼어요. ${formatResetDay(resetsAt)}에 다시 채워집니다.`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** The reset moment as a Korean reader sees it: the local day it lands on. */
export function formatResetDay(resetsAt: Date, offsetMinutes = CREDIT_WEEK_OFFSET_MINUTES): string {
  const shifted = new Date(resetsAt.getTime() + offsetMinutes * 60_000);
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const weekday = WEEKDAYS[shifted.getUTCDay()] ?? "";
  return `${month}월 ${day}일(${weekday})`;
}
