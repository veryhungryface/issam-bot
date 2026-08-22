import { resolveAuthSecret, resolveEncryptionKey, resolveSupervisorToken } from "@rakazo/core";

export interface AppEnv {
  databaseUrl: string;
  realtimeDatabaseUrl: string;
  authSecret: string;
  authUrl: string;
  webOrigin: string;
  apiUrl: string;
  signupsEnabled: string | undefined;
  signupAllowlist: string | undefined;
  encryptionKey: string;
  dataDir: string;
  sandboxSupervisorUrl: string;
  sandboxSupervisorToken: string;
  sandboxProvider: string;
  agentRuntime: string;
  openAiKey: string | undefined;
  openRouterKey: string | undefined;
  deploymentModelKey: string | undefined;
  e2bApiKey: string | undefined;
  daytonaApiKey: string | undefined;
  daytonaApiUrl: string | undefined;
  daytonaTarget: string | undefined;
  boxApiKey: string | undefined;
  boxApiUrl: string | undefined;
  browserbaseApiKey: string | undefined;
  browserbaseProjectId: string | undefined;
  browserbaseTaskTimeoutSeconds: number | undefined;
  composioApiKey: string | undefined;
  defaultProvider: string;
  defaultModel: string;
  wakeupDriver: string;
  port: number;
  gitSha: string | undefined;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const authSecret = resolveAuthSecret(source);
  const defaultProvider = source.PI_DEFAULT_PROVIDER ?? "openrouter";
  const openAiKey = optional(source.OPENAI_API_KEY);
  const openRouterKey = optional(source.OPENROUTER_API_KEY);
  return {
    databaseUrl: required(source, "DATABASE_URL"),
    realtimeDatabaseUrl: source.REALTIME_DATABASE_URL ?? required(source, "DATABASE_URL"),
    authSecret,
    authUrl: source.BETTER_AUTH_URL ?? source.WEB_ORIGIN ?? "http://127.0.0.1:5173",
    webOrigin: source.WEB_ORIGIN ?? "http://127.0.0.1:5173",
    apiUrl: source.API_URL ?? "http://127.0.0.1:3100",
    signupsEnabled: source.SIGNUPS_ENABLED,
    signupAllowlist: source.SIGNUP_ALLOWLIST,
    encryptionKey: resolveEncryptionKey(source),
    dataDir: source.DATA_DIR ?? "./data",
    sandboxSupervisorUrl: source.SANDBOX_SUPERVISOR_URL ?? "http://127.0.0.1:7091",
    sandboxSupervisorToken: resolveSupervisorToken(source),
    sandboxProvider: source.SANDBOX_PROVIDER ?? "docker",
    agentRuntime: source.AGENT_RUNTIME ?? "pi",
    openAiKey,
    openRouterKey,
    deploymentModelKey: deploymentModelKeyForProvider(defaultProvider, {
      openAiKey,
      openRouterKey,
    }),
    e2bApiKey: source.E2B_API_KEY,
    daytonaApiKey: source.DAYTONA_API_KEY,
    daytonaApiUrl: source.DAYTONA_API_URL,
    daytonaTarget: source.DAYTONA_TARGET,
    boxApiKey: source.BOX_API_KEY,
    boxApiUrl: source.BOX_API_URL ?? source.BOX_BASE_URL,
    browserbaseApiKey: optional(source.BROWSERBASE_API_KEY),
    browserbaseProjectId: optional(source.BROWSERBASE_PROJECT_ID),
    browserbaseTaskTimeoutSeconds: optionalInteger(source.BROWSERBASE_TASK_TIMEOUT_SECONDS),
    composioApiKey: source.COMPOSIO_API_KEY,
    defaultProvider,
    defaultModel: source.PI_DEFAULT_MODEL ?? "deepseek/deepseek-v4-flash-0731",
    wakeupDriver: source.WAKEUP_DRIVER ?? "graphile",
    port: Number(source.API_PORT ?? 3100),
    gitSha: optional(source.GIT_SHA) ?? optional(source.RAKAZO_GIT_SHA),
  };
}

export function deploymentModelKeyForProvider(
  provider: string,
  keys: Pick<AppEnv, "openAiKey" | "openRouterKey">,
): string | undefined {
  switch (provider.trim().toLowerCase()) {
    case "openai":
      return keys.openAiKey;
    case "openrouter":
      return keys.openRouterKey;
    default:
      return undefined;
  }
}

function required(source: NodeJS.ProcessEnv, key: string): string {
  const value = source[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function optionalInteger(value: string | undefined): number | undefined {
  const trimmed = optional(value);
  if (trimmed === undefined) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) throw new Error(`Expected an integer, received "${trimmed}"`);
  return parsed;
}
