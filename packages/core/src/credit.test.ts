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
  modelTokenRates,
  resolveWeeklyCreditKrw,
} from "./credit.js";

/** The model the deployment runs today. Named once so a switch is one edit here too. */
const MODEL = "gpt-6-luna";

/** Tokens on one model, which is what a week looks like when nobody changed models. */
function onModel(inputTokens: number, outputTokens: number, model = MODEL) {
  return [{ model, inputTokens, outputTokens }];
}

describe("what a run costs", () => {
  it("charges nothing for nothing", () => {
    expect(estimateCostKrw({ models: [], browserSeconds: 0 })).toBe(0);
  });

  it("prices a million input tokens at the card's rate for that model", () => {
    const cost = estimateCostKrw({ models: onModel(1_000_000, 0), browserSeconds: 0 });
    const rate = modelTokenRates(MODEL).usdPerMillionInputTokens;
    expect(cost).toBeCloseTo(rate * CREDIT_RATES.krwPerUsd, 6);
  });

  it("charges more for output than for input, because the provider does", () => {
    const sameVolume = 500_000;
    const input = estimateCostKrw({ models: onModel(sameVolume, 0), browserSeconds: 0 });
    const output = estimateCostKrw({ models: onModel(0, sameVolume), browserSeconds: 0 });
    expect(output).toBeGreaterThan(input);
  });

  it("prices an hour of browser time at the card's hourly rate", () => {
    const cost = estimateCostKrw({ models: [], browserSeconds: 3_600 });
    expect(cost).toBeCloseTo(CREDIT_RATES.usdPerBrowserHour * CREDIT_RATES.krwPerUsd, 6);
  });

  it("stays fractional, so a run too cheap to round is still charged", () => {
    // A median run on the observed data is a few won. Rounding each one to the nearest won
    // before summing would throw away most of a light week.
    const oneRun = estimateCostKrw({ models: onModel(10_000, 300), browserSeconds: 0 });
    expect(oneRun).toBeGreaterThan(0);
    expect(oneRun).toBeLessThan(10);
    expect(Number.isInteger(oneRun)).toBe(false);
  });

  it("ignores negative meters rather than crediting them back", () => {
    expect(estimateCostKrw({ models: onModel(-1_000_000, 0), browserSeconds: -3_600 })).toBe(0);
  });

  it("splits the same total into the parts it was spent on", () => {
    const usage = { models: onModel(2_000_000, 50_000), browserSeconds: 1_800 };
    const parts = costBreakdownKrw(usage);
    expect(parts.totalKrw).toBeCloseTo(estimateCostKrw(usage), 6);
    expect(parts.inputKrw).toBeGreaterThan(0);
    expect(parts.outputKrw).toBeGreaterThan(0);
    expect(parts.browserKrw).toBeGreaterThan(0);
  });
});

describe("a card with a row per model", () => {
  it("charges the cheaper model less for identical work", () => {
    const work = { inputTokens: 5_000_000, outputTokens: 200_000 };
    const luna6 = estimateCostKrw({
      models: [{ model: "gpt-6-luna", ...work }],
      browserSeconds: 0,
    });
    const luna56 = estimateCostKrw({
      models: [{ model: "gpt-5.6-luna", ...work }],
      browserSeconds: 0,
    });
    expect(luna6).toBeLessThan(luna56);
    // The published cut: half the input price, and well under half the output price.
    expect(luna6 / luna56).toBeLessThan(0.6);
  });

  it("prices a week that spans a model switch at both prices, not one", () => {
    // The deployment moved from 5.6 to 6 mid-week. The rows before the switch have to keep
    // costing what they cost — this is the whole reason the card is keyed by model.
    const mixed = estimateCostKrw({
      models: [
        { model: "gpt-5.6-luna", inputTokens: 2_000_000, outputTokens: 20_000 },
        { model: "gpt-6-luna", inputTokens: 2_000_000, outputTokens: 20_000 },
      ],
      browserSeconds: 0,
    });
    const allOld = estimateCostKrw({
      models: [{ model: "gpt-5.6-luna", inputTokens: 4_000_000, outputTokens: 40_000 }],
      browserSeconds: 0,
    });
    const allNew = estimateCostKrw({
      models: [{ model: "gpt-6-luna", inputTokens: 4_000_000, outputTokens: 40_000 }],
      browserSeconds: 0,
    });
    expect(mixed).toBeGreaterThan(allNew);
    expect(mixed).toBeLessThan(allOld);
  });

  it("charges an unpriced model the deployment default's rate, not nothing", () => {
    // A model with no row must never be free: that would hand whoever uses it an unlimited
    // week. The fallback is the default model's rate, which is also what the gate would
    // have charged before the card learned about models at all.
    const unknown = estimateCostKrw({
      models: [{ model: "some-model-nobody-priced", inputTokens: 1_000_000, outputTokens: 0 }],
      browserSeconds: 0,
    });
    expect(unknown).toBeGreaterThan(0);
    expect(unknown).toBeCloseTo(
      CREDIT_RATES.fallbackTokenRates.usdPerMillionInputTokens * CREDIT_RATES.krwPerUsd,
      6,
    );
  });

  it("keeps the fallback in step with the model the deployment actually runs", () => {
    // If someone adds a row for a new default model and forgets the fallback, an unpriced
    // model starts being charged the old price. Tying them here says so out loud.
    expect(CREDIT_RATES.fallbackTokenRates).toEqual(modelTokenRates(MODEL));
  });

  it("puts the observed weekly spend of one heavy user in the right ballpark", () => {
    // Measured from production for the week of 2026-10-05: the heaviest account.
    // This is a guard on the rate card, not on the data: if someone edits a rate by a
    // factor of ten, a week that cost about two thousand won stops costing that.
    const metered = { inputTokens: 10_923_435, outputTokens: 108_789 };
    const browserSeconds = 10_174;

    const onOldModel = estimateCostKrw({
      models: [{ model: "gpt-5.6-luna", ...metered }],
      browserSeconds,
    });
    expect(onOldModel).toBeGreaterThan(3_000);
    expect(onOldModel).toBeLessThan(5_000);

    // The same week on the model the deployment moved to: around the 2,000 won limit
    // rather than twice it, which is the number the weekly default was chosen against.
    const onNewModel = estimateCostKrw({
      models: [{ model: "gpt-6-luna", ...metered }],
      browserSeconds,
    });
    expect(onNewModel).toBeGreaterThan(1_800);
    expect(onNewModel).toBeLessThan(2_600);
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
