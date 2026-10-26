import { BROWSER_DEVICE_SECRET_KIND } from "@rakazo/core";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { type BrowserDeviceDeps, mountBrowserDeviceHttpRoutes } from "./browser-device.js";

const TOKEN = "browser-device-test-token-32chars!!";
const DEVICE_ID = "device-1";

type JobRow = {
  id: string;
  status: string;
  botId: string;
  threadId: string;
  userId: string;
  prompt: string;
  createdAt: Date;
  claimedAt: Date | null;
};

function createDeps(
  overrides: {
    device?: Record<string, unknown> | null;
    secret?: Record<string, unknown> | null;
    job?: JobRow | null;
    load?: () => string;
  } = {},
) {
  const device =
    overrides.device === undefined
      ? {
          id: DEVICE_ID,
          spaceId: "ws-1",
          userId: "user-1",
          name: "교무실 노트북",
          secretId: "secret-1",
        }
      : overrides.device;
  const secret =
    overrides.secret === undefined
      ? {
          id: "secret-1",
          ciphertext: "cipher",
          kind: BROWSER_DEVICE_SECRET_KIND,
          userId: "user-1",
          spaceId: "ws-1",
        }
      : overrides.secret;
  const job =
    overrides.job === undefined
      ? {
          id: "job-1",
          status: "queued",
          botId: "bot-1",
          threadId: "thread-1",
          userId: "user-1",
          prompt: "성적표 받아서 폴더에 저장해줘",
          createdAt: new Date(),
          claimedAt: null,
        }
      : overrides.job;

  const sendUserMessage = vi.fn(async () => ({ messageId: "msg-1", runId: "run-1", seq: 3 }));
  const enqueue = vi.fn(async () => undefined);
  const deviceUpdate = vi.fn(async () => device);
  const jobUpdateMany = vi.fn(async () => ({ count: 1 }));

  const deps = {
    prisma: {
      browserDevice: {
        findFirst: vi.fn(async () => device),
        update: deviceUpdate,
      },
      secret: { findUnique: vi.fn(async () => secret) },
      browserJob: {
        findFirst: vi.fn(async () => job),
        findMany: vi.fn(async () => []),
        updateMany: jobUpdateMany,
      },
    } as unknown as BrowserDeviceDeps["prisma"],
    secrets: { load: overrides.load ?? (() => TOKEN) } as unknown as BrowserDeviceDeps["secrets"],
    events: { sendUserMessage },
    jobs: { enqueue } as unknown as BrowserDeviceDeps["jobs"],
  } satisfies BrowserDeviceDeps;

  return { deps, sendUserMessage, enqueue, deviceUpdate, jobUpdateMany };
}

function mount(deps: BrowserDeviceDeps) {
  const app = new Hono();
  mountBrowserDeviceHttpRoutes(app, deps);
  return app;
}

const auth = (token = TOKEN) => ({ authorization: `Bearer ${token}` });

function post(app: Hono, path: string, init: RequestInit = {}) {
  return app.request(path, { method: "POST", ...init });
}

describe("claiming work", () => {
  it("hands the queued task to a device that proves its token", async () => {
    const { deps, jobUpdateMany } = createDeps();
    const response = await post(mount(deps), `/api/v1/browser-devices/${DEVICE_ID}/claim`, {
      headers: auth(),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      job: { id: "job-1", prompt: "성적표 받아서 폴더에 저장해줘" },
    });
    // Claimed by id AND status, so two polls racing cannot both win the same task.
    expect(jobUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "job-1", status: "queued" } }),
    );
  });

  it("marks the device reachable on every poll, which is the only signal there is", async () => {
    const { deps, deviceUpdate } = createDeps();
    await post(mount(deps), `/api/v1/browser-devices/${DEVICE_ID}/claim`, { headers: auth() });
    expect(deviceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DEVICE_ID } }),
    );
  });

  it("answers with nothing when the queue is empty", async () => {
    const { deps } = createDeps({ job: null });
    const response = await post(mount(deps), `/api/v1/browser-devices/${DEVICE_ID}/claim`, {
      headers: auth(),
    });
    expect(await response.json()).toEqual({ job: null });
  });

  it("does not hand over a task another poll already claimed", async () => {
    const { deps } = createDeps();
    (deps.prisma.browserJob.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 0,
    });
    const response = await post(mount(deps), `/api/v1/browser-devices/${DEVICE_ID}/claim`, {
      headers: auth(),
    });
    expect(await response.json()).toEqual({ job: null });
  });
});

describe("the token is the only thing in the way", () => {
  const cases: Array<[string, Parameters<typeof createDeps>[0], string | undefined]> = [
    ["a wrong token", {}, "not-the-token"],
    ["no authorization at all", {}, undefined],
    ["an unknown or revoked device", { device: null }, TOKEN],
    ["a missing secret", { secret: null }, TOKEN],
    [
      "a secret of another kind",
      { secret: { id: "s", ciphertext: "c", kind: "webhook", userId: "user-1", spaceId: "ws-1" } },
      TOKEN,
    ],
    [
      "a secret belonging to someone else",
      {
        secret: {
          id: "s",
          ciphertext: "c",
          kind: BROWSER_DEVICE_SECRET_KIND,
          userId: "user-2",
          spaceId: "ws-1",
        },
      },
      TOKEN,
    ],
    [
      "a secret that will not decrypt",
      {
        load: () => {
          throw new Error("bad key");
        },
      },
      TOKEN,
    ],
  ];

  for (const [label, overrides, token] of cases) {
    it(`refuses ${label}, and says nothing more`, async () => {
      const { deps, sendUserMessage } = createDeps(overrides);
      const response = await post(mount(deps), `/api/v1/browser-devices/${DEVICE_ID}/claim`, {
        headers: token ? auth(token) : {},
      });
      // One opaque answer for every failure, so a caller holding one good token cannot
      // probe for which device ids exist by watching the replies differ.
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
      expect(sendUserMessage).not.toHaveBeenCalled();
    });
  }
});

