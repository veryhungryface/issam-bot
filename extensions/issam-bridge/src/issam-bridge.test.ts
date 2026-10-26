// By path, not by package name: this folder ships into a Chrome extension and is deliberately
// not a workspace package, so it has no node_modules of its own. The import is here because the
// two sides implement the pairing code separately and must agree.

import { describe, expect, it, vi } from "vitest";
import { encodeBrowserDevicePairing } from "../../../packages/core/src/browser-device.ts";
import {
  APPROVAL_TIMEOUT_MS,
  createBridge,
  createTransport,
  decodePairing,
  installIssamBridge,
  pickTargetTab,
  summarizeRun,
  workNotePath,
} from "./issam-bridge.mjs";

const PAIRING = {
  apiBase: "https://issam-bot.vercel.app",
  deviceId: "dev_1",
  token: "tok_abcdefghijklmnop",
};

/**
 * A deployment, a Chrome and a work folder, small enough to see all of at once.
 *
 * The fake server answers the three calls the real one does, including the opaque 401 and the
 * `{job: null}` that means "nothing for you".
 */
function harness({ job = null, auto = false, connected = true, openTabs } = {}) {
  const store = new Map();
  if (connected) {
    store.set("issamBridgeConfig", {
      ...PAIRING,
      deviceName: "교무실 노트북",
      auto,
      enabled: true,
    });
  }

  const finished = [];
  const heartbeats = [];
  let offline = false;
  let queued = job;

  const fetchImpl = vi.fn(async (url, init) => {
    if (offline) throw Object.assign(new Error("network down"), { name: "TypeError" });
    if (init.headers.authorization !== `Bearer ${PAIRING.token}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    if (url.endsWith("/heartbeat")) {
      heartbeats.push(Date.now());
      return Response.json({ ok: true });
    }
    if (url.endsWith("/claim")) {
      const taken = queued;
      queued = null;
      return Response.json({ job: taken });
    }
    const match = /\/jobs\/([^/]+)\/finish$/.exec(url);
    if (match) {
      finished.push({ jobId: match[1], ...JSON.parse(init.body) });
      return Response.json({ ok: true, delivered: true });
    }
    throw new Error(`unexpected call ${url}`);
  });

  const written = [];
  const folders = [];
  const agent = {
    running: false,
    log: [{ kind: "assistant", text: "성적표 3개를 받아 저장했어요.", outcome: "success" }],
    isRunning: () => agent.running,
    run: vi.fn(async (_text, _tabId) => {
      for (const entry of agent.log) bridge.onLog(entry);
    }),
  };

  const notify = { ask: vi.fn(), working: vi.fn(), idle: vi.fn() };

  const bridge = createBridge({
    agent,
    storage: {
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => {
        if (value === null || value === undefined) store.delete(key);
        else store.set(key, value);
      },
    },
    tabs: {
      list: async () => openTabs ?? [{ id: 7, url: "https://school.example/grades", active: true }],
    },
    notify,
    workspace: {
      loadRoot: async () => ({ name: "업무" }),
      ensureFolder: async (_root, name) => folders.push(name),
      writeNewText: async (_root, path, body) => {
        written.push({ path, body });
        return { path };
      },
    },
    fetchImpl,
  });

  return {
    bridge,
    agent,
    notify,
    finished,
    heartbeats,
    written,
    folders,
    store,
    setJob: (next) => {
      queued = next;
    },
    goOffline: () => {
      offline = true;
    },
    comeBack: () => {
      offline = false;
    },
  };
}

describe("the pairing code", () => {
  it("reads exactly what the server wrote", () => {
    // Both sides implement this independently; if they drift, a teacher simply cannot connect.
    expect(decodePairing(encodeBrowserDevicePairing(PAIRING))).toEqual(PAIRING);
  });

  it("refuses a code that would send the token over plain http", () => {
    const code = encodeBrowserDevicePairing({ ...PAIRING, apiBase: "http://localhost:5173" });
    expect(decodePairing(code)).toMatchObject({ apiBase: "http://localhost:5173" });
    const forged = `issam1.${btoa('{"a":"http://school.example","d":"d","t":"t"}')
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")}`;
    expect(decodePairing(forged)).toBeNull();
  });

  it("refuses anything that is not one of ours", () => {
    for (const bad of ["", "issam1.", "issam1.!!", "https://issam-bot.vercel.app", null, 7]) {
      expect(decodePairing(bad)).toBeNull();
    }
  });
});

describe("where a note is written", () => {
  it("keeps the request in the name without letting it become the path", () => {
    const path = workNotePath(new Date("2026-10-26T15:30:12"), "성적표 받아서 /../etc 에 저장해줘");
    expect(path.startsWith("아이쌤봇/2026-10-26_153012_")).toBe(true);
    expect(path.endsWith(".md")).toBe(true);
    // The folder's own normalizePath refuses these outright; nothing should ever reach it.
    for (const segment of path.split("/")) {
      expect(segment).not.toMatch(/[\\:]/);
      expect([...segment].some((char) => char.charCodeAt(0) < 0x20)).toBe(false);
      expect(segment.startsWith(".")).toBe(false);
      expect(segment).not.toMatch(/[. ]$/);
      expect(segment).not.toBe("..");
    }
  });

  it("still names a file when the request has nothing nameable in it", () => {
    expect(workNotePath(new Date("2026-10-26T09:05:00"), "!!! ???")).toBe(
      "아이쌤봇/2026-10-26_090500.md",
    );
  });
});

describe("what comes back from a run", () => {
  it("reports the agent's own closing message", () => {
    expect(
      summarizeRun([
        { kind: "info", text: "스킬 사용: 성적 조회" },
        { kind: "assistant", text: "끝냈어요.", outcome: "success" },
      ]),
    ).toMatchObject({ status: "done", text: "끝냈어요." });
  });

  it("does not file an unverified result as a failure, but says it is unverified", () => {
    const summary = summarizeRun([{ kind: "assistant", text: "저장했어요.", outcome: "warning" }]);
    expect(summary.status).toBe("done");
    expect(summary.text).toContain("검증");
  });

  it("treats a question as a failure, because nothing was finished", () => {
    // An ask_user ends the run with no answer. Calling that 완료 is a lie the teacher only
    // finds out about later.
    const summary = summarizeRun([
      { kind: "assistant", text: "어느 반 성적인가요?", outcome: "question" },
    ]);
    expect(summary.status).toBe("error");
    expect(summary.text).toContain("어느 반 성적인가요?");
  });

  it("falls back to the error, then to saying nothing came back", () => {
    expect(summarizeRun([{ kind: "error", text: "작업 탭이 닫혔습니다." }])).toMatchObject({
      status: "error",
      text: "작업 탭이 닫혔습니다.",
    });
    expect(summarizeRun([]).status).toBe("error");
  });

  it("keeps the step-by-step narration out of the chat and in the trace", () => {
    const summary = summarizeRun([
      { kind: "action", text: "클릭: 조회" },
      { kind: "assistant", text: "끝.", outcome: "success" },
    ]);
    expect(summary.text).toBe("끝.");
    expect(summary.trace).toContain("클릭: 조회");
  });
});

describe("choosing the tab to work on", () => {
  it("uses the tab the teacher is looking at", () => {
    expect(
      pickTargetTab([
        { id: 1, url: "https://a.test", lastAccessed: 99 },
        { id: 2, url: "https://b.test", active: true, lastAccessed: 1 },
      ]),
    ).toBe(2);
  });

  it("falls back to the most recently used web tab", () => {
    expect(
      pickTargetTab([
        { id: 1, url: "https://a.test", lastAccessed: 5 },
        { id: 2, url: "https://b.test", lastAccessed: 50 },
      ]),
    ).toBe(2);
  });

  it("refuses pages the agent cannot attach to, and says so with null", () => {
    expect(pickTargetTab([{ id: 1, url: "chrome://extensions", active: true }])).toBeNull();
    expect(pickTargetTab([])).toBeNull();
  });
});

describe("the transport", () => {
  it("turns every auth failure into the one thing we actually know", async () => {
    const transport = createTransport(PAIRING, async () => new Response("{}", { status: 401 }));
    await expect(transport.claim()).rejects.toMatchObject({ unauthorized: true });
  });

  it("marks a server or network problem retryable instead of unpairing over it", async () => {
    const down = createTransport(PAIRING, async () => new Response("{}", { status: 503 }));
    // Retryable, and emphatically not "unpair this device": a 503 is the server, not the token.
    const error = await down.heartbeat().catch((thrown) => thrown);
    expect(error.retryable).toBe(true);
    expect(error.unauthorized).toBeUndefined();
  });
});

describe("a task crossing the bridge", () => {
  it("asks before touching a browser that is signed in to the school", async () => {
    const h = harness({ job: { id: "job-1", prompt: "성적표 받아서 폴더에 저장해줘" } });
    await h.bridge.tick();
    expect(h.agent.run).not.toHaveBeenCalled();
    expect(h.notify.ask).toHaveBeenCalledOnce();
    expect(await h.bridge.status()).toMatchObject({
      pending: { id: "job-1", prompt: "성적표 받아서 폴더에 저장해줘" },
    });

    await h.bridge.approve("job-1", 7);
    expect(h.agent.run).toHaveBeenCalledWith("성적표 받아서 폴더에 저장해줘", 7);
    expect(h.finished).toEqual([
      {
        jobId: "job-1",
        status: "done",
        result: expect.stringContaining("성적표 3개를 받아 저장했어요."),
      },
    ]);
    expect(h.written).toHaveLength(1);
    expect(h.folders).toEqual(["아이쌤봇"]);
    expect(h.finished[0].result).toContain(h.written[0].path);
  });

  it("takes only one task, and not a second while one waits", async () => {
    const h = harness({ job: { id: "job-1", prompt: "a" } });
    await h.bridge.tick();
    h.setJob({ id: "job-2", prompt: "b" });
    await h.bridge.tick();
    expect(await h.bridge.status()).toMatchObject({ pending: { id: "job-1" } });
  });

  it("runs without asking only when the teacher turned that on", async () => {
    const h = harness({ job: { id: "job-1", prompt: "재고 확인해줘" }, auto: true });
    await h.bridge.tick();
    expect(h.notify.ask).not.toHaveBeenCalled();
    expect(h.agent.run).toHaveBeenCalledWith("재고 확인해줘", 7);
    expect(h.finished[0]).toMatchObject({ status: "done" });
  });

  it("tells the teacher when a refusal was theirs", async () => {
    const h = harness({ job: { id: "job-1", prompt: "a" } });
    await h.bridge.tick();
    await h.bridge.reject("job-1");
    expect(h.agent.run).not.toHaveBeenCalled();
    expect(h.finished[0]).toMatchObject({
      status: "error",
      result: "선생님이 이 요청을 거절했습니다.",
    });
  });

  it("gives up on an unanswered request before the server writes it off", async () => {
    const h = harness({ job: { id: "job-1", prompt: "a" } });
    await h.bridge.tick();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + APPROVAL_TIMEOUT_MS + 1_000);
    try {
      await h.bridge.tick();
    } finally {
      vi.restoreAllMocks();
    }
    expect(h.finished[0]).toMatchObject({
      status: "error",
      result: "선생님이 승인하지 않아 실행하지 않았습니다.",
    });
  });

  it("takes nothing while the teacher is driving the browser themselves", async () => {
    const h = harness({ job: { id: "job-1", prompt: "a" } });
    h.agent.running = true;
    await h.bridge.tick();
    expect(await h.bridge.status()).toMatchObject({ pending: null });
    // Still answering, so the bot knows the machine is awake rather than gone.
    expect(h.heartbeats.length).toBe(1);
  });

  it("refuses a task when there is no page to work on, instead of queueing into the dark", async () => {
    // Auto mode has nobody to ask which tab to use. Holding the job would leave the teacher
    // waiting for an answer that cannot come.
    const h = harness({ job: { id: "job-1", prompt: "a" }, auto: true, openTabs: [] });
    await h.bridge.tick();
    expect(h.agent.run).not.toHaveBeenCalled();
    expect(h.finished[0].result).toContain("열려 있는 웹 페이지가 없어");
  });

  it("will not start a second task on top of one already running", async () => {
    const h = harness({ job: { id: "job-1", prompt: "a" } });
    await h.bridge.tick();
    h.agent.running = true;
    await expect(h.bridge.approve("job-1", 7)).rejects.toThrow(/다른 작업/);
    expect(h.agent.run).not.toHaveBeenCalled();
  });
});

