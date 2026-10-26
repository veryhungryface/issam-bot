/**
 * The 아이쌤봇 bridge, service-worker side.
 *
 * 한밭 도우미 already drives the teacher's own Chrome. This module gives 아이쌤봇 a way to
 * hand it a task: it asks the deployment every few seconds whether anything is waiting, shows
 * the teacher what arrived, runs it on a tab they picked, writes a note into their work folder
 * and reports back. Plain ESM with no build step, because it is dropped next to an extension
 * that is already built.
 *
 * Nothing is pushed to us. A Chrome extension cannot be connected to, and its MV3 service
 * worker is killed after seconds of idle, so polling is not a shortcut here — it is the only
 * thing that survives a laptop that sleeps.
 *
 * Two rules shape everything below.
 *
 * The browser is signed in to the school systems. So a task does not run because a server
 * said so: by default it runs because the teacher looked at it and pressed 실행. Auto mode
 * exists, it is off, and the screen says plainly what turning it on gives up.
 *
 * Work that already touched a real account is never repeated. If Chrome dies mid-task we
 * report the interruption and stop — we do not re-run it and hope.
 */

/** Must match `encodeBrowserDevicePairing` in `@rakazo/core`. */
export const PAIRING_PREFIX = "issam1.";

export const POLL_MS = 3_000;
/** Below the server's 90s reachability window, with room for one missed call. */
export const HEARTBEAT_MS = 25_000;
/** Under the server's 15-minute claim timeout, so we report before it writes the job off. */
export const APPROVAL_TIMEOUT_MS = 10 * 60_000;
export const REQUEST_TIMEOUT_MS = 10_000;
export const RESULT_MAX = 8_000;

const STORE_CONFIG = "issamBridgeConfig";
const STORE_PENDING = "issamBridgePending";
const STORE_ACTIVE = "issamBridgeActive";
const ALARM = "issam-bridge-wake";

/* ────────────────────────────── pure helpers ────────────────────────────── */

function fromBase64url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * The pairing out of a pasted code, or `null`.
 *
 * The mirror of `decodeBrowserDevicePairing` in the server's `packages/core`. Plain http is
 * refused for anything but a development host: the token rides in the `Authorization` header
 * of every poll, and http to a school address hands it to whoever shares the network.
 */