describe("reporting back", () => {
  const claimed: JobRow = {
    id: "job-1",
    status: "claimed",
    botId: "bot-1",
    threadId: "thread-1",
    userId: "user-1",
    prompt: "성적표 받아줘",
    createdAt: new Date(),
    claimedAt: new Date(),
  };

  it("puts the result in the teacher's chat and wakes the bot", async () => {
    const { deps, sendUserMessage, enqueue } = createDeps({ job: claimed });
    const response = await post(
      mount(deps),
      `/api/v1/browser-devices/${DEVICE_ID}/jobs/job-1/finish`,
      {
        headers: { ...auth(), "content-type": "application/json" },
        body: JSON.stringify({ status: "done", result: "성적표 3개를 저장했어요." }),
      },
    );
    expect(await response.json()).toEqual({ ok: true, delivered: true });
    const sent = sendUserMessage.mock.calls[0]?.[0] as { prompt: string; trigger: string };
    expect(sent.trigger).toBe("browser_device");
    expect(sent.prompt).toContain("교무실 노트북");
    expect(sent.prompt).toContain("성적표 3개를 저장했어요.");
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("refuses a status the device had no business inventing", async () => {
    for (const status of ["queued", "claimed", "expired", "", undefined]) {
      const { deps, sendUserMessage } = createDeps({ job: claimed });
      const response = await post(
        mount(deps),
        `/api/v1/browser-devices/${DEVICE_ID}/jobs/job-1/finish`,
        {
          headers: { ...auth(), "content-type": "application/json" },
          body: JSON.stringify({ status, result: "x" }),
        },
      );
      expect(response.status).toBe(400);
      expect(sendUserMessage).not.toHaveBeenCalled();
    }
  });

  it("does not post the same result twice when an extension retries", async () => {
    const { deps, sendUserMessage } = createDeps({ job: { ...claimed, status: "done" } });
    const response = await post(
      mount(deps),
      `/api/v1/browser-devices/${DEVICE_ID}/jobs/job-1/finish`,
      {
        headers: { ...auth(), "content-type": "application/json" },
        body: JSON.stringify({ status: "done", result: "다시 보냄" }),
      },
    );
    expect(await response.json()).toEqual({ ok: true, duplicate: true });
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("keeps the work recorded when only the telling fails", async () => {
    // The browser already did it. Answering 500 would invite the extension to run the
    // whole task a second time against the teacher's real accounts.
    const { deps, sendUserMessage } = createDeps({ job: claimed });
    sendUserMessage.mockRejectedValueOnce(new Error("thread gone"));
    const response = await post(
      mount(deps),
      `/api/v1/browser-devices/${DEVICE_ID}/jobs/job-1/finish`,
      {
        headers: { ...auth(), "content-type": "application/json" },
        body: JSON.stringify({ status: "done", result: "저장함" }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, delivered: false });
    expect(deps.prisma.browserJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "done" }) }),
    );
  });

  it("will not let a device finish work that is not its own", async () => {
    const { deps, sendUserMessage } = createDeps({ job: null });
    const response = await post(
      mount(deps),
      `/api/v1/browser-devices/${DEVICE_ID}/jobs/someone-elses-job/finish`,
      {
        headers: { ...auth(), "content-type": "application/json" },
        body: JSON.stringify({ status: "done", result: "x" }),
      },
    );
    expect(response.status).toBe(401);
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("rejects a body that is not an object", async () => {
    const { deps } = createDeps({ job: claimed });
    const response = await post(
      mount(deps),
      `/api/v1/browser-devices/${DEVICE_ID}/jobs/job-1/finish`,
      { headers: { ...auth(), "content-type": "application/json" }, body: "[1,2,3]" },
    );
    expect(response.status).toBe(400);
  });
});

describe("heartbeat", () => {
  it("marks the device reachable while it is busy with nothing to claim", async () => {
    const { deps, deviceUpdate } = createDeps();
    const response = await post(mount(deps), `/api/v1/browser-devices/${DEVICE_ID}/heartbeat`, {
      headers: auth(),
    });
    expect(await response.json()).toEqual({ ok: true });
    expect(deviceUpdate).toHaveBeenCalled();
  });

  it("still needs the token", async () => {
    const { deps, deviceUpdate } = createDeps();
    const response = await post(mount(deps), `/api/v1/browser-devices/${DEVICE_ID}/heartbeat`, {
      headers: auth("wrong"),
    });
    expect(response.status).toBe(401);
    expect(deviceUpdate).not.toHaveBeenCalled();
  });
});
