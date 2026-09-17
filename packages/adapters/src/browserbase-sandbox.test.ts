import type { AdapterContext, ProcessEvent } from "@rakazo/adapter-kit";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import type { BrowserbaseClient, BrowserbaseSession } from "./browserbase-client.js";
import {
  type BrowserbaseBrowserSdk,
  BrowserbaseSandboxProvider,
  providerRefWithoutSession,
} from "./browserbase-sandbox.js";

describe("BrowserbaseSandboxProvider", () => {
  it("declares browser-only capabilities without shell or provider files", () => {
    const provider = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      apiFixture().client,
      browserFixture().sdk,
    );

    expect(provider.describe().capabilities).toMatchObject({
      graphical: true,
      shell: false,
      filesystem: false,
      localFileOpen: false,
      appLaunch: false,
    });
  });

  it("keeps the browser profile when only the session is gone", async () => {
    const withSession = `browserbase:v1:${Buffer.from(
      JSON.stringify({ contextId: "context-1", sessionId: "session-1" }),
    ).toString("base64url")}`;

    // A dead session must leave the Context, and with it every saved login, intact.
    expect(providerRefWithoutSession(withSession)).toBe("browserbase-context:context-1");
    expect(providerRefWithoutSession("browserbase-context:context-1")).toBe(
      "browserbase-context:context-1",
    );
    expect(providerRefWithoutSession(null)).toBeNull();
    // Another provider's sandbox id names no browser profile, so it still clears.
    expect(providerRefWithoutSession("sandbox-ref-1")).toBeNull();
    expect(providerRefWithoutSession("e2b-sandbox-id!!")).toBeNull();
  });

  it("fills sign-in fields only while the page is still on the requested origin", async () => {
    const fixture = browserFixture();
    const api = apiFixture();
    const provider = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      fixture.sdk,
    );
    const computer = await provider.provision(
      { botId: "bot-1", homePath: "/unused" },
      adapterContext(),
    );
    await provider.prepare(computer, adapterContext());
    fixture.goTo("https://auth.example.com/login");

    const result = await provider.fillSecureFields(
      computer,
      {
        origin: "https://auth.example.com",
        submit: true,
        fields: [
          { id: "username", value: "teacher", autocomplete: "username", label: "ID" },
          {
            id: "password",
            value: "hunter2",
            selector: "#missing-field",
            label: "Password",
          },
        ],
      },
      adapterContext(),
    );

    expect(result.filled).toEqual(["username"]);
    expect(result.missing).toEqual(["password"]);
    expect(fixture.fillField).toHaveBeenCalledWith("teacher", expect.anything());
    // Values are write-only: nothing about them comes back to the caller.
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(fixture.pressField).toHaveBeenCalledWith("Enter", expect.anything());
  });

  it("refuses to fill after the page navigates away from the requested origin", async () => {
    const fixture = browserFixture();
    const api = apiFixture();
    const provider = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      fixture.sdk,
    );
    const computer = await provider.provision(
      { botId: "bot-1", homePath: "/unused" },
      adapterContext(),
    );
    await provider.prepare(computer, adapterContext());
    // The user saw auth.example.com, but the page moved on before they submitted.
    fixture.goTo("https://evil.example.net/collect");

    await expect(
      provider.fillSecureFields(
        computer,
        {
          origin: "https://auth.example.com",
          fields: [{ id: "password", value: "hunter2", autocomplete: "current-password" }],
        },
        adapterContext(),
      ),
    ).rejects.toThrow(/no longer on the site/);
    expect(fixture.fillField).not.toHaveBeenCalled();
  });

  it("creates a persistent context, connects through CDP, and exposes DOM and screenshots", async () => {
    const fixture = browserFixture();
    const api = apiFixture();
    const provider = new BrowserbaseSandboxProvider(
      {
        apiKey: "test-key",
        projectId: "project-1",
        timeoutSeconds: 300,
        region: "ap-southeast-1",
      },
      api.client,
      fixture.sdk,
    );

    const computer = await provider.provision(
      { botId: "bot-1", homePath: "/unused" },
      adapterContext(),
    );
    await provider.prepare(computer, adapterContext());

    expect(computer).toMatchObject({
      kind: "browserbase",
      providerRef: expect.stringMatching(/^browserbase:v1:/),
      fresh: true,
    });
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        contextId: "context-1",
        timeoutSeconds: 300,
        region: "ap-southeast-1",
        metadata: expect.objectContaining({
          botId: "bot-1",
          workspaceId: "workspace-1",
        }),
      }),
    );
    expect(fixture.connectOverCDP).toHaveBeenCalledWith("wss://cdp.example/session-1");

    await provider.act(
      computer,
      {
        actions: [
          { kind: "open", path: "https://example.com/path" },
          { kind: "pointer", type: "click", x: 10, y: 20 },
          { kind: "key", key: "A", modifiers: ["Control"] },
          { kind: "key", key: "Return" },
          { kind: "text", text: "한글 입력" },
          { kind: "clipboard", text: "타이핑 문구" },
          { kind: "scroll", direction: "down", amount: 200 },
        ],
        observe: false,
      },
      adapterContext(),
    );
    expect(fixture.goto).toHaveBeenCalledWith(
      "https://example.com/path",
      expect.objectContaining({ waitUntil: "domcontentloaded" }),
    );
    expect(fixture.mouseClick).toHaveBeenCalledWith(10, 20, { button: "left" });
    expect(fixture.keyboardPress).toHaveBeenCalledWith("Control+A");
    expect(fixture.keyboardPress).toHaveBeenCalledWith("Enter");
    expect(fixture.keyboardInsertText).toHaveBeenCalledWith("한글 입력");
    expect(fixture.keyboardInsertText).toHaveBeenCalledWith("타이핑 문구");
    expect(fixture.mouseWheel).toHaveBeenCalledWith(0, 200);

    const observation = await provider.observe(computer, adapterContext());
    expect(fixture.screenshot).toHaveBeenCalledWith({ type: "png", scale: "css" });
    expect(observation).toMatchObject({
      mimeType: "image/png",
      width: 1280,
      height: 800,
      url: "https://example.com/path",
      title: "Example",
      aria: '- heading "Example"',
      activeWindow: { id: "https://example.com/path", title: "Example" },
    });
    expect(observation.image).toEqual(new Uint8Array([1, 2, 3]));
    await expect(provider.observeDom(computer, adapterContext())).resolves.toEqual({
      url: "https://example.com/path",
      title: "Example",
      aria: '- heading "Example"',
    });
    expect(api.getSession).not.toHaveBeenCalled();
  });

  it("still types clipboard text when the clipboard write is denied", async () => {
    const fixture = browserFixture();
    const api = apiFixture();
    const provider = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      fixture.sdk,
    );
    const computer = await provider.provision(
      { botId: "bot-1", homePath: "/unused" },
      adapterContext(),
    );
    await provider.prepare(computer, adapterContext());
    fixture.evaluate.mockRejectedValueOnce(new Error("clipboard denied"));

    const acted = await provider.act(
      computer,
      { actions: [{ kind: "clipboard", text: "붙여넣기 실패 대비" }], observe: false },
      adapterContext(),
    );

    expect(acted.completed).toBe(1);
    expect(fixture.keyboardInsertText).toHaveBeenCalledWith("붙여넣기 실패 대비");
  });

  it("rejects typing when no page element is focused instead of silently dropping it", async () => {
    const fixture = browserFixture();
    const api = apiFixture();
    const provider = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      fixture.sdk,
    );
    const computer = await provider.provision(
      { botId: "bot-1", homePath: "/unused" },
      adapterContext(),
    );
    await provider.prepare(computer, adapterContext());
    fixture.evaluate.mockResolvedValueOnce(false);

    await expect(
      provider.act(
        computer,
        { actions: [{ kind: "text", text: "포커스 없음" }], observe: false },
        adapterContext(),
      ),
    ).rejects.toThrow("No input is focused");
    expect(fixture.keyboardInsertText).not.toHaveBeenCalled();
  });

  it("reuses a saved context, pauses bot actions during takeover, and returns Live View", async () => {
    const fixture = browserFixture();
    const api = apiFixture();
    const provider = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      fixture.sdk,
    );
    const context = adapterContext();
    const computer = await provider.provision(
      {
        botId: "bot-1",
        homePath: "/unused",
        providerRef: "browserbase-context:context-existing",
      },
      context,
    );

    expect(api.createContext).not.toHaveBeenCalled();
    expect(api.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ contextId: "context-existing" }),
    );
    await expect(
      provider.connectScreen(computer, { view: "stream", interactive: true }, context),
    ).rejects.toThrow(/control token/);
    const screen = await provider.connectScreen(
      computer,
      { view: "stream", interactive: true, controlToken: "lease-1" },
      context,
    );
    expect(screen).toMatchObject({
      url: "https://live.example/full",
      mimeType: "text/html",
    });
    await expect(
      provider.act(computer, { actions: [{ kind: "wait", ms: 1 }] }, context),
    ).rejects.toThrow(/held by the user/);
    await provider.setScreenControl(computer, false, context, "lease-1");
    await expect(
      provider.act(computer, { actions: [{ kind: "wait", ms: 1 }], observe: false }, context),
    ).resolves.toMatchObject({ completed: 1 });
  });

  it("turns a stale connected-page observation failure into a recoverable session error", async () => {
    const fixture = browserFixture();
    const api = apiFixture();
    const provider = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      fixture.sdk,
    );
    const computer = await provider.provision(
      { botId: "bot-1", homePath: "/unused" },
      adapterContext(),
    );
    await provider.prepare(computer, adapterContext());
    fixture.screenshot.mockRejectedValueOnce(
      new Error("Target page, context or browser has been closed"),
    );

    await expect(provider.observe(computer, adapterContext())).rejects.toMatchObject({
      name: "ComputerSessionUnavailableError",
    });
    expect(api.getSession).not.toHaveBeenCalled();

    api.createSession.mockResolvedValueOnce({
      id: "session-2",
      connectUrl: "wss://cdp.example/session-2",
      contextId: "context-1",
    });
    const replacement = await provider.provision(
      { botId: "bot-1", homePath: "/unused", providerRef: computer.providerRef },
      adapterContext(),
    );
    expect(replacement.providerRef).not.toBe(computer.providerRef);
    expect(replacement.fresh).toBe(false);
    expect(api.getSession).not.toHaveBeenCalled();
    expect(api.createSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ contextId: "context-1" }),
    );
  });

  it("recovers Live View in an API process without opening a CDP connection", async () => {
    const api = apiFixture();
    const workerBrowser = browserFixture();
    const worker = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      workerBrowser.sdk,
    );
    const computer = await worker.provision(
      { botId: "bot-1", homePath: "/unused" },
      adapterContext(),
    );
    const apiBrowser = browserFixture();
    const apiProvider = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      apiBrowser.sdk,
    );

    await expect(
      apiProvider.connectScreen(computer, { view: "stream" }, adapterContext()),
    ).resolves.toMatchObject({ url: "https://live.example/full" });
    expect(api.liveView).toHaveBeenCalledWith("session-1");
    expect(apiBrowser.connectOverCDP).not.toHaveBeenCalled();
  });

  it("recovers CDP in a new API provider and inserts Unicode text into the focused element", async () => {
    const api = apiFixture();
    const worker = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      browserFixture().sdk,
    );
    const computer = await worker.provision(
      { botId: "bot-1", homePath: "/unused" },
      adapterContext(),
    );
    const apiBrowser = browserFixture();
    const apiProvider = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      apiBrowser.sdk,
    );

    await apiProvider.sendInput(
      computer,
      { kind: "text", text: "라면" },
      { leaseId: "lease-1", holder: "user", fence: 1 },
      adapterContext(),
    );

    expect(api.getSession).toHaveBeenCalledWith("session-1");
    expect(apiBrowser.connectOverCDP).toHaveBeenCalledWith("wss://cdp.example/session-1");
    expect(apiBrowser.keyboardInsertText).toHaveBeenCalledWith("라면");
  });

  it("recovers an active session and CDP connection after a worker restart", async () => {
    const api = apiFixture();
    const first = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      browserFixture().sdk,
    );
    const saved = await first.provision({ botId: "bot-1", homePath: "/unused" }, adapterContext());
    const recoveredBrowser = browserFixture();
    const recovered = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      recoveredBrowser.sdk,
    );
    const computer = await recovered.provision(
      { botId: "bot-1", homePath: "/unused", providerRef: saved.providerRef },
      adapterContext(),
    );
    await recovered.prepare(computer, adapterContext());

    expect(computer.providerRef).toBe(saved.providerRef);
    expect(computer.fresh).toBe(false);
    expect(api.getSession).toHaveBeenCalledWith("session-1");
    expect(api.createSession).toHaveBeenCalledTimes(1);
    expect(recoveredBrowser.connectOverCDP).toHaveBeenCalledWith("wss://cdp.example/session-1");
  });

  it("reports a persisted timed-out session as recoverable before observing in a new worker", async () => {
    const api = apiFixture();
    const first = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      browserFixture().sdk,
    );
    const saved = await first.provision({ botId: "bot-1", homePath: "/unused" }, adapterContext());
    api.getSession.mockResolvedValueOnce({
      id: "session-1",
      connectUrl: "wss://cdp.example/session-1",
      contextId: "context-1",
      status: "TIMED_OUT",
    });
    const restartedBrowser = browserFixture();
    const restarted = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      restartedBrowser.sdk,
    );

    await expect(restarted.observe(saved, adapterContext())).rejects.toMatchObject({
      name: "ComputerSessionUnavailableError",
    });
    expect(api.getSession).toHaveBeenCalledWith("session-1");
    expect(restartedBrowser.connectOverCDP).not.toHaveBeenCalled();
  });

  it("replaces a terminal persisted session while retaining its browser context", async () => {
    const api = apiFixture();
    const first = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      browserFixture().sdk,
    );
    const saved = await first.provision({ botId: "bot-1", homePath: "/unused" }, adapterContext());
    api.getSession.mockResolvedValueOnce({
      id: "session-1",
      connectUrl: "wss://cdp.example/session-1",
      contextId: "context-1",
      status: "TIMED_OUT",
    });
    api.createSession.mockResolvedValueOnce({
      id: "session-2",
      connectUrl: "wss://cdp.example/session-2",
      contextId: "context-1",
    });
    const recovered = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      browserFixture().sdk,
    );
    const replacement = await recovered.provision(
      { botId: "bot-1", homePath: "/unused", providerRef: saved.providerRef },
      adapterContext(),
    );

    expect(replacement.providerRef).not.toBe(saved.providerRef);
    expect(replacement.fresh).toBe(false);
    expect(api.createContext).toHaveBeenCalledTimes(1);
    expect(api.createSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ contextId: "context-1" }),
    );
  });

  it("deduplicates a terminal in-process session replacement and preserves its context", async () => {
    const api = apiFixture();
    const provider = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      browserFixture().sdk,
    );
    const saved = await provider.provision(
      { botId: "bot-1", homePath: "/unused" },
      adapterContext(),
    );
    api.getSession.mockResolvedValue({
      id: "session-1",
      connectUrl: "wss://cdp.example/session-1",
      contextId: "context-1",
      status: "TIMED_OUT",
    });
    api.createSession.mockResolvedValue({
      id: "session-2",
      connectUrl: "wss://cdp.example/session-2",
      contextId: "context-1",
    });

    const replacements = await Promise.all([
      provider.provision(
        { botId: "bot-1", homePath: "/unused", providerRef: saved.providerRef },
        adapterContext(),
      ),
      provider.provision(
        { botId: "bot-1", homePath: "/unused", providerRef: saved.providerRef },
        adapterContext(),
      ),
    ]);

    expect(replacements[0]?.providerRef).toBe(replacements[1]?.providerRef);
    expect(replacements[0]?.providerRef).not.toBe(saved.providerRef);
    expect(replacements[0]?.fresh).toBe(false);
    expect(api.createContext).toHaveBeenCalledTimes(1);
    expect(api.createSession).toHaveBeenCalledTimes(2);
    expect(api.createSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ contextId: "context-1" }),
    );
  });

  it("never runs shell commands and cleans sessions and contexts independently", async () => {
    const stopped = apiFixture();
    const stoppedProvider = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      stopped.client,
      browserFixture().sdk,
    );
    const stoppedComputer = await stoppedProvider.provision(
      { botId: "bot-1", homePath: "/unused" },
      adapterContext(),
    );
    const events: ProcessEvent[] = [];
    for await (const event of stoppedProvider.execute(
      stoppedComputer,
      { argv: ["sh", "-c", "id"] },
      adapterContext(),
    )) {
      events.push(event);
    }
    expect(events).toEqual([
      expect.objectContaining({ type: "stderr" }),
      { type: "exit", code: 126 },
    ]);
    await stoppedProvider.stop(stoppedComputer, adapterContext());
    expect(stopped.endSession).toHaveBeenCalledWith("session-1");
    expect(stopped.deleteContext).not.toHaveBeenCalled();

    const destroyed = apiFixture();
    const destroyedProvider = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      destroyed.client,
      browserFixture().sdk,
    );
    const destroyedComputer = await destroyedProvider.provision(
      { botId: "bot-1", homePath: "/unused" },
      adapterContext(),
    );
    await destroyedProvider.destroy(destroyedComputer, adapterContext());
    expect(destroyed.endSession).toHaveBeenCalledWith("session-1");
    expect(destroyed.deleteContext).toHaveBeenCalledWith("context-1");
  });

  it("ends a session and forgets it when CDP setup fails", async () => {
    const api = apiFixture();
    const sdk: BrowserbaseBrowserSdk = {
      connectOverCDP: vi.fn(async () => {
        throw new Error("websocket refused");
      }),
    };
    const provider = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      sdk,
    );
    const computer = await provider.provision(
      { botId: "bot-1", homePath: "/unused" },
      adapterContext(),
    );
    await expect(provider.prepare(computer, adapterContext())).rejects.toThrow(
      /Could not connect to Browserbase Chrome/,
    );
    expect(api.endSession).toHaveBeenCalledWith("session-1");
    await expect(provider.observe(computer, adapterContext())).rejects.toThrow(/not provisioned/);
  });

  it("blocks private navigation before Playwright receives it", async () => {
    const fixture = browserFixture();
    const api = apiFixture();
    const provider = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1" },
      api.client,
      fixture.sdk,
    );
    const computer = await provider.provision(
      { botId: "bot-1", homePath: "/unused" },
      adapterContext(),
    );
    await expect(
      provider.act(
        computer,
        {
          actions: [{ kind: "open", path: "http://169.254.169.254/latest/meta-data" }],
        },
        adapterContext(),
      ),
    ).rejects.toThrow(/blocked/);
    expect(fixture.goto).not.toHaveBeenCalled();
  });
});