describe("when the network drops at the worst moment", () => {
  it("keeps a finished result and delivers it on the next poll", async () => {
    const h = harness({ job: { id: "job-1", prompt: "a" }, auto: true });
    h.goOffline();
    await h.bridge.tick();
    // Nothing reached the server, and nothing ran — the claim itself failed.
    expect(h.finished).toHaveLength(0);

    h.comeBack();
    h.setJob({ id: "job-2", prompt: "성적표" });
    await h.bridge.tick();
    expect(h.finished).toHaveLength(1);
  });

  it("never re-runs work that already touched a real account", async () => {
    const h = harness();
    h.store.set("issamBridgeActive", { id: "job-1", startedAt: Date.now() - 60_000 });
    await h.bridge.recover();
    expect(h.agent.run).not.toHaveBeenCalled();
    expect(h.finished[0]).toMatchObject({ status: "error" });
    expect(h.finished[0].result).toContain("자동으로 다시 실행하지 않습니다");
  });

  it("delivers a result that was held back rather than calling it a crash", async () => {
    const h = harness();
    h.store.set("issamBridgeActive", {
      id: "job-1",
      finished: { status: "done", result: "다 했어요." },
    });
    await h.bridge.recover();
    expect(h.finished[0]).toEqual({ jobId: "job-1", status: "done", result: "다 했어요." });
  });
});

