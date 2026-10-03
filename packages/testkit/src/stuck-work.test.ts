import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { JobPublisher } from "@rakazo/adapter-kit";
import { reconcileStuckWork } from "@rakazo/adapters";
import {
  STUCK_WORK_EXPIRE_AFTER_MS,
  STUCK_WORK_NOTIFY_AFTER_MS,
  stuckWorkStatusMessage,
} from "@rakazo/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.WAKEUP_DRIVER = "memory";
process.env.SANDBOX_PROVIDER = "fake";
process.env.AGENT_RUNTIME = "scripted";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeIntegration = hasDb ? describe : describe.skip;

/**
 * The production failure this guards: a sign-in sheet nobody filled in left the run
 * waiting_input forever. The thread looked busy, the computer lease was never released,
 * and the user was told nothing after the notification they had already missed.
 */
describeIntegration("stuck work is reminded and then given back", () => {
  let handles: Awaited<ReturnType<typeof import("../../../apps/api/src/app.ts")["createApp"]>>;
  const dataDir = mkdtempSync(path.join(tmpdir(), "rakazo-stuck-work-"));
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
  });

  afterAll(async () => {
    await handles?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("leaves a young wait alone", async () => {
    const seeded = await seedWaitingRun("young", { ageMs: 60_000 });

    await sweep();

    const run = await handles.prisma.run.findUniqueOrThrow({ where: { id: seeded.run.id } });
    expect(run.status).toBe("waiting_input");
  });

  it("reminds a four-hour wait once, and only once for that episode", async () => {
    const seeded = await seedWaitingRun("remind", { ageMs: STUCK_WORK_NOTIFY_AFTER_MS + 60_000 });

    await sweep();
    await sweep();

    const run = await handles.prisma.run.findUniqueOrThrow({ where: { id: seeded.run.id } });
    // Reminding does not end the wait: the user can still answer.
    expect(run.status).toBe("waiting_input");
    const notices = await handles.prisma.event.findMany({
      where: { runId: seeded.run.id, type: "thread.meta" },
    });
    // No push recipient is registered in tests, so the sweep must not claim a reminder it
    // could not deliver - that is what keeps it remindable once a device exists.
    expect(notices).toHaveLength(0);
  });

  it("cancels a day-old wait, says so in the thread, and frees the computer", async () => {
    const seeded = await seedWaitingRun("expire", { ageMs: STUCK_WORK_EXPIRE_AFTER_MS + 60_000 });
    const computer = await handles.prisma.bot.findUniqueOrThrow({
      where: { id: seeded.bot.id },
      select: { computerId: true },
    });
    await handles.prisma.computerExecutionLease.create({
      data: {
        computerId: computer.computerId!,
        botId: seeded.bot.id,
        runId: seeded.run.id,
        fence: 1,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });

    await sweep();

    const run = await handles.prisma.run.findUniqueOrThrow({ where: { id: seeded.run.id } });
    expect(run.status).toBe("cancelled");
    // The status line doubles as the marker that tells a stuck cancel from a user's Stop.
    expect(run.error).toBe(stuckWorkStatusMessage("waiting_input"));
    expect(run.completedAt).not.toBeNull();

    const messages = await handles.prisma.message.findMany({
      where: { threadId: seeded.thread.id },
      orderBy: { seq: "asc" },
    });
    expect(messages.at(-1)).toMatchObject({ role: "system" });
    expect(JSON.stringify(messages.at(-1)?.blocks)).toContain(
      stuckWorkStatusMessage("waiting_input"),
    );

    const lease = await handles.prisma.computerExecutionLease.findFirstOrThrow({
      where: { runId: seeded.run.id },
    });
    expect(lease.expiresAt.getTime()).toBe(0);
    const task = await handles.prisma.task.findUniqueOrThrow({ where: { id: seeded.task.id } });
    expect(task.status).toBe("cancelled");
  });

  it("closes the sign-in sheet it gave up on", async () => {
    const seeded = await seedWaitingRun("sheet", { ageMs: STUCK_WORK_EXPIRE_AFTER_MS + 60_000 });
    const sheet = await handles.prisma.message.create({
      data: {
        threadId: seeded.thread.id,
        seq: 800,
        role: "bot",
        botId: seeded.bot.id,
        runId: seeded.run.id,
        blocks: [
          {
            kind: "browser_login",
            title: "포털 로그인",
            origin: "https://portal.example",
            fields: [{ id: "username", label: "아이디" }],
            status: "pending",
          },
        ],
      },
    });

    await sweep();

    const closed = await handles.prisma.message.findUniqueOrThrow({ where: { id: sheet.id } });
    // Still "pending" it would read "조치 필요" forever while accepting nothing.
    expect(JSON.stringify(closed.blocks)).toContain('"status":"cancelled"');
  });

  it("runs what the user typed into the wait instead of dropping it", async () => {
    const seeded = await seedWaitingRun("steering", {
      ageMs: STUCK_WORK_EXPIRE_AFTER_MS + 60_000,
    });
    const message = await handles.prisma.message.create({
      data: {
        threadId: seeded.thread.id,
        seq: 900,
        role: "user",
        blocks: [{ kind: "text", text: "actually, never mind the portal" }],
      },
    });
    await handles.prisma.steeringMessage.create({
      data: {
        botId: seeded.bot.id,
        userId: seeded.userId,
        messageId: message.id,
        runId: seeded.run.id,
      },
    });

    const enqueue = await sweep();

    const continuation = await handles.prisma.run.findFirst({
      where: { threadId: seeded.thread.id, status: "queued", trigger: "follow_up" },
    });
    expect(continuation).not.toBeNull();
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ replaceKey: `run:${continuation!.id}` }),
    );
  });

  async function sweep() {
    const enqueue = vi.fn(async () => undefined);
    const jobs: JobPublisher = {
      enqueue,
      cancel: async () => undefined,
      close: async () => undefined,
    };
    await reconcileStuckWork({
      prisma: handles.prisma,
      jobs,
      events: handles.events,
      now: new Date(),
      batchSize: 50,
    });
    return enqueue;
  }

  async function seedWaitingRun(label: string, options: { ageMs: number }) {
    const cookie = await signup(`stuck-${label}-${stamp}@rakazo.test`, `Stuck ${label}`);
    const me = await rpc<{ userId: string; spaceId: string }>(cookie, "me");
    const bot = await rpc<{ id: string }>(cookie, "bots/create", {
      name: `Stuck ${label}`,
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const thread = await handles.prisma.thread.findUniqueOrThrow({ where: { botId: bot.id } });
    const task = await handles.prisma.task.create({
      data: {
        spaceId: me.spaceId,
        botId: bot.id,
        threadId: thread.id,
        userId: me.userId,
        prompt: "sign in to the portal",
        status: "running",
      },
    });
    const run = await handles.prisma.run.create({
      data: {
        spaceId: me.spaceId,
        botId: bot.id,
        threadId: thread.id,
        taskId: task.id,
        userId: me.userId,
        status: "waiting_input",
        trigger: "user",
        startedAt: new Date(Date.now() - options.ageMs),
      },
    });
    // updatedAt is the episode clock, and Prisma owns it on write: age it directly.
    const waitingSince = new Date(Date.now() - options.ageMs);
    await handles.prisma
      .$executeRaw`UPDATE runs SET "updatedAt" = ${waitingSince} WHERE id = ${run.id}`;
    const aged = await handles.prisma.run.findUniqueOrThrow({ where: { id: run.id } });
    return { cookie, userId: me.userId, bot, thread, task, run: aged };
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
