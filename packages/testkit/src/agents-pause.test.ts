import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AGENTS_PAUSED_REFUSED_MESSAGE, AGENTS_PAUSED_STOPPED_MESSAGE } from "@rakazo/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

process.env.WAKEUP_DRIVER = "memory";
process.env.SANDBOX_PROVIDER = "fake";
process.env.AGENT_RUNTIME = "scripted";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeIntegration = hasDb ? describe : describe.skip;

type Handles = Awaited<ReturnType<typeof import("../../../apps/api/src/app.ts")["createApp"]>>;
type PauseResult = {
  deployment: { agentsPausedAt: string | null };
  cancelledRuns: number;
  sleepingComputers: number;
};

/**
 * The emergency stop is global, so this file owns the switch while it runs and always turns it
 * back off: integration files run one after another against the same database.
 */
describeIntegration("emergency stop", () => {
  let handles: Handles;
  const dataDir = mkdtempSync(path.join(tmpdir(), "rakazo-agents-pause-"));
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let owner: { cookie: string; userId: string; spaceId: string };
  let previousOwnerUserId: string | null = null;

  beforeAll(async () => {
    const { createApp } = await import("../../../apps/api/src/app.ts");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      defaultProvider: "scripted",
      defaultModel: "scripted",
    });
    owner = await member("owner");
    const settings = await handles.prisma.deploymentSettings.findUnique({
      where: { id: "default" },
    });
    previousOwnerUserId = settings?.ownerUserId ?? null;
    await handles.prisma.deploymentSettings.upsert({
      where: { id: "default" },
      create: { id: "default", ownerUserId: owner.userId },
      update: { ownerUserId: owner.userId },
    });
  });

  afterEach(async () => {
    await handles.prisma.deploymentSettings.updateMany({
      where: { id: "default" },
      data: { agentsPausedAt: null, agentsPausedBy: null },
    });
  });

  afterAll(async () => {
    await handles?.prisma.deploymentSettings.updateMany({
      where: { id: "default" },
      data: { ownerUserId: previousOwnerUserId, agentsPausedAt: null, agentsPausedBy: null },
    });
    await handles?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("is the deployment owner's switch alone", async () => {
    const someone = await member("someone");
    await expect(
      rpc(someone.cookie, "deployment/setAgentsPaused", { paused: true }),
    ).rejects.toThrow();
    const settings = await handles.prisma.deploymentSettings.findUniqueOrThrow({
      where: { id: "default" },
    });
    expect(settings.agentsPausedAt).toBeNull();
  });

  it("cancels active work in every space and says why in each thread", async () => {
    const waiting = await seedRun(await member("waiting"), "waiting_input");
    const queued = await seedRun(await member("queued"), "queued");
    const computer = await handles.prisma.bot.findUniqueOrThrow({
      where: { id: waiting.botId },
      select: { computerId: true },
    });
    await handles.prisma.computerExecutionLease.create({
      data: {
        computerId: computer.computerId!,
        botId: waiting.botId,
        runId: waiting.runId,
        fence: 1,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });

    const result = await rpc<PauseResult>(owner.cookie, "deployment/setAgentsPaused", {
      paused: true,
    });

    expect(result.deployment.agentsPausedAt).not.toBeNull();
    // Other files may have left work behind in this database; ours is at least these two.
    expect(result.cancelledRuns).toBeGreaterThanOrEqual(2);
    for (const seeded of [waiting, queued]) {
      const run = await handles.prisma.run.findUniqueOrThrow({ where: { id: seeded.runId } });
      expect(run.status).toBe("cancelled");
      // The error is what tells this cancel apart from a Stop press, which leaves it empty.
      expect(run.error).toBe(AGENTS_PAUSED_STOPPED_MESSAGE);
      const task = await handles.prisma.task.findUniqueOrThrow({ where: { id: seeded.taskId } });
      expect(task.status).toBe("cancelled");
      const last = await handles.prisma.message.findFirstOrThrow({
        where: { threadId: seeded.threadId },
        orderBy: { seq: "desc" },
      });
      expect(last.role).toBe("system");
      expect(JSON.stringify(last.blocks)).toContain(AGENTS_PAUSED_STOPPED_MESSAGE);
    }
    const lease = await handles.prisma.computerExecutionLease.findFirstOrThrow({
      where: { runId: waiting.runId },
    });
    expect(lease.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("answers a message sent while stopped with the reason instead of running it", async () => {
    const sender = await member("sender");
    const bot = await createBot(sender.cookie, "sender");
    await rpc(owner.cookie, "deployment/setAgentsPaused", { paused: true });

    const { runId } = await rpc<{ runId: string }>(sender.cookie, "threads/send", {
      botId: bot.id,
      text: "hello",
    });
    const run = await settledRun(runId);

    expect(run.status).toBe("cancelled");
    expect(run.error).toBe(AGENTS_PAUSED_REFUSED_MESSAGE);
    const messages = await handles.prisma.message.findMany({
      where: { runId: null, thread: { botId: bot.id } },
      orderBy: { seq: "asc" },
    });
    expect(JSON.stringify(messages.at(-1)?.blocks)).toContain(AGENTS_PAUSED_REFUSED_MESSAGE);
    // The model never ran: no bot reply belongs to this run.
    expect(await handles.prisma.message.count({ where: { runId, role: "bot" } })).toBe(0);
  });

  it("skips a routine slot that comes due while stopped, and keeps the routine armed", async () => {
    const scheduler = await member("routine");
    const bot = await createBot(scheduler.cookie, "routine");
    const thread = await handles.prisma.thread.findUniqueOrThrow({ where: { botId: bot.id } });
    const scheduledFor = new Date(Date.now() - 60_000);
    const routine = await handles.prisma.routine.create({
      data: {
        spaceId: scheduler.spaceId,
        botId: bot.id,
        userId: scheduler.userId,
        threadId: thread.id,
        name: "Daily summary",
        prompt: "Summarise the day",
        crons: ["0 9 * * *"],
        timezone: "Asia/Seoul",
        active: true,
        nextRunAt: scheduledFor,
      },
    });
    await rpc(owner.cookie, "deployment/setAgentsPaused", { paused: true });

    await handles.executor.wakeRoutine(routine.id, scheduledFor.toISOString());

    expect(await handles.prisma.run.count({ where: { routineId: routine.id } })).toBe(0);
    const after = await handles.prisma.routine.findUniqueOrThrow({ where: { id: routine.id } });
    expect(after.active).toBe(true);
    expect(after.nextRunAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it("lets work start again once it is turned off, replaying nothing", async () => {
    const sender = await member("resumed");
    const bot = await createBot(sender.cookie, "resumed");
    await rpc(owner.cookie, "deployment/setAgentsPaused", { paused: true });
    const { runId: refusedRunId } = await rpc<{ runId: string }>(sender.cookie, "threads/send", {
      botId: bot.id,
      text: "first",
    });
    await settledRun(refusedRunId);

    const resumed = await rpc<PauseResult>(owner.cookie, "deployment/setAgentsPaused", {
      paused: false,
    });
    expect(resumed.deployment.agentsPausedAt).toBeNull();
    const { runId } = await rpc<{ runId: string }>(sender.cookie, "threads/send", {
      botId: bot.id,
      text: "hello again",
    });

    expect((await settledRun(runId)).status).toBe("completed");
    // The refused request stays refused; turning the stop off does not run it after all.
    const refused = await handles.prisma.run.findUniqueOrThrow({ where: { id: refusedRunId } });
    expect(refused.status).toBe("cancelled");
  });

  async function settledRun(runId: string) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const run = await handles.prisma.run.findUnique({ where: { id: runId } });
      if (run && ["completed", "failed", "cancelled"].includes(run.status)) return run;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`timeout waiting for run ${runId} to settle`);
  }

  async function seedRun(
    who: { cookie: string; userId: string; spaceId: string },
    status: "queued" | "waiting_input",
  ) {
    const bot = await createBot(who.cookie, `${status}-${who.userId}`);
    const thread = await handles.prisma.thread.findUniqueOrThrow({ where: { botId: bot.id } });
    const task = await handles.prisma.task.create({
      data: {
        spaceId: who.spaceId,
        botId: bot.id,
        threadId: thread.id,
        userId: who.userId,
        prompt: "work",
        status: status === "queued" ? "queued" : "running",
      },
    });
    const run = await handles.prisma.run.create({
      data: {
        spaceId: who.spaceId,
        botId: bot.id,
        threadId: thread.id,
        taskId: task.id,
        userId: who.userId,
        status,
        trigger: "user",
        ...(status === "queued" ? {} : { startedAt: new Date() }),
      },
    });
    return { botId: bot.id, threadId: thread.id, taskId: task.id, runId: run.id };
  }

  async function createBot(cookie: string, name: string) {
    return rpc<{ id: string }>(cookie, "bots/create", {
      name: `Pause ${name}`.slice(0, 40),
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: false,
    });
  }

  async function member(label: string) {
    const cookie = await signup(`pause-${label}-${stamp}@rakazo.test`, `Pause ${label}`);
    const me = await rpc<{ userId: string; spaceId: string }>(cookie, "me");
    return { cookie, userId: me.userId, spaceId: me.spaceId };
  }

  async function signup(email: string, name: string) {
    const response = await handles.app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ email, password: "password12", name }),
    });
    expect(response.status).toBeLessThan(400);
    const raw = response.headers.get("set-cookie") ?? "";
    const match = raw.match(/better-auth\.session_token=([^;]+)/);
    expect(match?.[1]).toBeTruthy();
    return `better-auth.session_token=${match![1]}`;
  }

  async function rpc<T>(cookie: string, procedure: string, body: unknown = {}): Promise<T> {
    const response = await handles.app.request(`/rpc/${procedure}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173", cookie },
      body: JSON.stringify({ json: body }),
    });
    const payload = (await response.json()) as { json?: T; error?: { message?: string } };
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message ?? `${procedure} failed (${response.status})`);
    }
    return payload.json as T;
  }
});
