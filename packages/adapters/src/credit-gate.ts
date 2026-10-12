/**
 * The gate a run passes through before it is allowed to cost anything.
 *
 * `packages/core/src/credit.ts` decides what a week costs and whether a balance is spent;
 * this is the part that has to touch the database, so it lives out here. It answers one
 * question — may this person start another run right now — and it answers it from the same
 * rate card and the same Monday-to-Monday window the pill in the app reads from, so the
 * number someone sees and the moment they get stopped agree with each other.
 */

import {
  costBreakdownKrw,
  creditAllowsRun,
  creditExhaustedMessage,
  creditStatus,
  creditWeek,
  resolveWeeklyCreditKrw,
} from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";

export interface CreditDecision {
  allowed: boolean;
  /** What to tell the person when it is not. Empty when it is. */
  message: string;
  spentKrw: number;
  limitKrw: number | null;
}

/**
 * Whether this account may start a run.
 *
 * Throws if the usage tables cannot be read, and leaves it to the caller to decide what a
 * broken check means — the executor logs it and lets the run through, because a budget is
 * a cost control rather than a safety one and a database blip should not stop every bot in
 * the deployment. What this must never do is invent a zero balance, which would report a
 * spent week as untouched and quietly hand everyone an unlimited one.
 */
export async function creditDecisionForRun(
  prisma: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<CreditDecision> {
  const week = creditWeek(now);
  const [settings, user, tokens, browser] = await Promise.all([
    prisma.deploymentSettings.findUnique({
      where: { id: "default" },
      select: { ownerUserId: true, weeklyCreditKrw: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { weeklyCreditKrw: true } }),
    // Grouped by model, not summed flat: the card prices models differently, and a week
    // that spans a model switch holds rows at both prices.
    prisma.usageRecord.groupBy({
      by: ["model"],
      where: { userId, createdAt: { gte: week.start, lt: week.end } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    prisma.browserSessionUsage.aggregate({
      where: { userId, startedAt: { gte: week.start, lt: week.end } },
      _sum: { seconds: true },
    }),
  ]);
  const limitKrw = resolveWeeklyCreditKrw({
    isDeploymentOwner: Boolean(settings?.ownerUserId) && settings?.ownerUserId === userId,
    userLimitKrw: user?.weeklyCreditKrw ?? null,
    deploymentLimitKrw: settings?.weeklyCreditKrw ?? null,
  });
  const spentKrw = costBreakdownKrw({
    models: tokens.map((row) => ({
      model: row.model,
      inputTokens: row._sum.inputTokens ?? 0,
      outputTokens: row._sum.outputTokens ?? 0,
    })),
    browserSeconds: browser._sum.seconds ?? 0,
  }).totalKrw;
  const status = creditStatus({ limitKrw, spentKrw });
  const allowed = creditAllowsRun(status);
  return {
    allowed,
    message: allowed ? "" : creditExhaustedMessage(status, week.end),
    spentKrw: status.spentKrw,
    limitKrw: status.limitKrw,
  };
}
