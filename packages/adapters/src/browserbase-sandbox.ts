import type {
  AdapterContext,
  CommandRequest,
  ComputerAction,
  ComputerActionRequest,
  ComputerFileEntry,
  ComputerInput,
  ComputerRef,
  ControlLeaseRef,
  PortableFile,
  ProcessEvent,
  SandboxProvider,
  ScreenRequest,
  ScreenSession,
  SnapshotRef,
} from "@rakazo/adapter-kit";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import {
  assertAllowedBrowserUrl,
  BrowserbaseClient,
  type BrowserbaseRegion,
  type BrowserbaseSession,
} from "./browserbase-client.js";
import { ComputerSessionUnavailableError } from "./computer-lifecycle.js";
import { boundedComputerActions, computerObservation } from "./computer-support.js";

const PROVIDER_REF_PREFIX = "browserbase:v1:";
const LEGACY_CONTEXT_REF_PREFIX = "browserbase-context:";
const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;

export interface BrowserbaseSandboxOptions {
  apiKey: string;
  projectId: string;
  timeoutSeconds?: number;
  region?: BrowserbaseRegion;
}

export interface BrowserbaseBrowserSdk {
  connectOverCDP(endpointURL: string): Promise<Browser>;
}

interface BrowserbaseBox {
  ref: ComputerRef;
  contextId: string;
  session: BrowserbaseSession;
  browser?: Browser;
  browserContext?: BrowserContext;
  page?: Page;
  userControlling: boolean;
  controlToken?: string;
  screenLeaseId?: string;
}

interface BrowserbaseProviderRef {
  contextId: string;
  sessionId?: string;
}

/**
 * Browser-only sandbox backed by Browserbase Cloud Chrome.
 *
 * Browserbase Context and active Session IDs are persisted in providerRef so the
 * API and worker can independently recover Live View and CDP access. Connection
 * URLs and API keys are never persisted in the reference.
 */
export class BrowserbaseSandboxProvider implements SandboxProvider {
  private readonly boxes = new Map<string, BrowserbaseBox>();
  private readonly recoveries = new Map<string, Promise<BrowserbaseBox>>();
  private readonly sessionCreations = new Map<string, Promise<BrowserbaseSession>>();
  private readonly failedProviderRefs = new Set<string>();
  private readonly client: BrowserbaseClient;
  private readonly sdk: BrowserbaseBrowserSdk;

  constructor(
    private readonly options: BrowserbaseSandboxOptions,
    client?: BrowserbaseClient,
    sdk: BrowserbaseBrowserSdk = chromium,
  ) {
    if (!options.apiKey || !options.projectId) {
      throw new Error("Browserbase API key and project ID are required");
    }
    this.client = client ?? new BrowserbaseClient(options);
    this.sdk = sdk;
  }

