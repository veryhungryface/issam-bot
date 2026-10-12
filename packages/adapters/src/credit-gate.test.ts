import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { creditDecisionForRun } from "./credit-gate.js";

/**
 * A database stub shaped to the four reads the gate makes. Hand-rolled rather than mocked
 * so a query added to the gate later fails here loudly instead of quietly returning zero.
 */
function prismaWith(options: {
  ownerUserId?: string | null;
  deploymentLimitKrw?: number;
  userLimitKrw?: number | null;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Several models in one week, for the case a model switch left rows at both prices. */
  models?: { model: string; inputTokens: number; outputTokens: number }[];
  browserSeconds?: number;
  failOn?: "settings" | "tokens";
}): PrismaClient {
  return {
    deploymentSettings: {
      findUnique: async () => {
        if (options.failOn === "settings") throw new Error("database is down");
        return {
          ownerUserId: options.ownerUserId ?? "owner-1",
          weeklyCreditKrw: options.deploymentLimitKrw ?? 2_000,
        };
      },
    },
    user: {
      findUnique: async () => ({ weeklyCreditKrw: options.userLimitKrw ?? null }),
    },
    usageRecord: {
      groupBy: async () => {
        if (options.failOn === "tokens") throw new Error("database is down");
        const rows =
          options.models ??
          (options.inputTokens || options.outputTokens
            ? [
                {
                  model: options.model ?? "gpt-6-luna",
                  inputTokens: options.inputTokens ?? 0,
                  outputTokens: options.outputTokens ?? 0,
                },
              ]
            : []);
        return rows.map((row) => ({
          model: row.model,
          _sum: { inputTokens: row.inputTokens, outputTokens: row.outputTokens },
        }));
      },
    },
    browserSessionUsage: {
      aggregate: async () => ({ _sum: { seconds: options.browserSeconds ?? 0 } }),
    },
  } as unknown as PrismaClient;
}

const MONDAY_MORNING = new Date("2026-10-12T01:00:00Z");

describe("the gate a run passes before it costs anything", () => {
  it("lets a fresh week through", async () => {
    const decision = await creditDecisionForRun(prismaWith({}), "tester-1", MONDAY_MORNING);
    expect(decision.allowed).toBe(true);
    expect(decision.message).toBe("");
    expect(decision.spentKrw).toBe(0);
    expect(decision.limitKrw).toBe(2_000);
  });

  it("stops a run once the week's credit is gone", async () => {
    // 20M input tokens is about 2,900 won on the current card: well past 2,000.
    const decision = await creditDecisionForRun(
      prismaWith({ inputTokens: 20_000_000 }),
      "tester-1",
      MONDAY_MORNING,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.message).toContain("2,000원");
    expect(decision.message).toContain("10월 19일(월)");
  });

  it("counts browser time toward the same limit as tokens", async () => {
    const tokensOnly = await creditDecisionForRun(
      prismaWith({ inputTokens: 1_000_000 }),
      "tester-1",
      MONDAY_MORNING,
    );
    const withBrowser = await creditDecisionForRun(
      prismaWith({ inputTokens: 1_000_000, browserSeconds: 7_200 }),
      "tester-1",
      MONDAY_MORNING,
    );
    expect(withBrowser.spentKrw).toBeGreaterThan(tokensOnly.spentKrw);
  });

  it("never stops the deployment owner", async () => {
    const decision = await creditDecisionForRun(
      prismaWith({ ownerUserId: "owner-1", inputTokens: 500_000_000 }),
      "owner-1",
      MONDAY_MORNING,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.limitKrw).toBeNull();
  });

  it("honours one account's raised limit without raising the default", async () => {
    const spend = { inputTokens: 20_000_000 };
    const onDefault = await creditDecisionForRun(prismaWith(spend), "tester-1", MONDAY_MORNING);
    const raised = await creditDecisionForRun(
      prismaWith({ ...spend, userLimitKrw: 20_000 }),
      "tester-1",
      MONDAY_MORNING,
    );
    expect(onDefault.allowed).toBe(false);
    expect(raised.allowed).toBe(true);
    expect(raised.limitKrw).toBe(20_000);
  });

  it("blocks an account whose limit was set to zero", async () => {
    const decision = await creditDecisionForRun(
      prismaWith({ userLimitKrw: 0 }),
      "tester-1",
      MONDAY_MORNING,
    );
    expect(decision.allowed).toBe(false);
  });

  it("prices a week that spans a model switch at both models' rates", async () => {
    // Same token volume either way. Split across the old and new model it has to land
    // between the two single-model weeks, which is only true if the gate groups by model
    // instead of handing one blended rate to the whole week.
    const half = { inputTokens: 10_000_000, outputTokens: 100_000 };
    const spent = async (models: { model: string; inputTokens: number; outputTokens: number }[]) =>
      (await creditDecisionForRun(prismaWith({ models }), "tester-1", MONDAY_MORNING)).spentKrw;

    const allNew = await spent([
      { model: "gpt-6-luna", inputTokens: 20_000_000, outputTokens: 200_000 },
    ]);
    const allOld = await spent([
      { model: "gpt-5.6-luna", inputTokens: 20_000_000, outputTokens: 200_000 },
    ]);
    const mixed = await spent([
      { model: "gpt-5.6-luna", ...half },
      { model: "gpt-6-luna", ...half },
    ]);
    expect(mixed).toBeGreaterThan(allNew);
    expect(mixed).toBeLessThan(allOld);
  });

  it("propagates a read failure rather than silently allowing a free week", async () => {
    // The caller decides what a broken check means; the executor logs it and continues,
    // so a database blip cannot stop every bot in the deployment. What must not happen is
    // this function inventing a zero balance and reporting the week as untouched.
    await expect(
      creditDecisionForRun(prismaWith({ failOn: "tokens" }), "tester-1", MONDAY_MORNING),
    ).rejects.toThrow("database is down");
  });
});
