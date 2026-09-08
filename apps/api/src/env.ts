import {
  type BrowserbaseRegion,
  resolveCloudAgentProvider,
  resolveDeploymentModel,
  resolveSandboxProvider,
} from "@rakazo/adapters";
import {
  resolveAuthSecret,
  resolveEncryptionKey,
  resolveScreenProxySecret,
  resolveSupervisorToken,
} from "@rakazo/core";

export { resolveCloudAgentProvider, resolveSandboxProvider } from "@rakazo/adapters";

export interface AppEnv {
  nodeEnv: string;
  databaseUrl: string;
  realtimeDatabaseUrl: string;
  authSecret: string;
  authUrl: string;
  webOrigin: string;
  apiUrl: string;
  apiHost: string;
  signupsEnabled: string | undefined;
  signupAllowlist: string | undefined;
  encryptionKey: string;
  dataDir: string;
  sandboxSupervisorUrl: string;
  sandboxSupervisorToken: string | undefined;
  screenProxySecret: string;
  sandboxProvider: string;
  cloudAgentProvider: string;
  cloudAgentSpaceId: string | undefined;
  cursorApiKey: string | undefined;
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
  browserbaseRegion: BrowserbaseRegion;
  browserbaseProxyCountry: string | undefined;
  browserbaseSolveCaptchas: boolean;
  composioApiKey: string | undefined;
  pipedreamClientId: string | undefined;
  pipedreamClientSecret: string | undefined;
  pipedreamProjectId: string | undefined;
  pipedreamEnvironment: "development" | "production";
  sendblueApiKeyId: string | undefined;
  sendblueApiSecret: string | undefined;
  sendblueSigningSecret: string | undefined;
  sendbluePhoneNumber: string | undefined;
  smtpUrl: string | undefined;
  emailFrom: string | undefined;
  emailEmulator: boolean;
  slackBotToken: string | undefined;
  slackSigningSecret: string | undefined;
  whatsappAccessToken: string | undefined;
  whatsappPhoneNumberId: string | undefined;
  whatsappAppSecret: string | undefined;
  whatsappVerifyToken: string | undefined;
  telegramBotToken: string | undefined;
  telegramWebhookSecret: string | undefined;
  larkAppId: string | undefined;
  larkAppSecret: string | undefined;
  larkVerificationToken: string | undefined;
  larkEncryptKey: string | undefined;
  larkDomain: string | undefined;
  /** Unknown chat senders auto-provision their own accounts when true. */
  messagingOpenSignup: boolean;
  defaultProvider: string;
  defaultModel: string;
  wakeupDriver: string;
  mcpStdioEnabled: boolean;
  mcpStdioAllowedCommands: string[];
  port: number;
  gitSha: string | undefined;
  /** Private Compose control-network URL for the opt-in updater sidecar. */
  updaterUrl: string | undefined;
  /** Bearer shared with the updater; never sent to the browser. */
  updaterToken: string | undefined;
  /** Current application image tag; used for compose manual-upgrade command selection. */
  imageTag: string | undefined;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const authSecret = resolveAuthSecret(source);
  const openAiKey = optional(source.OPENAI_API_KEY);
  const openRouterKey = optional(source.OPENROUTER_API_KEY);
  const sandboxProvider = resolveSandboxProvider(source);
  const cloudAgentProvider = resolveCloudAgentProvider(source);
  const deploymentModel = resolveDeploymentModel(source);
  const updaterUrl = optional(source.RAKAZO_UPDATER_URL);
  const updaterToken = optional(source.RAKAZO_UPDATER_TOKEN);
  return {
    nodeEnv: source.NODE_ENV ?? "",
    databaseUrl: required(source, "DATABASE_URL"),
    realtimeDatabaseUrl: source.REALTIME_DATABASE_URL ?? required(source, "DATABASE_URL"),
    authSecret,
    authUrl: source.BETTER_AUTH_URL ?? source.WEB_ORIGIN ?? "http://127.0.0.1:5173",
    webOrigin: source.WEB_ORIGIN ?? "http://127.0.0.1:5173",
    apiUrl: source.API_URL ?? "http://127.0.0.1:3100",
    apiHost: source.API_HOST ?? "127.0.0.1",
    signupsEnabled: source.SIGNUPS_ENABLED,
    signupAllowlist: source.SIGNUP_ALLOWLIST,
    encryptionKey: resolveEncryptionKey(source),
    dataDir: source.DATA_DIR ?? "./data",
    sandboxSupervisorUrl: source.SANDBOX_SUPERVISOR_URL ?? "http://127.0.0.1:7091",
    sandboxSupervisorToken:
      sandboxProvider === "docker" ? resolveSupervisorToken(source) : undefined,
    screenProxySecret: resolveScreenProxySecret(source),
    sandboxProvider,
    cloudAgentProvider,
    cloudAgentSpaceId: optional(source.CLOUD_AGENT_SPACE_ID),
    cursorApiKey: optional(source.CURSOR_API_KEY),
    agentRuntime: source.AGENT_RUNTIME ?? "pi",
    openAiKey,
    openRouterKey,
    // Provider, model and key resolve together: see resolveDeploymentModel.
    deploymentModelKey: deploymentModel.key,
    e2bApiKey: source.E2B_API_KEY,
    daytonaApiKey: source.DAYTONA_API_KEY,
    daytonaApiUrl: source.DAYTONA_API_URL,
    daytonaTarget: source.DAYTONA_TARGET,
    boxApiKey: source.BOX_API_KEY,
    boxApiUrl: source.BOX_API_URL ?? source.BOX_BASE_URL,
    browserbaseApiKey: optional(source.BROWSERBASE_API_KEY),
    browserbaseProjectId: optional(source.BROWSERBASE_PROJECT_ID),
    browserbaseTaskTimeoutSeconds: optionalInteger(source.BROWSERBASE_TASK_TIMEOUT_SECONDS),
    browserbaseRegion: browserbaseRegion(source.BROWSERBASE_REGION),
    browserbaseProxyCountry: optional(source.BROWSERBASE_PROXY_COUNTRY)?.toUpperCase(),
    browserbaseSolveCaptchas: source.BROWSERBASE_SOLVE_CAPTCHAS !== "false",
    composioApiKey: source.COMPOSIO_API_KEY,
    pipedreamClientId: optional(source.PIPEDREAM_CLIENT_ID),
    pipedreamClientSecret: optional(source.PIPEDREAM_CLIENT_SECRET),
    pipedreamProjectId: optional(source.PIPEDREAM_PROJECT_ID),
    pipedreamEnvironment:
      source.PIPEDREAM_ENVIRONMENT === "production" ? "production" : "development",
    sendblueApiKeyId: optional(source.SENDBLUE_API_KEY_ID),
    sendblueApiSecret: optional(source.SENDBLUE_API_SECRET),
    sendblueSigningSecret: optional(source.SENDBLUE_SIGNING_SECRET),
    sendbluePhoneNumber: optional(source.SENDBLUE_PHONE_NUMBER),
    smtpUrl: optional(source.SMTP_URL),
    emailFrom: optional(source.EMAIL_FROM),
    emailEmulator: source.EMAIL_EMULATOR === "true" && source.NODE_ENV !== "production",
    slackBotToken: optional(source.SLACK_BOT_TOKEN),
    slackSigningSecret: optional(source.SLACK_SIGNING_SECRET),
    whatsappAccessToken: optional(source.WHATSAPP_ACCESS_TOKEN),
    whatsappPhoneNumberId: optional(source.WHATSAPP_PHONE_NUMBER_ID),
    whatsappAppSecret: optional(source.WHATSAPP_APP_SECRET),
    whatsappVerifyToken: optional(source.WHATSAPP_VERIFY_TOKEN),
    telegramBotToken: optional(source.TELEGRAM_BOT_TOKEN),
    telegramWebhookSecret: optional(source.TELEGRAM_WEBHOOK_SECRET_TOKEN),
    larkAppId: optional(source.LARK_APP_ID),
    larkAppSecret: optional(source.LARK_APP_SECRET),
    larkVerificationToken: optional(source.LARK_VERIFICATION_TOKEN),
    larkEncryptKey: optional(source.LARK_ENCRYPT_KEY),
    larkDomain: optional(source.LARK_DOMAIN),
    messagingOpenSignup: source.MESSAGING_OPEN_SIGNUP === "true",
    defaultProvider: deploymentModel.provider,
    defaultModel: deploymentModel.model,
    wakeupDriver: source.WAKEUP_DRIVER ?? "graphile",
    mcpStdioEnabled: source.MCP_STDIO_ENABLED === "true",
    mcpStdioAllowedCommands: (source.MCP_STDIO_ALLOWED_COMMANDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    port: Number(source.API_PORT ?? 3100),
    gitSha: optional(source.GIT_SHA) ?? optional(source.RAKAZO_GIT_SHA),
    updaterUrl,
    updaterToken,
    imageTag: optional(source.RAKAZO_IMAGE_TAG),
  };
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

function browserbaseRegion(value: string | undefined): BrowserbaseRegion {
  const region = optional(value) ?? "ap-southeast-1";
  if (
    region !== "us-west-2" &&
    region !== "us-east-1" &&
    region !== "eu-central-1" &&
    region !== "ap-southeast-1"
  ) {
    throw new Error(`Unsupported Browserbase region "${region}"`);
  }
  return region;
}