function adapterContext(): AdapterContext {
  return {
    operationId: "operation-1",
    traceId: "trace-1",
    spaceId: "workspace-1",
    userId: "user-1",
    botId: "bot-1",
    runId: "run-1",
    signal: new AbortController().signal,
  };
}

function apiFixture() {
  let currentContextId = "context-1";
  const createContext = vi.fn(async () => ({ id: "context-1" }));
  const createSession = vi.fn(async (input: { contextId: string }) => {
    currentContextId = input.contextId;
    return {
      id: "session-1",
      connectUrl: "wss://cdp.example/session-1",
      contextId: input.contextId,
    };
  });
  const liveView = vi.fn(async () => ({
    pages: [{ id: "page-1", debuggerFullscreenUrl: "https://live.example/full" }],
  }));
  const getSession = vi.fn(
    async (): Promise<BrowserbaseSession | undefined> => ({
      id: "session-1",
      connectUrl: "wss://cdp.example/session-1",
      contextId: currentContextId,
      status: "RUNNING",
    }),
  );
  const endSession = vi.fn(async () => undefined);
  const deleteContext = vi.fn(async () => undefined);
  return {
    createContext,
    createSession,
    liveView,
    getSession,
    endSession,
    deleteContext,
    client: {
      createContext,
      createSession,
      liveView,
      getSession,
      endSession,
      deleteContext,
    } as unknown as BrowserbaseClient,
  };
}