export function decodePairing(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().replace(/\s+/g, "");
  if (!code.startsWith(PAIRING_PREFIX)) return null;
  const bytes = fromBase64url(code.slice(PAIRING_PREFIX.length));
  if (!bytes) return null;
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { a, d, t } = parsed;
  if (typeof a !== "string" || typeof d !== "string" || !d || typeof t !== "string" || !t) {
    return null;
  }
  let url;
  try {
    url = new URL(a);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  return { apiBase: url.origin, deviceId: d, token: t };
}

/**
 * The tab the task will run on.
 *
 * The agent needs a page it can attach to, so only http(s) tabs qualify. The teacher's active
 * tab wins when it is one — that is the window they are looking at — and otherwise the most
 * recently used web tab. `null` means there is nothing to work on, which is an answer the
 * teacher gets to read rather than a crash.
 */
export function pickTargetTab(tabs) {
  const usable = (tabs || []).filter(
    (tab) => Number.isInteger(tab?.id) && /^https?:/i.test(tab.url || ""),
  );
  if (!usable.length) return null;
  const active = usable.find((tab) => tab.active);
  if (active) return active.id;
  // `lastAccessed` only exists on newer Chrome; without it, tab order is all there is.
  const ranked = [...usable].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return ranked[0].id;
}

const SLUG_STRIP = /[^\p{L}\p{N}_-]+/gu;

/**
 * Where the note about a finished task is written, relative to the work folder.
 *
 * The folder's own `normalizePath` refuses backslashes, colons, control characters, hidden
 * names and segments that end in a dot or a space, so the slug is cut down to letters, digits,
 * `_` and `-` before it gets anywhere near a file name. A folder full of bare timestamps is
 * useless to look through, which is why the request is in the name at all.
 */
export function workNotePath(now, prompt, folder = "아이쌤봇") {
  const pad = (value) => String(value).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const slug = String(prompt || "")
    .normalize("NFC")
    .replace(SLUG_STRIP, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24)
    .replace(/_+$/, "");
  return `${folder}/${stamp}${slug ? `_${slug}` : ""}.md`;
}

/**
 * What the teacher's chat is told, out of everything the agent said while working.
 *
 * The agent's own closing message is the answer; `error` entries are why it stopped. The rest
 * is step-by-step narration that belongs in the saved note, not in a chat message.
 *
 * An `ask_user` ends the run with a question and no answer. Reporting that as 완료 would be a
 * lie the teacher only discovers later, so it comes back as a failure that quotes the question.
 */
export function summarizeRun(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const answers = list.filter((entry) => entry?.kind === "assistant" && entry.text);
  const errors = list.filter((entry) => entry?.kind === "error" && entry.text);
  const last = answers.at(-1);
  const trace = list
    .filter((entry) => entry?.text && ["info", "action", "result", "error"].includes(entry.kind))
    .map((entry) => `- ${entry.text}`)
    .join("\n");

  if (last?.outcome === "question") {
    return { status: "error", text: `작업을 끝내지 못하고 물었습니다: ${last.text}`, trace };
  }
  if (errors.length && !last) {
    return { status: "error", text: errors.at(-1).text, trace };
  }
  if (!last) {
    return { status: "error", text: "에이전트가 아무 결과도 보고하지 않았습니다.", trace };
  }
  // `warning` means the agent reported success but its own check did not confirm it. That is
  // not a failure — something was done — so it is reported as done with the doubt attached.
  const caution =
    last.outcome === "warning" ? "\n\n(결과 검증을 통과하지 못했습니다. 직접 확인해 주세요.)" : "";
  return { status: "done", text: `${last.text}${caution}`, trace };
}

function clamp(text) {
  const value = String(text ?? "").trim();
  return value.length > RESULT_MAX ? `${value.slice(0, RESULT_MAX)}…` : value;
}

/* ───────────────────────────────── transport ───────────────────────────────── */

/** The three calls the server offers a device, with a timeout and one meaning for 401. */
export function createTransport(config, fetchImpl = fetch) {
  async function call(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(
        `${config.apiBase}/api/v1/browser-devices/${config.deviceId}${path}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.token}`,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        },
      );
    } catch (error) {
      throw Object.assign(
        new Error(
          error?.name === "AbortError"
            ? "아이쌤봇 서버가 응답하지 않습니다. 잠시 뒤 다시 시도합니다."
            : "아이쌤봇 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.",
        ),
        { retryable: true },
      );
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401) {
      // The server answers one opaque 401 for every auth failure, so this is all we know and
      // all we should claim: the pairing no longer works.
      throw Object.assign(
        new Error("연결이 해제되었거나 토큰이 바뀌었습니다. 아이쌤봇 설정에서 다시 연결하세요."),
        {
          unauthorized: true,
        },
      );
    }
    if (!response.ok) {
      throw Object.assign(new Error(`아이쌤봇 서버 오류 (${response.status})`), {
        retryable: true,
      });
    }
    return response.json();
  }

  return {
    claim: () => call("/claim"),
    heartbeat: () => call("/heartbeat"),
    finish: (jobId, status, result) => call(`/jobs/${jobId}/finish`, { status, result }),
  };
}

/* ─────────────────────────────────── bridge ─────────────────────────────────── */

/**
 * The state machine, with every timer, tab and file handle passed in.
 *
 * `installIssamBridge` wires it to Chrome; the tests drive `tick`, `approve` and `reject`
 * directly, which is the only way to watch a job cross the states it actually has.
 */