  describe() {
    return {
      id: "browserbase",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        graphical: true,
        pty: false,
        shell: false,
        filesystem: false,
        localFileOpen: false,
        appLaunch: false,
        snapshots: false,
        takeover: true,
        persistentHome: true,
        multiScreen: false,
      },
    };
  }

  async provision(
    request: {
      botId: string;
      homePath: string;
      providerRef?: string;
      providerKind?: ComputerRef["kind"];
    },
    context: AdapterContext,
  ): Promise<ComputerRef> {
    throwIfAborted(context);
    const knownUnavailable = request.providerRef
      ? this.failedProviderRefs.delete(request.providerRef)
      : false;
    const existing = request.providerRef ? this.boxes.get(request.providerRef) : undefined;
    if (existing && !knownUnavailable) {
      const active = await this.recoverSession(existing.session.id, existing.contextId);
      if (active) {
        existing.session = active;
        throwIfAborted(context);
        return { ...existing.ref, fresh: false };
      }
      await this.closeRuntime(existing).catch(() => undefined);
      this.boxes.delete(request.providerRef!);
    }
    if (existing && knownUnavailable) {
      await this.closeRuntime(existing).catch(() => undefined);
      this.boxes.delete(request.providerRef!);
    }

    const previous = request.providerRef ? decodeProviderRef(request.providerRef) : undefined;
    const previousContextId = previous?.contextId;
    const contextId = previousContextId ?? (await this.client.createContext()).id;
    if (!contextId) throw new Error("Browserbase returned an empty context ID");
    if (context.signal.aborted) {
      if (!previousContextId) await this.client.deleteContext(contextId).catch(() => undefined);
      throw context.signal.reason ?? new Error("Browserbase provisioning aborted");
    }

    let session =
      !knownUnavailable && previous?.sessionId
        ? await this.recoverSession(previous.sessionId, contextId)
        : undefined;
    try {
      session ??= await this.createSession(contextId, request.botId, context);
    } catch (error) {
      if (!previousContextId) await this.client.deleteContext(contextId).catch(() => undefined);
      throw error;
    }
    if (!session.id || !session.connectUrl) {
      await this.client.endSession(session.id).catch(() => undefined);
      if (!previousContextId) await this.client.deleteContext(contextId).catch(() => undefined);
      throw new Error("Browserbase returned an incomplete session");
    }
    if (context.signal.aborted) {
      await this.client.endSession(session.id).catch(() => undefined);
      if (!previousContextId) await this.client.deleteContext(contextId).catch(() => undefined);
      throw context.signal.reason ?? new Error("Browserbase provisioning aborted");
    }

    const providerRef = encodeProviderRef(contextId, session.id);
    const ref: ComputerRef = {
      id: providerRef,
      botId: request.botId,
      kind: "browserbase",
      providerRef,
      fresh: previousContextId === undefined,
    };
    this.boxes.set(providerRef, {
      ref,
      contextId,
      session,
      userControlling: false,
    });
    return ref;
  }

  async prepare(computer: ComputerRef, context: AdapterContext): Promise<void> {
    const box = this.requiredBox(computer);
    if (box.browser?.isConnected() && box.page && !box.page.isClosed()) return;
    throwIfAborted(context);
    try {
      const browser = await this.sdk.connectOverCDP(box.session.connectUrl);
      throwIfAborted(context);
      const browserContext =
        browser.contexts()[0] ?? (await browser.newContext({ viewport: DEFAULT_VIEWPORT }));
      await installNetworkPolicy(browserContext);
      const page = browserContext.pages()[0] ?? (await browserContext.newPage());
      await page.setViewportSize(DEFAULT_VIEWPORT).catch(() => undefined);
      box.browser = browser;
      box.browserContext = browserContext;
      box.page = page;
    } catch (error) {
      await this.closeRuntime(box);
      await this.client.endSession(box.session.id).catch(() => undefined);
      this.boxes.delete(box.ref.providerRef);
      this.failedProviderRefs.add(box.ref.providerRef);
      throw new ComputerSessionUnavailableError(
        `Could not connect to Browserbase Chrome: ${errorMessage(error)}`,
        {
          cause: error,
        },
      );
    }
  }

  async *execute(
    _computer: ComputerRef,
    _request: CommandRequest,
    _context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    yield {
      type: "stderr",
      data: "Browserbase is a browser-only provider; shell execution is disabled.\n",
    };
    yield { type: "exit", code: 126 };
  }

  async connectScreen(
    computer: ComputerRef,
    request: ScreenRequest,
    context: AdapterContext,
  ): Promise<ScreenSession> {
    ensureBrowserbaseComputer(computer);
    const reference = decodeProviderRef(computer.providerRef);
    if (!reference.sessionId)
      throw new Error("Browserbase provider reference has no active session");
    const box = this.boxes.get(computer.providerRef);
    if (request.interactive) {
      if (!request.controlToken) throw new Error("interactive screen requires a control token");
      if (box) {
        box.userControlling = true;
        box.controlToken = request.controlToken;
        box.screenLeaseId = context.screenLeaseId;
      }
    }
    const view = await this.client.liveView(reference.sessionId);
    throwIfAborted(context);
    const firstPage = view.pages[0];
    const url =
      firstPage?.debuggerFullscreenUrl ??
      view.debuggerFullscreenUrl ??
      firstPage?.debuggerUrl ??
      view.debuggerUrl;
    if (!url) throw new Error("Browserbase did not return a Live View URL");
    return {
      url,
      mimeType: "text/html",
      close: async () => undefined,
    };
  }

  async setScreenControl(
    computer: ComputerRef,
    interactive: boolean,
    context: AdapterContext,
    controlToken?: string,
  ): Promise<void> {
    ensureBrowserbaseComputer(computer);
    const box = this.boxes.get(computer.providerRef);
    if (interactive) {
      if (!controlToken) throw new Error("interactive screen requires a control token");
      if (box) {
        box.userControlling = true;
        box.controlToken = controlToken;
        box.screenLeaseId = context.screenLeaseId;
      }
      return;
    }
    if (!box) return;
    if (box.controlToken && controlToken && box.controlToken !== controlToken) return;
    box.userControlling = false;
    box.controlToken = undefined;
    box.screenLeaseId = undefined;
  }

  async sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    lease: ControlLeaseRef,
    context: AdapterContext,
  ): Promise<void> {
    const box = await this.readyBox(computer, context);
    if (lease.holder !== "user" && box.userControlling) {
      throw new Error("Browserbase control is currently held by the user");
    }
    await applyBrowserAction(box, input, context);
  }

  /** Recent provider sessions with billing-relevant timestamps and metadata. */
  async listSessionUsage() {
    const [completed, running] = await Promise.all([
      this.client.listSessions("COMPLETED"),
      this.client.listSessions("RUNNING"),
    ]);
    return [...completed, ...running];
  }

  async observe(computer: ComputerRef, context: AdapterContext) {
    const box = await this.readyBox(computer, context);
    try {
      return await observeBox(box, context);
    } catch (error) {
      if (!isUnavailableBrowserRuntime(box, error)) throw error;
      return this.invalidateRuntime(box, error);
    }
  }

  /** Accessibility-oriented DOM state for DOM-first browser agents. */
  async observeDom(
    computer: ComputerRef,
    context: AdapterContext,
  ): Promise<{ url: string; title: string; aria: string }> {
    const box = await this.readyBox(computer, context);
    const page = requiredPage(box);
    throwIfAborted(context);
    try {
      const [title, aria] = await Promise.all([
        page.title(),
        page.locator("body").ariaSnapshot({ timeout: 10_000 }),
      ]);
      throwIfAborted(context);
      return { url: page.url(), title, aria: aria.slice(0, 100_000) };
    } catch (error) {
      if (!isUnavailableBrowserRuntime(box, error)) throw error;
      return this.invalidateRuntime(box, error);
    }
  }

  async act(computer: ComputerRef, request: ComputerActionRequest, context: AdapterContext) {
    const box = await this.readyBox(computer, context);
    if (box.userControlling) throw new Error("Browserbase control is currently held by the user");
    const actions = boundedComputerActions(request.actions);
    let completed = 0;
    for (const action of actions) {
      await applyBrowserAction(box, action, context);
      completed += 1;
    }
    if (request.settleMs) {
      await requiredPage(box).waitForTimeout(Math.min(Math.max(request.settleMs, 0), 30_000));
    }
    return {
      completed,
      ...(request.observe === false ? {} : { observation: await observeBox(box, context) }),
    };
  }

  async listFiles(
    _computer: ComputerRef,
    _path: string,
    _context: AdapterContext,
  ): Promise<ComputerFileEntry[]> {
    return [];
  }

  async readFile(
    _computer: ComputerRef,
    _path: string,
    _context: AdapterContext,
    _options?: { maxBytes?: number },
  ): Promise<Uint8Array> {
    throw new Error("Browserbase workspace file reads are not supported");
  }

  async writeFile(
    _computer: ComputerRef,
    _file: PortableFile,
    _context: AdapterContext,
  ): Promise<void> {
    throw new Error("Browserbase workspace file writes are not supported");
  }

  async *exportWorkspace(
    _computer: ComputerRef,
    _context: AdapterContext,
  ): AsyncIterable<PortableFile> {}

  async importWorkspace(
    _computer: ComputerRef,
    files: AsyncIterable<PortableFile>,
    _context: AdapterContext,
  ): Promise<void> {
    // The browser profile is persisted by Browserbase Context, not Rakazo's portable workspace.
    for await (const _file of files) {
      // Drain the source so streaming home stores can release their resources.
    }
  }

  async snapshot(_computer: ComputerRef, _context: AdapterContext): Promise<SnapshotRef> {
    throw new Error("Browserbase snapshots are represented by persistent Contexts");
  }

  async keepAlive(computer: ComputerRef): Promise<void> {
    const box = this.requiredBox(computer);
    if (!box.browser?.isConnected()) throw new Error("Browserbase session is not connected");
    await requiredPage(box).evaluate(() => "alive");
  }

  async releaseScreen(computer: ComputerRef, context: AdapterContext): Promise<void> {
    const box = this.boxes.get(computer.providerRef);
    if (!box) return;
    if (context.screenLeaseId && box.screenLeaseId && context.screenLeaseId !== box.screenLeaseId) {
      return;
    }
    box.userControlling = false;
    box.controlToken = undefined;
    box.screenLeaseId = undefined;
  }

  async stop(computer: ComputerRef, _context: AdapterContext): Promise<void> {
    const box = this.boxes.get(computer.providerRef);
    const reference = decodeProviderRef(computer.providerRef);
    this.boxes.delete(computer.providerRef);
    this.failedProviderRefs.delete(computer.providerRef);
    const cleanup: Promise<unknown>[] = [];
    if (box) cleanup.push(this.closeRuntime(box));
    if (reference.sessionId) cleanup.push(this.client.endSession(reference.sessionId));
    const errors = await Promise.allSettled(cleanup);
    throwCleanupError(errors, "stop Browserbase session");
  }

  async destroy(computer: ComputerRef, _context: AdapterContext): Promise<void> {
    const box = this.boxes.get(computer.providerRef);
    const reference = decodeProviderRef(computer.providerRef);
    const contextId = box?.contextId ?? reference.contextId;
    const results: PromiseSettledResult<unknown>[] = [];
    this.failedProviderRefs.delete(computer.providerRef);
    if (box) {
      this.boxes.delete(computer.providerRef);
      results.push(...(await Promise.allSettled([this.closeRuntime(box)])));
    }
    // Browserbase will reject Context deletion while its Session is still
    // active. Request release first, then delete the persistent Context.
    if (reference.sessionId) {
      results.push(...(await Promise.allSettled([this.client.endSession(reference.sessionId)])));
    }
    results.push(...(await Promise.allSettled([this.client.deleteContext(contextId)])));
    throwCleanupError(results, "destroy Browserbase context");
  }

  private requiredBox(computer: ComputerRef): BrowserbaseBox {
    ensureBrowserbaseComputer(computer);
    const box = this.boxes.get(computer.providerRef);
    if (!box) throw new Error("Browserbase computer is not provisioned in this worker");
    return box;
  }

  private async readyBox(computer: ComputerRef, context: AdapterContext): Promise<BrowserbaseBox> {
    if (this.failedProviderRefs.has(computer.providerRef)) {
      throw new ComputerSessionUnavailableError(
        "Browserbase computer is not provisioned in this worker",
      );
    }
    const pending = this.recoveries.get(computer.providerRef);
    if (pending) return pending;
    const existing = this.boxes.get(computer.providerRef);
    if (existing) {
      if (existing.browser?.isConnected() && existing.page && !existing.page.isClosed()) {
        throwIfAborted(context);
        return existing;
      }
      const active = await this.recoverSession(existing.session.id, existing.contextId);
      if (!active) {
        await this.closeRuntime(existing).catch(() => undefined);
        this.boxes.delete(computer.providerRef);
        this.failedProviderRefs.add(computer.providerRef);
        throw new ComputerSessionUnavailableError("Browserbase session is no longer running");
      }
      existing.session = active;
      await this.prepare(computer, context);
      return existing;
    }

    const recovery = this.recoverBox(computer, context);
    this.recoveries.set(computer.providerRef, recovery);
    try {
      return await recovery;
    } finally {
      if (this.recoveries.get(computer.providerRef) === recovery) {
        this.recoveries.delete(computer.providerRef);
      }
    }
  }

  private async recoverBox(
    computer: ComputerRef,
    context: AdapterContext,
  ): Promise<BrowserbaseBox> {
    ensureBrowserbaseComputer(computer);
    throwIfAborted(context);
    const reference = decodeProviderRef(computer.providerRef);
    if (!reference.sessionId) {
      throw new Error("Browserbase provider reference has no active session");
    }
    const session = await this.recoverSession(reference.sessionId, reference.contextId);
    if (!session) {
      throw new ComputerSessionUnavailableError("Browserbase session is no longer running");
    }
    const box: BrowserbaseBox = {
      ref: { ...computer, fresh: false },
      contextId: reference.contextId,
      session,
      userControlling: false,
    };
    this.boxes.set(computer.providerRef, box);
    await this.prepare(computer, context);
    return box;
  }

  private async closeRuntime(box: BrowserbaseBox): Promise<void> {
    const browser = box.browser;
    box.page = undefined;
    box.browserContext = undefined;
    box.browser = undefined;
    box.userControlling = false;
    box.controlToken = undefined;
    box.screenLeaseId = undefined;
    if (browser) await browser.close();
  }

  private async invalidateRuntime(box: BrowserbaseBox, cause: unknown): Promise<never> {
    await this.closeRuntime(box).catch(() => undefined);
    this.boxes.delete(box.ref.providerRef);
    this.failedProviderRefs.add(box.ref.providerRef);
    throw new ComputerSessionUnavailableError(
      "Browserbase session disconnected during observation",
      {
        cause,
      },
    );
  }

  private async recoverSession(
    sessionId: string,
    expectedContextId: string,
  ): Promise<BrowserbaseSession | undefined> {
    const session = await this.client.getSession(sessionId);
    if (!session || (session.status !== "RUNNING" && session.status !== "PENDING"))
      return undefined;
    if (!session.id || !session.connectUrl) return undefined;
    if (session.contextId && session.contextId !== expectedContextId) {
      throw new Error("Browserbase session does not belong to the persisted context");
    }
    return session;
  }

  private async createSession(
    contextId: string,
    botId: string,
    context: AdapterContext,
  ): Promise<BrowserbaseSession> {
    const pending = this.sessionCreations.get(contextId);
    if (pending) return pending;
    const creation = this.client.createSession({
      contextId,
      timeoutSeconds: this.options.timeoutSeconds,
      region: this.options.region,
      metadata: browserbaseMetadata(botId, context),
    });
    this.sessionCreations.set(contextId, creation);
    try {
      return await creation;
    } finally {
      if (this.sessionCreations.get(contextId) === creation) {
        this.sessionCreations.delete(contextId);
      }
    }
  }
}