function browserFixture() {
  let currentUrl = "about:blank";
  const goto = vi.fn(async (url: string) => {
    currentUrl = url;
    return null;
  });
  const mouseClick = vi.fn(async () => undefined);
  const mouseWheel = vi.fn(async () => undefined);
  const keyboardPress = vi.fn(async () => undefined);
  const keyboardInsertText = vi.fn(async () => undefined);
  const evaluate = vi.fn(async (): Promise<unknown> => true);
  const fillField = vi.fn(async () => undefined);
  const pressField = vi.fn(async () => undefined);
  const screenshot = vi.fn(async () => Buffer.from([1, 2, 3]));
  const page = {
    isClosed: vi.fn(() => false),
    setViewportSize: vi.fn(async () => undefined),
    viewportSize: vi.fn(() => ({ width: 1280, height: 800 })),
    screenshot,
    title: vi.fn(async () => "Example"),
    url: vi.fn(() => currentUrl),
    goto,
    waitForTimeout: vi.fn(async () => undefined),
    evaluate,
    locator: vi.fn((selector?: string) => ({
      ariaSnapshot: vi.fn(async () => '- heading "Example"'),
      first: vi.fn(() => ({
        isVisible: vi.fn(async () => !String(selector ?? "").includes("missing")),
        fill: fillField,
        press: pressField,
      })),
    })),
    getByLabel: vi.fn(() => ({
      first: vi.fn(() => ({
        isVisible: vi.fn(async () => false),
        fill: fillField,
        press: pressField,
      })),
    })),
    mouse: {
      move: vi.fn(async () => undefined),
      down: vi.fn(async () => undefined),
      up: vi.fn(async () => undefined),
      click: mouseClick,
      wheel: mouseWheel,
    },
    keyboard: { press: keyboardPress, insertText: keyboardInsertText },
  } as unknown as Page;
  const browserContext = {
    pages: vi.fn(() => [page]),
    newPage: vi.fn(async () => page),
    route: vi.fn(async () => undefined),
    grantPermissions: vi.fn(async () => undefined),
  } as unknown as BrowserContext;
  const browser = {
    isConnected: vi.fn(() => true),
    contexts: vi.fn(() => [browserContext]),
    newContext: vi.fn(async () => browserContext),
    close: vi.fn(async () => undefined),
  } as unknown as Browser;
  const connectOverCDP = vi.fn(async () => browser);
  return {
    fillField,
    pressField,
    goTo: (url: string) => {
      currentUrl = url;
    },
    sdk: { connectOverCDP } satisfies BrowserbaseBrowserSdk,
    connectOverCDP,
    goto,
    mouseClick,
    mouseWheel,
    keyboardPress,
    keyboardInsertText,
    evaluate,
    screenshot,
  };
}
