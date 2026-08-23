import type { JobPublisher, JobWorkerHost } from "@rakazo/adapter-kit";
import { loadRootEnv } from "@rakazo/core/node/load-root-env";

loadRootEnv();

import {
  type BrowserbaseRegion,
  createBackgroundJobHandlers,
  createConnectorStack,
  createJobReconciler,
  createPostgresReconciliationLeadership,
  createRunExecutor,
  createRunSandbox,
  deploymentApiKeyForProvider,
  EncryptedSecretStore,
  ExpoPushProvider,
  GraphileJobPublisher,
  GraphileJobWorkerHost,
  InMemoryJobQueue,
  isComposioEnabled,
  LocalAgentHomeStore,
  LocalArtifactStore,
  PiAgentRuntime,
  PostgresRealtimeFanout,
  ScriptedAgentRuntime,
} from "@rakazo/adapters";
import { resolveEncryptionKey } from "@rakazo/core";
import { createDb, createThreadEvents } from "@rakazo/db";
import { MarkdownMemoryStore } from "@rakazo/memory";

function browserbaseRegion(value: string | undefined): BrowserbaseRegion {
  const region = value?.trim() || "ap-southeast-1";
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

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const { prisma, pool } = createDb(databaseUrl);
  const realtime = new PostgresRealtimeFanout({
    connectionString: process.env.REALTIME_DATABASE_URL ?? databaseUrl,
    publisher: pool,
  });
  const events = createThreadEvents(prisma, realtime);
  const defaultModelProvider = process.env.PI_DEFAULT_PROVIDER ?? "openrouter";
  const defaultModelId = process.env.PI_DEFAULT_MODEL ?? "deepseek/deepseek-v4-flash-0731";
  const deploymentModelKey = deploymentApiKeyForProvider(defaultModelProvider);
  const runtime =
    process.env.AGENT_RUNTIME === "scripted" ? new ScriptedAgentRuntime() : new PiAgentRuntime();
  const dataDir = process.env.DATA_DIR ?? "./data";
  const sandbox = createRunSandbox(process.env.SANDBOX_PROVIDER ?? "docker", {
    supervisorUrl: process.env.SANDBOX_SUPERVISOR_URL ?? "http://127.0.0.1:7091",
    e2bApiKey: process.env.E2B_API_KEY,
    daytonaApiKey: process.env.DAYTONA_API_KEY,
    daytonaApiUrl: process.env.DAYTONA_API_URL,
    daytonaTarget: process.env.DAYTONA_TARGET,
    boxApiKey: process.env.BOX_API_KEY,
    boxApiUrl: process.env.BOX_API_URL ?? process.env.BOX_BASE_URL,
    browserbaseApiKey: process.env.BROWSERBASE_API_KEY,
    browserbaseProjectId: process.env.BROWSERBASE_PROJECT_ID,
    browserbaseTaskTimeoutSeconds: process.env.BROWSERBASE_TASK_TIMEOUT_SECONDS
      ? Number(process.env.BROWSERBASE_TASK_TIMEOUT_SECONDS)
      : undefined,
    browserbaseRegion: browserbaseRegion(process.env.BROWSERBASE_REGION),
    dataDir,
    prisma,
  });
  const stack = createConnectorStack(isComposioEnabled(process.env.COMPOSIO_API_KEY));
  const connector = stack.destination;
  await connector.start();
  const secrets = new EncryptedSecretStore(resolveEncryptionKey(process.env));
  const home = new LocalAgentHomeStore(dataDir);
  const artifacts = new LocalArtifactStore(dataDir);
  const inMemoryJobs = process.env.WAKEUP_DRIVER === "memory" ? new InMemoryJobQueue() : undefined;
  const jobs: JobPublisher = inMemoryJobs ?? new GraphileJobPublisher(databaseUrl);
  const jobHost: JobWorkerHost = inMemoryJobs ?? new GraphileJobWorkerHost(databaseUrl);
  const executor = createRunExecutor({
    prisma,
    runtime,
    sandbox,
    memory: new MarkdownMemoryStore(prisma),
    home,
    artifacts,
    connector: stack.connector,
    listConnectedPluginSlugs: stack.composio?.listConnectedSlugs.bind(stack.composio),
    secrets: [
      process.env.OPENAI_API_KEY ?? "",
      process.env.OPENROUTER_API_KEY ?? "",
      process.env.COMPOSIO_API_KEY ?? "",
    ].filter(Boolean),
    secretStore: secrets,
    deploymentModelKey,
    deploymentModelProvider: defaultModelProvider,
    deploymentModelId: defaultModelId,
    dataDir,
    notifications: new ExpoPushProvider(dataDir),
    jobs,
    events,
  });

  const jobHandlers = createBackgroundJobHandlers({
    executor,
    prisma,
    sandbox,
    home,
    jobs,
    events,
    workerId: process.pid.toString(),
    runtime,
    deploymentModelKey,
    deploymentModelProvider: defaultModelProvider,
    deploymentModelId: defaultModelId,
  });
  await jobHost.start(jobHandlers);
  const reconciler = createJobReconciler({
    prisma,
    jobs,
    leadership: createPostgresReconciliationLeadership(pool),
  });
  reconciler.start();

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await reconciler.stop();
    await jobHost.stop();
    await jobs.close();
    await realtime.close();
    await connector.stop();
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());

  console.log("rakazo worker ready");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
