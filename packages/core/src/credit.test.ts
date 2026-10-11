import { describe, expect, it } from "vitest";
import {
  CREDIT_LOW_PERCENT,
  CREDIT_RATES,
  costBreakdownKrw,
  creditAllowsRun,
  creditExhaustedMessage,
  creditStatus,
  creditWeek,
  DEFAULT_WEEKLY_CREDIT_KRW,
  estimateCostKrw,
  formatResetDay,
  resolveWeeklyCreditKrw,
} from "./credit.js";

describe("what a run costs", () => {
  it("charges nothing for nothing", () => {
    expect(estimateCostKrw({ inputTokens: 0, outputTokens: 0, browserSeconds: 0 })).toBe(0);
  });

  it("prices a million input tokens at the card's rate", () => {
    const cost = estimateCostKrw({ inputTokens: 1_000_000, outputTokens: 0, browserSeconds: 0 });
    expect(cost).toBeCloseTo(CREDIT_RATES.usdPerMillionInputTokens * CREDIT_RATES.krwPerUsd, 6);
  });

  it("charges more for output than for input, because the provider does", () => {
    const sameVolume = 500_000;
    const input = estimateCostKrw({
      inputTokens: sameVolume,
      outputTokens: 0,
      browserSeconds: 0,
    });
    const output = estimateCostKrw({
      inputTokens: 0,
      outputTokens: sameVolume,
      browserSeconds: 0,
    });
    expect(output).toBeGreaterThan(input);
  });

  it("prices an hour of browser time at the card's hourly rate", () => {
    const cost = estimateCostKrw({ inputTokens: 0, outputTokens: 0, browserSeconds: 3_600 });
    expect(cost).toBeCloseTo(CREDIT_RATES.usdPerBrowserHour * CREDIT_RATES.krwPerUsd, 6);
  });

  it("stays fractional, so a run too cheap to round is still charged", () => {
    // A median run on the observed data is a few won. Rounding each one to the nearest won
    // before summing would throw away most of a light week.
    const oneRun = estimateCostKrw({ inputTokens: 10_000, outputTokens: 300, browserSeconds: 0 });
    expect(oneRun).toBeGreaterThan(0);
    expect(oneRun).toBeLessThan(10);
    expect(Number.isInteger(oneRun)).toBe(false);
  });

  it("ignores negative meters rather than crediting them back", () => {
    expect(
      estimateCostKrw({ inputTokens: -1_000_000, outputTokens: 0, browserSeconds: -3_600 }),
    ).toBe(0);
  });

  it("splits the same total into the parts it was spent on", () => {
    const usage = { inputTokens: 2_000_000, outputTokens: 50_000, browserSeconds: 1_800 };
    const parts = costBreakdownKrw(usage);
    expect(parts.totalKrw).toBeCloseTo(estimateCostKrw(usage), 6);
    expect(parts.inputKrw).toBeGreaterThan(0);
    expect(parts.outputKrw).toBeGreaterThan(0);
    expect(parts.browserKrw).toBeGreaterThan(0);
  });

  it("puts the observed weekly spend of one heavy user in the right ballpark", () => {
    // Measured from production for the week of 2026-10-05: the heaviest account.
    // This is a guard on the rate card, not on the data: if someone edits a rate by a
    // factor of ten, a week that cost about four thousand won stops costing that.
    const spend = estimateCostKrw({
      inputTokens: 10_923_435,
      outputTokens: 108_789,
      browserSeconds: 10_174,
    });
    expect(spend).toBeGreaterThan(3_000);
    expect(spend).toBeLessThan(5_000);
  });
});