export function createBridge({
  agent,
  storage,
  tabs,
  notify,
  workspace,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  let busy = false;
  let collected = null;
  let lastHeartbeat = 0;
  let lastError = "";

  const read = (key) => storage.get(key);
  const write = (key, value) => storage.set(key, value);

  async function config() {
    const value = await read(STORE_CONFIG);
    return value?.deviceId && value?.token && value?.apiBase ? value : null;
  }

  function transportFor(value) {
    return createTransport(value, fetchImpl);
  }

  /** Settle a job on the server and forget it locally, whatever happened here. */
  async function report(value, jobId, status, result) {
    await transportFor(value).finish(jobId, status, clamp(result));
    await write(STORE_PENDING, null);
    await write(STORE_ACTIVE, null);
  }

  /**
   * Settle a job whose work is already done, keeping the answer if the network is not there.
   *
   * The alternative is that a task which actually succeeded comes back to the teacher as
   * "Chrome이 멈췄습니다" because the wifi dropped in the last second. The result waits in
   * storage and the next poll delivers it.
   */
  async function settle(value, jobId, status, result) {
    try {
      await report(value, jobId, status, result);
    } catch (error) {
      lastError = error?.message || "결과를 아이쌤봇에 보내지 못했습니다.";
      await write(STORE_PENDING, null);
      await write(STORE_ACTIVE, { id: jobId, finished: { status, result: clamp(result) } });
    }
  }

  /**
   * A task that was running when Chrome stopped.
   *
   * It touched a real account, so it is reported as interrupted and dropped. Re-running it
   * is the one thing we must never do: nobody knows how far it got.
   */
  async function recover() {
    const active = await read(STORE_ACTIVE);
    const value = await config();
    if (!active?.id || !value) return;
    if (active.finished) {
      await settle(value, active.id, active.finished.status, active.finished.result);
      return;
    }
    await report(
      value,
      active.id,
      "error",
      "작업 중에 Chrome이 멈췄거나 꺼졌습니다. 어디까지 진행됐는지 직접 확인해 주세요. 자동으로 다시 실행하지 않습니다.",
    ).catch(() => undefined);
  }

  async function runPending(pending, value, tabId) {
    busy = true;
    collected = [];
    await write(STORE_ACTIVE, { id: pending.id, startedAt: Date.now() });
    await write(STORE_PENDING, null);
    notify.working(pending);
    let summary;
    try {
      await agent.run(pending.prompt, tabId);
      summary = summarizeRun(collected);
    } catch (error) {
      summary = { status: "error", text: error?.message || "작업을 끝내지 못했습니다.", trace: "" };
    } finally {
      collected = null;
      busy = false;
    }

    const saved = await saveNote(pending, summary).catch((error) => ({ error: error?.message }));
    const note = saved?.path
      ? `\n\n작업 폴더에 기록을 저장했습니다: ${saved.path}`
      : saved?.error
        ? `\n\n(작업 폴더에는 저장하지 못했습니다: ${saved.error})`
        : "";
    await settle(value, pending.id, summary.status, `${summary.text}${note}`);
    notify.idle();
    return summary;
  }

  /** The note in the teacher's own folder. Best effort — a missing folder is not a failure. */
  async function saveNote(pending, summary) {
    if (!workspace) return null;
    const root = await workspace.loadRoot();
    if (!root) return null;
    const path = workNotePath(now(), pending.prompt);
    const body = [
      `# ${pending.prompt}`,
      "",
      `- 요청: 아이쌤봇`,
      `- 실행: ${now().toLocaleString("ko-KR")}`,
      `- 결과: ${summary.status === "done" ? "완료" : "실패"}`,
      "",
      "## 결과",
      "",
      summary.text,
      ...(summary.trace ? ["", "## 진행 기록", "", summary.trace] : []),
      "",
    ].join("\n");
    await workspace.ensureFolder(root, path.split("/")[0]);
    return workspace.writeNewText(root, path, body);
  }

  return {
    onLog(entry) {
      if (collected && entry?.text) collected.push(entry);
    },

    isBusy: () => busy,

    async status() {
      const value = await read(STORE_CONFIG);
      const pending = await read(STORE_PENDING);
      return {
        connected: Boolean(value?.deviceId && value?.enabled !== false),
        deviceName: value?.deviceName || "",
        apiBase: value?.apiBase || "",
        auto: value?.auto === true,
        running: busy,
        error: lastError,
        pending: pending?.id ? { id: pending.id, prompt: pending.prompt, at: pending.at } : null,
      };
    },

    async connect(code, deviceName) {
      const pairing = decodePairing(code);
      if (!pairing) {
        throw new Error(
          "연결 코드를 읽지 못했습니다. 아이쌤봇 설정에서 복사한 코드를 그대로 붙여넣어 주세요.",
        );
      }
      await transportFor(pairing).heartbeat();
      lastError = "";
      await write(STORE_CONFIG, {
        ...pairing,
        deviceName: deviceName || "내 크롬",
        auto: false,
        enabled: true,
      });
      return { ok: true };
    },

    async disconnect() {
      await write(STORE_CONFIG, null);
      await write(STORE_PENDING, null);
      await write(STORE_ACTIVE, null);
      lastError = "";
      notify.idle();
    },

    async setAuto(auto) {
      const value = await read(STORE_CONFIG);
      if (value) await write(STORE_CONFIG, { ...value, auto: auto === true });
    },

    recover,

    /** One poll: keep the device reachable, then take at most one task. */
    async tick() {
      const value = await config();
      if (!value || value.enabled === false || busy) return;
      try {
        const held = await read(STORE_ACTIVE);
        if (held?.finished) {
          await settle(value, held.id, held.finished.status, held.finished.result);
          return;
        }
        const pending = await read(STORE_PENDING);
        if (pending?.id) {
          // Approval has a deadline because the server writes a claimed job off at fifteen
          // minutes; better the teacher reads why it was dropped than nothing at all.
          if (Date.now() - pending.at > APPROVAL_TIMEOUT_MS) {
            notify.idle();
            await settle(value, pending.id, "error", "선생님이 승인하지 않아 실행하지 않았습니다.");
          }
          return;
        }
        if (agent.isRunning()) {
          // The teacher is driving it themselves. Stay reachable, take nothing.
          await beat(value, true);
          return;
        }
        await beat(value, false);
        const { job } = await transportFor(value).claim();
        if (!job?.id) return;
        lastError = "";
        const record = { id: job.id, prompt: String(job.prompt ?? ""), at: Date.now() };
        await write(STORE_PENDING, record);
        if (value.auto === true) {
          const tabId = pickTargetTab(await tabs.list());
          if (tabId === null) {
            notify.idle();
            await settle(
              value,
              record.id,
              "error",
              "크롬에 열려 있는 웹 페이지가 없어 실행하지 못했습니다. 작업할 페이지를 하나 열어 두세요.",
            );
            return;
          }
          await runPending(record, value, tabId);
          return;
        }
        notify.ask(record);
      } catch (error) {
        lastError = error?.message || "아이쌤봇 연결에 문제가 있습니다.";
        if (error?.unauthorized) {
          const stored = await read(STORE_CONFIG);
          if (stored) await write(STORE_CONFIG, { ...stored, enabled: false });
          notify.idle();
        }
      }
    },

    async approve(jobId, tabId) {
      const value = await config();
      const pending = await read(STORE_PENDING);
      if (!value || !pending?.id || pending.id !== jobId) {
        throw new Error("기다리는 요청이 없습니다. 이미 처리됐거나 시간이 지났습니다.");
      }
      if (busy || agent.isRunning()) throw new Error("크롬에서 다른 작업이 실행 중입니다.");
      const target = Number.isInteger(tabId) ? tabId : pickTargetTab(await tabs.list());
      if (target === null) {
        throw new Error("실행할 웹 페이지를 먼저 열어 주세요.");
      }
      return runPending(pending, value, target);
    },

    async reject(jobId) {
      const value = await config();
      const pending = await read(STORE_PENDING);
      if (!value || !pending?.id || pending.id !== jobId) return { ok: true };
      notify.idle();
      await settle(value, pending.id, "error", "선생님이 이 요청을 거절했습니다.");
      return { ok: true };
    },
  };

  async function beat(value, force) {
    if (!force && Date.now() - lastHeartbeat < HEARTBEAT_MS) return;
    await transportFor(value).heartbeat();
    lastHeartbeat = Date.now();
  }
}

/* ──────────────────────────────── chrome wiring ──────────────────────────────── */

let liveBridge = null;

/** The hook `background.js` tees its run log into, so we can read the agent's own answer. */
export function issamBridgeLog(entry) {
  liveBridge?.onLog(entry);
}

/**
 * Wire the bridge to Chrome.
 *
 * `agent` is the same handle the mobile controller gets: `{isRunning, stop, run(text, tabId)}`.
 */
export function installIssamBridge(agent, api = chrome, workspace = null) {
  const storage = {
    async get(key) {
      return (await api.storage.local.get(key))[key] ?? null;
    },
    async set(key, value) {
      if (value === null || value === undefined) await api.storage.local.remove(key);
      else await api.storage.local.set({ [key]: value });
    },
  };

  let approvalWindowId = null;

  async function openApproval(record) {
    const url = `${api.runtime.getURL("issam.html")}?job=${encodeURIComponent(record.id)}`;
    try {
      if (approvalWindowId !== null) {
        await api.windows.update(approvalWindowId, { focused: true });
        return;
      }
      const created = await api.windows.create({ url, type: "popup", width: 560, height: 680 });
      approvalWindowId = created?.id ?? null;
    } catch {
      // A window can be refused (kiosk mode, no display). The badge is then the only signal,
      // which is worse but is not nothing.
      await api.tabs.create({ url }).catch(() => undefined);
    }
  }

  const notify = {
    ask(record) {
      api.action?.setBadgeText?.({ text: "!" });
      api.action?.setBadgeBackgroundColor?.({ color: "#d93025" });
      api.action?.setTitle?.({ title: `아이쌤봇 요청: ${record.prompt.slice(0, 60)}` });
      void openApproval(record);
    },
    working(record) {
      api.action?.setBadgeText?.({ text: "…" });
      api.action?.setTitle?.({ title: `아이쌤봇 작업 중: ${record.prompt.slice(0, 60)}` });
    },
    idle() {
      api.action?.setBadgeText?.({ text: "" });
      api.action?.setTitle?.({ title: "한밭 도우미 열기" });
    },
  };

  const bridge = createBridge({
    agent: {
      isRunning: () => agent.isRunning(),
      run: (text, tabId) => agent.run(text, tabId),
    },
    storage,
    tabs: { list: () => api.tabs.query({}) },
    notify,
    workspace,
  });
  liveBridge = bridge;

  api.windows?.onRemoved?.addListener((id) => {
    if (id === approvalWindowId) approvalWindowId = null;
  });

  api.runtime.onMessage.addListener((message, sender, reply) => {
    const type = message?.type;
    if (!type?.startsWith?.("issamBridge")) return undefined;
    // Only our own pages may drive this. A web page that could send these would be able to
    // approve a task against the teacher's signed-in browser.
    if (sender.id !== api.runtime.id || !sender.url?.startsWith(api.runtime.getURL(""))) {
      reply({ ok: false, error: "허용되지 않은 요청입니다." });
      return undefined;
    }
    const handlers = {
      issamBridgeStatus: () => bridge.status(),
      issamBridgeConnect: () => bridge.connect(message.code, message.deviceName),
      issamBridgeDisconnect: () => bridge.disconnect(),
      issamBridgeAuto: () => bridge.setAuto(message.auto),
      issamBridgeApprove: () => bridge.approve(message.id, message.tabId),
      issamBridgeReject: () => bridge.reject(message.id),
      issamBridgeTabs: async () => ({
        tabs: (await api.tabs.query({}))
          .filter((tab) => /^https?:/i.test(tab.url || ""))
          .map((tab) => ({
            id: tab.id,
            title: tab.title || "",
            url: tab.url,
            active: !!tab.active,
          })),
      }),
    };
    const handler = handlers[type];
    if (!handler) return undefined;
    Promise.resolve()
      .then(handler)
      .then((value) => reply({ ok: true, ...(value && typeof value === "object" ? value : {}) }))
      .catch((error) =>
        reply({ ok: false, error: error?.message || "요청을 처리하지 못했습니다." }),
      );
    return true;
  });

  // The service worker is killed after seconds of idle; the alarm is what brings it back, and
  // the interval is what keeps polling while it happens to be alive.
  api.alarms.create(ALARM, { periodInMinutes: 0.5 });
  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void bridge.tick();
  });
  setInterval(() => void bridge.tick(), POLL_MS);

  void bridge.recover().then(() => bridge.tick());
  return bridge;
}
