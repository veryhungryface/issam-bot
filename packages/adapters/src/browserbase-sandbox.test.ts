import type { AdapterContext, ProcessEvent } from "@rakazo/adapter-kit";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import type { BrowserbaseClient, BrowserbaseSession } from "./browserbase-client.js";
import { type BrowserbaseBrowserSdk, BrowserbaseSandboxProvider } from "./browserbase-sandbox.js";

describe("BrowserbaseSandboxProvider", () => {
  it("creates a persistent context, connects through CDP, and exposes DOM and screenshots", async () => {
    const fixture = browserFixture();
    const api = apiFixture();
    const provider = new BrowserbaseSandboxProvider(
      { apiKey: "test-key", projectId: "project-1", timeoutSeconds: 300 },
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
    expect(fixture.mouseWheel).toHaveBeenCalledWith(0, 200);

    const observation = await provider.observe(computer, adapterContext());
    expect(observation).toMatchObject({
      mimeType: "image/png",
      width: 1280,
      height: 800,
      activeWindow: { id: "https://example.com/path", title: "Example" },
    });
    expect(observation.image).toEqual(new Uint8Array([1, 2, 3]));
    await expect(provider.observeDom(computer, adapterContext())).resolves.toEqual({
      url: "https://example.com/path",
      title: "Example",
      aria: '- heading "Example"',
    });
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
    workspaceId: "workspace-1",
    userId: "user-1",
    botId: "bot-1",
    runId: "run-1",
    signal: new AbortController().signal,
  };
}

function apiFixture() {
  const createContext = vi.fn(async () => ({ id: "context-1" }));
  const createSession = vi.fn(async () => ({
    id: "session-1",
    connectUrl: "wss://cdp.example/session-1",
    contextId: "context-1",
  }));
  const liveView = vi.fn(async () => ({
    pages: [{ id: "page-1", debuggerFullscreenUrl: "https://live.example/full" }],
  }));
  const getSession = vi.fn(
    async (): Promise<BrowserbaseSession | undefined> => ({
      id: "session-1",
      connectUrl: "wss://cdp.example/session-1",
      contextId: "context-1",
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
  const page = {
    isClosed: vi.fn(() => false),
    setViewportSize: vi.fn(async () => undefined),
    viewportSize: vi.fn(() => ({ width: 1280, height: 800 })),
    screenshot: vi.fn(async () => Buffer.from([1, 2, 3])),
    title: vi.fn(async () => "Example"),
    url: vi.fn(() => currentUrl),
    goto,
    waitForTimeout: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => undefined),
    locator: vi.fn(() => ({
      ariaSnapshot: vi.fn(async () => '- heading "Example"'),
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
    sdk: { connectOverCDP } satisfies BrowserbaseBrowserSdk,
    connectOverCDP,
    goto,
    mouseClick,
    mouseWheel,
    keyboardPress,
    keyboardInsertText,
  };
}