describe("the week it resets on", () => {
  it("starts on Monday midnight Korean time", () => {
    // 2026-10-15 is a Thursday. Korean Monday 00:00 is 2026-10-11T15:00Z.
    const { start, end } = creditWeek(new Date("2026-10-15T04:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-11T15:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-18T15:00:00.000Z");
  });

  it("keeps Sunday in the week that is ending, not the one starting", () => {
    // Sunday 2026-10-18 09:00 Korean time is still the week that began Monday the 12th.
    const { start } = creditWeek(new Date("2026-10-18T00:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-11T15:00:00.000Z");
  });

  it("rolls over at Korean midnight, not at UTC midnight", () => {
    // 2026-10-19T00:30Z is Monday 09:30 in Seoul: a new week there, and the old week in UTC.
    const before = creditWeek(new Date("2026-10-18T14:59:00Z"));
    const after = creditWeek(new Date("2026-10-18T15:01:00Z"));
    expect(before.start.toISOString()).toBe("2026-10-11T15:00:00.000Z");
    expect(after.start.toISOString()).toBe("2026-10-18T15:00:00.000Z");
  });

  it("covers exactly seven days with no gap between weeks", () => {
    const first = creditWeek(new Date("2026-10-15T04:00:00Z"));
    const next = creditWeek(first.end);
    expect(next.start.getTime()).toBe(first.end.getTime());
    expect(first.end.getTime() - first.start.getTime()).toBe(7 * 24 * 60 * 60_000);
  });

  it("crosses a month boundary without landing on day zero", () => {
    // 2026-11-02 is a Monday, so the week containing Nov 1 starts in October.
    const { start } = creditWeek(new Date("2026-11-01T04:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-25T15:00:00.000Z");
  });

  it("names the reset day the way a Korean reader reads it", () => {
    expect(formatResetDay(new Date("2026-10-18T15:00:00.000Z"))).toBe("10월 19일(월)");
  });
});

describe("whose limit applies", () => {
  it("never limits the person who pays the invoices", () => {
    expect(
      resolveWeeklyCreditKrw({
        isDeploymentOwner: true,
        userLimitKrw: 500,
        deploymentLimitKrw: 2_000,
      }),
    ).toBeNull();
  });

  it("falls back to the deployment default", () => {
    expect(
      resolveWeeklyCreditKrw({
        isDeploymentOwner: false,
        userLimitKrw: null,
        deploymentLimitKrw: 2_000,
      }),
    ).toBe(2_000);
  });

  it("falls back again to the built-in default when the deployment has not said", () => {
    expect(
      resolveWeeklyCreditKrw({
        isDeploymentOwner: false,
        userLimitKrw: undefined,
        deploymentLimitKrw: undefined,
      }),
    ).toBe(DEFAULT_WEEKLY_CREDIT_KRW);
  });

  it("lets one account be raised above the default without raising everyone", () => {
    expect(
      resolveWeeklyCreditKrw({
        isDeploymentOwner: false,
        userLimitKrw: 20_000,
        deploymentLimitKrw: 2_000,
      }),
    ).toBe(20_000);
  });

  it("treats a zero override as blocked rather than as unset", () => {
    // Otherwise the only way to stop one account would be to lower everyone's limit.
    expect(
      resolveWeeklyCreditKrw({
        isDeploymentOwner: false,
        userLimitKrw: 0,
        deploymentLimitKrw: 2_000,
      }),
    ).toBe(0);
  });
});

describe("how much is left", () => {
  it("reads as a percentage of the limit", () => {
    const status = creditStatus({ limitKrw: 2_000, spentKrw: 720 });
    expect(status.remainingKrw).toBe(1_280);
    expect(status.remainingPercent).toBe(64);
    expect(status.state).toBe("ok");
  });

  it("warns once the balance is nearly gone", () => {
    const status = creditStatus({ limitKrw: 2_000, spentKrw: 1_600 });
    expect(status.remainingPercent).toBe(CREDIT_LOW_PERCENT);
    expect(status.state).toBe("low");
    expect(creditAllowsRun(status)).toBe(true);
  });

  it("stops at nothing left rather than going into debt", () => {
    const status = creditStatus({ limitKrw: 2_000, spentKrw: 3_400 });
    expect(status.remainingKrw).toBe(0);
    expect(status.remainingPercent).toBe(0);
    expect(status.state).toBe("exhausted");
    expect(creditAllowsRun(status)).toBe(false);
  });

  it("says nothing about a balance when there is no limit", () => {
    const status = creditStatus({ limitKrw: null, spentKrw: 99_999 });
    expect(status.state).toBe("unlimited");
    expect(status.remainingPercent).toBeNull();
    expect(status.remainingKrw).toBeNull();
    expect(creditAllowsRun(status)).toBe(true);
  });

  it("calls a zero limit blocked, not untouched", () => {
    const status = creditStatus({ limitKrw: 0, spentKrw: 0 });
    expect(status.remainingPercent).toBe(0);
    expect(status.state).toBe("exhausted");
  });

  it("tells the person the amount and the day it comes back", () => {
    const status = creditStatus({ limitKrw: 2_000, spentKrw: 2_000 });
    const message = creditExhaustedMessage(status, new Date("2026-10-18T15:00:00.000Z"));
    expect(message).toContain("2,000원");
    expect(message).toContain("10월 19일(월)");
  });
});
