import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolClient } from "pg";
import { Pool } from "pg";
import { PrismaClient } from "./generated/prisma/client.js";

export type Db = PrismaClient;

export interface DbClientOptions {
  poolMax?: number;
  applicationName?: string;
  /** How long one interactive transaction may run before Prisma expires it. */
  transactionTimeoutMs?: number;
  /** How long a transaction may wait for a pooled connection before it starts. */
  transactionMaxWaitMs?: number;
}

const DEFAULT_POOL_MAX = 4;

/**
 * Prisma's own defaults are 5s and 2s, sized for a database on the same machine. Ours is
 * not: the API and worker run on a VPS and the database is hosted elsewhere, so a single
 * transaction - a lock, a few reads, a message and its events - is a dozen round trips
 * across the internet. At 5s a slow moment does not slow a run down, it fails it, and the
 * user reads "a query cannot be executed on an expired transaction" in their chat.
 *
 * These are a ceiling, not a budget. A transaction that needs this long is still a problem;
 * it just should not be the user's problem.
 */
const DEFAULT_TRANSACTION_TIMEOUT_MS = 20_000;
const DEFAULT_TRANSACTION_MAX_WAIT_MS = 10_000;

/** Positive integer from the environment, else the default. */
export function transactionTimingFromEnv(env: NodeJS.ProcessEnv = process.env): {
  timeout: number;
  maxWait: number;
} {
  const read = (name: string, fallback: number) => {
    const parsed = Number(env[name]);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  };
  return {
    timeout: read("DB_TRANSACTION_TIMEOUT_MS", DEFAULT_TRANSACTION_TIMEOUT_MS),
    maxWait: read("DB_TRANSACTION_MAX_WAIT_MS", DEFAULT_TRANSACTION_MAX_WAIT_MS),
  };
}
const CONNECT_RETRY_ATTEMPTS = 8;

export function createPool(connectionString: string, options: DbClientOptions = {}): Pool {
  const pool = new Pool({
    connectionString,
    max: options.poolMax ?? DEFAULT_POOL_MAX,
    // Fail a checkout instead of queueing forever when Postgres is already at
    // max_connections (53300) or the pool is saturated.
    connectionTimeoutMillis: 10_000,
    // 0 disables idle eviction. Dropping idle clients and reopening them on the
    // next job burst is how a tight Postgres hits 53300; keep what we already have.
    idleTimeoutMillis: 0,
    application_name: options.applicationName,
    keepAlive: true,
  });
  // graphile-worker (and Node itself) require an 'error' listener on a shared
  // pool: an idle-client disconnect is otherwise an unhandled error that kills
  // the process and orphans the TCP sessions until Postgres times them out.
  pool.on("error", () => undefined);
  pool.on("connect", (client) => {
    client.on("error", () => undefined);
  });
  installConnectRetry(pool);
  return pool;
}

export function createDb(
  connectionString: string,
  options: DbClientOptions = {},
): { prisma: PrismaClient; pool: Pool } {
  const pool = createPool(connectionString, options);
  const adapter = new PrismaPg(pool);
  const timing = transactionTimingFromEnv();
  const prisma = new PrismaClient({
    adapter,
    transactionOptions: {
      timeout: options.transactionTimeoutMs ?? timing.timeout,
      maxWait: options.transactionMaxWaitMs ?? timing.maxWait,
    },
  });
  return { prisma, pool };
}

export function isTooManyDatabaseConnections(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const code = "code" in current ? current.code : undefined;
    if (code === "P2037" || code === "53300") return true;
    const message = current instanceof Error ? current.message : String(current);
    if (
      message.includes("Too many database connections opened") ||
      message.includes("sorry, too many clients already")
    ) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

export async function retryOnTooManyConnections<T>(
  operation: () => Promise<T>,
  options: {
    attempts?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? CONNECT_RETRY_ATTEMPTS;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTooManyDatabaseConnections(error) || attempt >= attempts - 1) throw error;
      await sleep(Math.min(5_000, 200 * 2 ** attempt));
    }
  }
}

function installConnectRetry(pool: Pool): void {
  type ConnectCallback = (
    err: Error,
    client: PoolClient,
    done: (release?: boolean) => void,
  ) => void;
  const originalConnect = pool.connect.bind(pool) as {
    (): Promise<PoolClient>;
    (callback: ConnectCallback): void;
  };

  function connect(): Promise<PoolClient>;
  function connect(callback: ConnectCallback): void;
  function connect(callback?: ConnectCallback): Promise<PoolClient> | undefined {
    if (!callback) return retryOnTooManyConnections(() => originalConnect());
    const attempt = (n: number) => {
      originalConnect((err, client, done) => {
        if (err && isTooManyDatabaseConnections(err) && n < CONNECT_RETRY_ATTEMPTS - 1) {
          setTimeout(() => attempt(n + 1), Math.min(5_000, 200 * 2 ** n));
          return;
        }
        callback(err, client, done);
      });
    };
    attempt(0);
  }

  pool.connect = connect as Pool["connect"];
}

export function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export type { Pool } from "pg";
export * from "./generated/prisma/client.js";
export { Prisma, PrismaClient } from "./generated/prisma/client.js";
