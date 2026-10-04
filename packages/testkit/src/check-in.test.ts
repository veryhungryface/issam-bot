import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkInTimeZone } from "@rakazo/adapters";
import { CHECK_IN_ROUTINE_KIND, checkInCrons, checkInRoutineId } from "@rakazo/core";
import { createThreadMessage } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.WAKEUP_DRIVER = "memory";
process.env.SANDBOX_PROVIDER = "fake";
process.env.AGENT_RUNTIME = "scripted";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeIntegration = hasDb ? describe : describe.skip;

/** Long enough that the check-in gate does not read the thread as still live. */
const STALE_CONVERSATION_MS = 3 * 24 * 60 * 60_000;

/** Past the follow-up threshold, well short of the question going stale. */
const UNANSWERED_FOR_MS = 5 * 60 * 60_000;

describeIntegration("bot check-ins", () => {
  let handles: Awaited<ReturnType<typeof import("../../../apps/api/src/app.ts")["createApp"]>>;
  const dataDir = mkdtempSync(path.join(tmpdir(), "rakazo-check-in-"));
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

  it("writes no message and boots no computer when it has nothing to say", async () => {
    const seeded = await seedCheckIn("silent", "Thanks, that is all for today.");

    await handles.executor.wakeRoutine(seeded.routineId, seeded.scheduledFor.toISOString());
    const finished = await settledCheckInRun(seeded.routineId);

    const [messages, thread, computer] = await Promise.all([
      handles.prisma.message.count({ where: { threadId: seeded.threadId } }),
      handles.prisma.thread.findUniqueOrThrow({ where: { id: seeded.threadId } }),
      handles.prisma.computer.findUniqueOrThrow({ where: { id: seeded.computerId } }),
    ]);
    expect(finished.status).toBe("completed");
    // The seeded conversation is all that is in the thread: silence left no bubble.
    expect(messages).toBe(seeded.messageCount);
    expect(thread.unread).toBe(false);
    // A cold remote browser costs about eight seconds and a billed session. A
    // check-in that decided not to speak must not have paid for one.
    expect(computer.state).toBe(seeded.computerState);
    expect(computer.providerRef).toBe(seeded.computerProviderRef);
  });

  it("posts exactly one message when it has something specific to say", async () => {
    const seeded = await seedCheckIn("speaks", "The lesson plan draft is done, right?");

    await handles.executor.wakeRoutine(seeded.routineId, seeded.scheduledFor.toISOString());
    const finished = await settledCheckInRun(seeded.routineId);

    const [posted, thread] = await Promise.all([
      handles.prisma.message.findMany({
        where: { threadId: seeded.threadId, runId: finished.id },
        orderBy: { seq: "asc" },
      }),
      handles.prisma.thread.findUniqueOrThrow({ where: { id: seeded.threadId } }),
    ]);
    expect(finished.status).toBe("completed");
    expect(posted).toHaveLength(1);
    expect(posted[0]?.blocks).toEqual([
      { kind: "text", text: "The lesson plan draft is finished and waiting for your review." },
    ]);
    // Speaking is the case that should reach the user, so unread is right here.
    expect(thread.unread).toBe(true);
  });

  it("skips the run entirely during quiet hours, and keeps the schedule armed", async () => {
    // Quiet from this very hour, so the check is "at night" whenever CI runs.
    const nowHour = new Date().getUTCHours();
    const seeded = await seedCheckIn("quiet", "Anything new?", {
      quietStartHour: nowHour,
      quietEndHour: (nowHour + 1) % 24,
    });

    await handles.executor.wakeRoutine(seeded.routineId, seeded.scheduledFor.toISOString());

    await noCheckInRun(seeded.routineId);
    const routine = await handles.prisma.routine.findUniqueOrThrow({
      where: { id: seeded.routineId },
    });
    expect(routine.active).toBe(true);
    expect(routine.nextRunAt?.getTime()).toBeGreaterThan(seeded.scheduledFor.getTime());
  });

  it("skips the run when the bot has noticed nothing at all", async () => {
    const seeded = await seedCheckIn("nothing", "Anything new?", { scratchpad: false });

    await handles.executor.wakeRoutine(seeded.routineId, seeded.scheduledFor.toISOString());

    await noCheckInRun(seeded.routineId);
    const routine = await handles.prisma.routine.findUniqueOrThrow({
      where: { id: seeded.routineId },
    });
    expect(routine.nextRunAt?.getTime()).toBeGreaterThan(seeded.scheduledFor.getTime());
  });

  it("follows up once on a question the user walked away from", async () => {
    const seeded = await seedCheckIn("follow-up", "Find me a flat in Sydney.", {
      scratchpad: false,
      botQuestion: "Which suburb should I search first?",
    });

    await handles.executor.wakeRoutine(seeded.routineId, seeded.scheduledFor.toISOString());
    const finished = await settledCheckInRun(seeded.routineId);

    const posted = await handles.prisma.message.findMany({
      where: { threadId: seeded.threadId, runId: finished.id },
    });
    expect(finished.status).toBe("completed");
    // The scripted judgment only speaks when the prompt carried the question.
    expect(posted.map((message) => message.blocks)).toEqual([
      [{ kind: "text", text: "Still need one answer from you before I go on." }],
    ]);

    // The same unanswered question does not earn a second wake, even after the
    // speak gap: the check-in already judged it.
    const again = await rearm(seeded.routineId);
    await handles.prisma.message.updateMany({
      where: {
        threadId: seeded.threadId,
        createdAt: { gt: new Date(Date.now() - UNANSWERED_FOR_MS) },
      },
      data: { createdAt: new Date(Date.now() - UNANSWERED_FOR_MS) },
    });
    await handles.executor.wakeRoutine(seeded.routineId, again.toISOString());
    await noNewCheckInRun(seeded.routineId, finished.id);
  });

  it("takes one look when the user went quiet on something it remembers", async () => {
    const seeded = await seedCheckIn("quiet-user", "Let's plan the school trip.", {
      scratchpad: false,
      memory: "# Trip\n\n- The user is planning a school trip to Gyeongju for late October.\n",
    });

    await handles.executor.wakeRoutine(seeded.routineId, seeded.scheduledFor.toISOString());
    const finished = await settledCheckInRun(seeded.routineId);
    expect(finished.status).toBe("completed");

    const again = await rearm(seeded.routineId);
    await handles.executor.wakeRoutine(seeded.routineId, again.toISOString());
    await noNewCheckInRun(seeded.routineId, finished.id);
  });

  it("re-spreads a schedule left on another zone instead of firing on it", async () => {
    const seeded = await seedCheckIn("re-zone", "Anything new?", { timezone: "Pacific/Auckland" });

    await handles.executor.wakeRoutine(seeded.routineId, seeded.scheduledFor.toISOString());

    await noCheckInRun(seeded.routineId);
    const routine = await handles.prisma.routine.findUniqueOrThrow({
      where: { id: seeded.routineId },
    });
    expect(routine.timezone).toBe(checkInTimeZone());
    expect(routine.active).toBe(true);
    expect(routine.nextRunAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it("keeps the five-a-day schedule out of the user's routine list", async () => {
    const seeded = await seedCheckIn("hidden", "Anything new?");
    const listed = await rpc<Array<{ id: string }>>(seeded.cookie, "routines/list", {
      botId: seeded.botId,
    });
    expect(listed.map((routine) => routine.id)).not.toContain(seeded.routineId);
  });

  async function latestCheckInRun(routineId: string) {
    return handles.prisma.run.findFirst({
      where: { routineId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * The in-memory wakeup driver continues the run itself, so the test waits for
   * that rather than racing it for the lease.
   */
  async function settledCheckInRun(routineId: string) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const run = await latestCheckInRun(routineId);
      if (run && (run.status === "completed" || run.status === "failed")) return run;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("timeout waiting for the check-in run to settle");
  }

  /** Make the schedule due again right now, as the next slot would. */
  async function rearm(routineId: string) {
    const due = new Date(Date.now() - 1_000);
    await handles.prisma.routine.update({
      where: { id: routineId },
      data: { active: true, nextRunAt: due },
    });
    return due;
  }

  async function noNewCheckInRun(routineId: string, previousRunId: string) {
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      expect((await latestCheckInRun(routineId))?.id).toBe(previousRunId);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** A skipped check-in creates nothing, so give the queue a moment to prove it. */
  async function noCheckInRun(routineId: string) {
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      expect(await latestCheckInRun(routineId)).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async function seedCheckIn(
    label: string,
    lastUserMessage: string,
    options: {
      quietStartHour?: number;
      quietEndHour?: number;
      scratchpad?: boolean;
      botQuestion?: string;
      memory?: string;
      timezone?: string;
    } = {},
  ) {
    // Equal quiet bounds mean no quiet hours, so these cases do not depend on
    // what time of day CI happens to run.
    const quietStartHour = options.quietStartHour ?? 0;
    const quietEndHour = options.quietEndHour ?? 0;
    const cookie = await signup(`check-in-${label}-${stamp}@rakazo.test`, `Check-in ${label}`);
    const me = await rpc<{ userId: string; spaceId: string }>(cookie, "me");
    const bot = await rpc<{ id: string }>(cookie, "bots/create", {
      name: `Check-in ${label}`,
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: false,
    });
    await rpc(cookie, "bots/update", {
      botId: bot.id,
      checkInsEnabled: true,
      checkInQuietStartHour: quietStartHour,
      checkInQuietEndHour: quietEndHour,
    });
    const thread = await handles.prisma.thread.findUniqueOrThrow({ where: { botId: bot.id } });
    await createThreadMessage(handles.prisma, {
      threadId: thread.id,
      role: "user",
      blocks: [{ kind: "text", text: lastUserMessage }],
    });
    // Age the conversation past the gate's "do not interrupt a live chat" window.
    await handles.prisma.message.updateMany({
      where: { threadId: thread.id },
      data: { createdAt: new Date(Date.now() - STALE_CONVERSATION_MS) },
    });
    if (options.botQuestion) {
      const question = await createThreadMessage(handles.prisma, {
        threadId: thread.id,
        role: "bot",
        botId: bot.id,
        blocks: [{ kind: "text", text: options.botQuestion }],
      });
      await handles.prisma.message.update({
        where: { id: question.id },
        data: { createdAt: new Date(Date.now() - UNANSWERED_FOR_MS) },
      });
    }
    if (options.memory) {
      await handles.prisma.memoryDocument.updateMany({
        where: { spaceId: me.spaceId, botId: bot.id, scope: "bot" },
        data: { content: options.memory },
      });
    }
    if (options.scratchpad !== false) {
      await handles.prisma.scratchpadItem.create({
        data: {
          spaceId: me.spaceId,
          botId: bot.id,
          userId: me.userId,
          title: "Finish the lesson plan draft",
          status: "open",
        },
      });
    }
    const routineId = checkInRoutineId(bot.id);
    const scheduledFor = new Date(Date.now() - 1_000);
    await handles.prisma.routine.update({
      where: { id: routineId },
      data: {
        kind: CHECK_IN_ROUTINE_KIND,
        crons: checkInCrons(quietStartHour, quietEndHour),
        timezone: options.timezone ?? checkInTimeZone(),
        active: true,
        nextRunAt: scheduledFor,
      },
    });
    const botRow = await handles.prisma.bot.findUniqueOrThrow({ where: { id: bot.id } });
    const computer = await handles.prisma.computer.findUniqueOrThrow({
      where: { id: botRow.computerId! },
    });
    return {
      cookie,
      me,
      botId: bot.id,
      threadId: thread.id,
      routineId,
      scheduledFor,
      messageCount: await handles.prisma.message.count({ where: { threadId: thread.id } }),
      computerId: computer.id,
      computerState: computer.state,
      computerProviderRef: computer.providerRef,
    };
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
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:5173",
        cookie,
      },
      body: JSON.stringify({ json: body }),
    });
    const payload = (await response.json()) as { json?: T; error?: { message?: string } };
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message ?? `${procedure} failed (${response.status})`);
    }
    return payload.json as T;
  }
});