async function installNetworkPolicy(context: BrowserContext): Promise<void> {
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    try {
      if (!/^(about:|blob:|data:)/i.test(url)) assertAllowedBrowserUrl(url);
    } catch {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

async function observeBox(box: BrowserbaseBox, context: AdapterContext) {
  const page = requiredPage(box);
  throwIfAborted(context);
  const [image, viewport, title, aria] = await Promise.all([
    page.screenshot({ type: "png", scale: "css" }),
    Promise.resolve(page.viewportSize() ?? DEFAULT_VIEWPORT),
    page.title().catch(() => "Browserbase Chrome"),
    page
      .locator("body")
      .ariaSnapshot({ timeout: 4_000 })
      .catch(() => ""),
  ]);
  throwIfAborted(context);
  const url = page.url();
  return computerObservation(new Uint8Array(image), {
    mimeType: "image/png",
    width: viewport.width,
    height: viewport.height,
    activeWindow: { id: url, title },
    url,
    title,
    aria: aria.trim().slice(0, 12_000) || undefined,
  });
}

function isUnavailableBrowserRuntime(box: BrowserbaseBox, error: unknown): boolean {
  if (!box.browser?.isConnected() || box.page?.isClosed()) return true;
  const message = errorMessage(error);
  return /(?:target page|browser|browser context|page|websocket).*(?:closed|disconnected|not open)|session closed/i.test(
    message,
  );
}

async function applyBrowserAction(
  box: BrowserbaseBox,
  action: ComputerAction,
  context: AdapterContext,
): Promise<void> {
  throwIfAborted(context);
  const page = requiredPage(box);
  switch (action.kind) {
    case "pointer": {
      const button = action.button ?? "left";
      if (action.type === "move") await page.mouse.move(action.x, action.y);
      else if (action.type === "down") await page.mouse.down({ button });
      else if (action.type === "up") await page.mouse.up({ button });
      else await page.mouse.click(action.x, action.y, { button });
      break;
    }
    case "key": {
      const keys = [...(action.modifiers ?? []), playwrightKeyName(action.key)].join("+");
      await page.keyboard.press(keys);
      break;
    }
    case "text": {
      await assertEditableFocus(page);
      await page.keyboard.insertText(action.text);
      break;
    }
    case "clipboard": {
      // The agent's `type` action maps here. Remote Chromium never synthesizes a paste,
      // so inserting into the focused element is the authoritative effect; the clipboard
      // copy stays best-effort for pages that read it.
      try {
        const origin = safeOrigin(page.url());
        if (origin) {
          await box.browserContext?.grantPermissions(["clipboard-read", "clipboard-write"], {
            origin,
          });
        }
        await page.evaluate(
          (text) =>
            (
              globalThis as unknown as {
                navigator: {
                  clipboard: { writeText(value: string): Promise<void> };
                };
              }
            ).navigator.clipboard.writeText(text),
          action.text,
        );
      } catch {
        // Clipboard access can be denied (blank pages, permission errors); typing still works.
      }
      await assertEditableFocus(page);
      await page.keyboard.insertText(action.text);
      break;
    }
    case "scroll":
      await page.mouse.wheel(0, (action.direction === "down" ? 1 : -1) * (action.amount ?? 600));
      break;
    case "wait":
      await page.waitForTimeout(Math.min(Math.max(action.ms, 0), 30_000));
      break;
    case "open":
      await page.goto(assertAllowedBrowserUrl(action.path).toString(), {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      break;
    case "launch":
      if (!action.uri) throw new Error("Browserbase launch actions require a URI");
      await page.goto(assertAllowedBrowserUrl(action.uri).toString(), {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      break;
  }
  throwIfAborted(context);
}

/**
 * insertText silently does nothing without a focused editable element, which
 * reads as "typing is broken" to agents and users. Turn that into an explicit
 * error so the caller clicks the target field and retries.
 */
async function assertEditableFocus(page: Page): Promise<void> {
  let focused: unknown = true;
  try {
    focused = await page.evaluate(() => {
      const doc = (
        globalThis as unknown as {
          document?: { activeElement?: { tagName?: string } | null };
        }
      ).document;
      const element = doc?.activeElement;
      if (!element) return false;
      const tag = String(element.tagName ?? "").toUpperCase();
      return tag !== "BODY" && tag !== "HTML";
    });
  } catch {
    // A failed probe must not block typing.
    return;
  }
  if (focused === false) {
    throw new Error("No input is focused on the page. Click the target field, then type again.");
  }
}

function playwrightKeyName(key: string): string {
  const aliases: Record<string, string> = {
    Return: "Enter",
    BackSpace: "Backspace",
    Left: "ArrowLeft",
    Right: "ArrowRight",
    Up: "ArrowUp",
    Down: "ArrowDown",
  };
  return aliases[key] ?? key;
}

function encodeProviderRef(contextId: string, sessionId: string): string {
  assertProviderId(contextId, "context");
  assertProviderId(sessionId, "session");
  return `${PROVIDER_REF_PREFIX}${Buffer.from(JSON.stringify({ contextId, sessionId })).toString("base64url")}`;
}

function decodeProviderRef(providerRef: string): BrowserbaseProviderRef {
  if (providerRef.startsWith(PROVIDER_REF_PREFIX)) {
    try {
      const parsed = JSON.parse(
        Buffer.from(providerRef.slice(PROVIDER_REF_PREFIX.length), "base64url").toString("utf8"),
      ) as { contextId?: unknown; sessionId?: unknown };
      if (typeof parsed.contextId !== "string" || typeof parsed.sessionId !== "string") {
        throw new Error("missing IDs");
      }
      assertProviderId(parsed.contextId, "context");
      assertProviderId(parsed.sessionId, "session");
      return { contextId: parsed.contextId, sessionId: parsed.sessionId };
    } catch (error) {
      throw new Error("Invalid Browserbase provider reference", {
        cause: error,
      });
    }
  }
  const contextId = providerRef.startsWith(LEGACY_CONTEXT_REF_PREFIX)
    ? providerRef.slice(LEGACY_CONTEXT_REF_PREFIX.length)
    : providerRef;
  assertProviderId(contextId, "context");
  return { contextId };
}

function assertProviderId(value: string, kind: "context" | "session"): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid Browserbase ${kind} ID`);
}

function ensureBrowserbaseComputer(computer: ComputerRef): void {
  if (computer.kind !== "browserbase") throw new Error("Computer is not a Browserbase computer");
}

function browserbaseMetadata(botId: string, context: AdapterContext): Record<string, string> {
  return {
    botId: safeMetadata(botId),
    workspaceId: safeMetadata(context.spaceId),
    // Attribute the session to a person so usage can be billed per user.
    // The metadata key stays "workspaceId" for continuity with recorded sessions.
    ...(context.userId ? { userId: safeMetadata(context.userId) } : {}),
    operationId: safeMetadata(context.operationId),
    ...(context.runId ? { runId: safeMetadata(context.runId) } : {}),
  };
}

function safeMetadata(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 128);
}

function requiredPage(box: BrowserbaseBox): Page {
  if (!box.page || box.page.isClosed()) throw new Error("Browserbase page is not available");
  return box.page;
}

function throwIfAborted(context: AdapterContext): void {
  if (context.signal.aborted)
    throw context.signal.reason ?? new Error("Browserbase operation aborted");
}

function safeOrigin(rawUrl: string): string | undefined {
  try {
    const url = assertAllowedBrowserUrl(rawUrl);
    return url.origin;
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwCleanupError(results: PromiseSettledResult<unknown>[], operation: string): void {
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failures.length) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `Could not ${operation}`,
    );
  }
}