describe("connecting and disconnecting", () => {
  it("proves the code works before storing it", async () => {
    const h = harness({ connected: false });
    await h.bridge.connect(encodeBrowserDevicePairing(PAIRING), "교무실 노트북");
    expect(h.heartbeats).toHaveLength(1);
    expect(await h.bridge.status()).toMatchObject({ connected: true, deviceName: "교무실 노트북" });
  });

  it("does not store a pairing the server would not accept", async () => {
    const h = harness({ connected: false });
    const wrong = encodeBrowserDevicePairing({ ...PAIRING, token: "not-the-token" });
    await expect(h.bridge.connect(wrong, "x")).rejects.toThrow(/다시 연결/);
    expect(await h.bridge.status()).toMatchObject({ connected: false });
  });

  it("stops taking work the moment the pairing stops working", async () => {
    const h = harness({ job: { id: "job-1", prompt: "a" } });
    h.store.set("issamBridgeConfig", { ...PAIRING, token: "stale", enabled: true });
    await h.bridge.tick();
    expect(h.store.get("issamBridgeConfig").enabled).toBe(false);
    expect((await h.bridge.status()).error).toContain("다시 연결");
  });

  it("forgets everything on disconnect", async () => {
    const h = harness({ job: { id: "job-1", prompt: "a" } });
    await h.bridge.tick();
    await h.bridge.disconnect();
    expect(h.store.has("issamBridgeConfig")).toBe(false);
    expect(h.store.has("issamBridgePending")).toBe(false);
  });
});

