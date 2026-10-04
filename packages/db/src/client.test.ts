import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDb,
  createPool,
  isTooManyDatabaseConnections,
  parsePositiveInteger,
  retryOnTooManyConnections,
  transactionTimingFromEnv,
} from "./client.js";

const pools: Array<{ end: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

describe("createDb", () => {
  it("caps the pg pool and swallows idle-client errors so they cannot crash the process", () => {
    const { pool } = createDb("postgres://rakazo:rakazo@127.0.0.1:9/rakazo", {
      poolMax: 3,
      applicationName: "rakazo-test",
    });
    pools.push(pool);

    expect(pool.options.max).toBe(3);
    expect(pool.options.connectionTimeoutMillis).toBe(10_000);
    expect(pool.options.idleTimeoutMillis).toBe(0);
    expect(pool.options.application_name).toBe("rakazo-test");
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
    expect(pool.listenerCount("connect")).toBeGreaterThan(0);

    expect(() => pool.emit("error", new Error("idle client lost"))).not.toThrow();
  });

  it("defaults to a four-connection pool", () => {
    const { pool } = createDb("postgres://rakazo:rakazo@127.0.0.1:9/rakazo");
    pools.push(pool);
    expect(pool.options.max).toBe(4);
  });
});

describe("parsePositiveInteger", () => {
  it("falls back when the value is missing, zero, or not an integer", () => {
    expect(parsePositiveInteger(undefined, 8)).toBe(8);
    expect(parsePositiveInteger("0", 8)).toBe(8);
    expect(parsePositiveInteger("nope", 8)).toBe(8);
    expect(parsePositiveInteger("6", 8)).toBe(6);
  });
});

describe("isTooManyDatabaseConnections", () => {
  it("recognises Prisma P2037 and Postgres 53300", () => {
    expect(isTooManyDatabaseConnections({ code: "P2037" })).toBe(true);
    expect(isTooManyDatabaseConnections({ code: "53300" })).toBe(true);
    expect(
      isTooManyDatabaseConnections(
        new Error("Too many database connections opened: sorry, too many clients already"),
      ),
    ).toBe(true);
    expect(isTooManyDatabaseConnections(new Error("relation does not exist"))).toBe(false);
    expect(isTooManyDatabaseConnections(undefined)).toBe(false);
  });

  it("walks a nested cause, matching the pg-pool unhandledRejection shape", () => {
    const root = Object.assign(new Error("sorry, too many clients already"), { code: "53300" });
    expect(isTooManyDatabaseConnections(new Error("pool.connect failed", { cause: root }))).toBe(
      true,
    );
  });
});

describe("retryOnTooManyConnections", () => {
  it("retries 53300 and returns the first success", async () => {
    const sleep = vi.fn(async () => undefined);
    let attempts = 0;
    const result = await retryOnTooManyConnections(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw Object.assign(new Error("sorry, too many clients already"), { code: "53300" });
        }
        return "ok";
      },
      { sleep },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated failures", async () => {
    const error = new Error("relation does not exist");
    await expect(
      retryOnTooManyConnections(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});

describe("createPool", () => {
  it("builds a bounded pool with connect-retry and idle-error listeners", () => {
    const pool = createPool("postgres://rakazo:rakazo@127.0.0.1:9/rakazo", {
      poolMax: 2,
      applicationName: "rakazo-pool-test",
    });
    pools.push(pool);
    expect(pool.options.max).toBe(2);
    expect(pool.options.connectionTimeoutMillis).toBe(10_000);
    expect(pool.options.idleTimeoutMillis).toBe(0);
    expect(pool.options.application_name).toBe("rakazo-pool-test");
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
    expect(pool.listenerCount("connect")).toBeGreaterThan(0);
    expect(() => pool.emit("error", new Error("idle client lost"))).not.toThrow();
  });
});

describe("transaction timing", () => {
  it("uses a ceiling that fits a database across the internet, not Prisma's local default", () => {
    const { timeout, maxWait } = transactionTimingFromEnv({});
    // Prisma's defaults are 5s and 2s; at those a slow moment fails a run outright and the
    // user reads "a query cannot be executed on an expired transaction" in their chat.
    expect(timeout).toBeGreaterThan(5_000);
    expect(maxWait).toBeGreaterThan(2_000);
    expect(timeout).toBeGreaterThan(maxWait);
  });

  it("can be tuned per deployment", () => {
    expect(
      transactionTimingFromEnv({
        DB_TRANSACTION_TIMEOUT_MS: "30000",
        DB_TRANSACTION_MAX_WAIT_MS: "7500",
      }),
    ).toEqual({ timeout: 30_000, maxWait: 7_500 });
  });

  it("ignores a value that would disable the ceiling", () => {
    for (const bad of ["0", "-1", "", "soon", "NaN"]) {
      const { timeout, maxWait } = transactionTimingFromEnv({
        DB_TRANSACTION_TIMEOUT_MS: bad,
        DB_TRANSACTION_MAX_WAIT_MS: bad,
      });
      expect(timeout).toBeGreaterThan(5_000);
      expect(maxWait).toBeGreaterThan(2_000);
    }
  });
});