/** Just enough Chrome to see what `installIssamBridge` hangs off it. */
function fakeChrome() {
  const store = new Map<string, unknown>();
  const listeners: { message: any[]; alarm: any[] } = { message: [], alarm: [] };
  return {
    listeners,
    api: {
      runtime: {
        id: "ext-1",
        getURL: (path: string) => `chrome-extension://ext-1/${path}`,
        onMessage: { addListener: (fn: any) => listeners.message.push(fn) },
      },
      storage: {
        local: {
          get: async (key: string) => ({ [key]: store.get(key) }),
          set: async (value: Record<string, unknown>) => {
            for (const [key, item] of Object.entries(value)) store.set(key, item);
          },
          remove: async (key: string) => void store.delete(key),
        },
      },
      tabs: { query: async () => [], create: async () => undefined },
      windows: {
        create: async () => ({ id: 9 }),
        update: async () => undefined,
        onRemoved: { addListener: () => undefined },
      },
      alarms: { create: vi.fn(), onAlarm: { addListener: (fn: any) => listeners.alarm.push(fn) } },
      action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setTitle: vi.fn() },
    },
  };
}

describe("wiring it to Chrome", () => {
  const agent = { isRunning: () => false, stop: () => undefined, run: async () => undefined };

  it("answers its own pages and nobody else's", async () => {
    vi.useFakeTimers();
    const chrome = fakeChrome();
    try {
      installIssamBridge(agent, chrome.api as never);
      const [onMessage] = chrome.listeners.message;
      expect(onMessage).toBeTypeOf("function");

      // A web page that could send these would be able to approve a task against a browser
      // that is signed in to the school.
      const outsider = vi.fn();
      onMessage(
        { type: "issamBridgeApprove", id: "job-1" },
        { id: "ext-1", url: "https://evil.test/" },
        outsider,
      );
      expect(outsider).toHaveBeenCalledWith({ ok: false, error: "허용되지 않은 요청입니다." });

      const mine = vi.fn();
      const handled = onMessage(
        { type: "issamBridgeStatus" },
        { id: "ext-1", url: "chrome-extension://ext-1/issam.html" },
        mine,
      );
      expect(handled).toBe(true);
      await vi.waitFor(() => expect(mine).toHaveBeenCalled());
      expect(mine.mock.calls[0][0]).toMatchObject({ ok: true, connected: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an alarm, because the service worker is killed while it waits", () => {
    vi.useFakeTimers();
    const chrome = fakeChrome();
    try {
      installIssamBridge(agent, chrome.api as never);
      expect(chrome.api.alarms.create).toHaveBeenCalledWith("issam-bridge-wake", {
        periodInMinutes: 0.5,
      });
      expect(chrome.listeners.alarm).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
