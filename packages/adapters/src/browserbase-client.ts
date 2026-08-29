export interface BrowserbaseClientOptions {
  apiKey: string;
  projectId: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}

export type BrowserbaseRegion = "us-west-2" | "us-east-1" | "eu-central-1" | "ap-southeast-1";

export interface BrowserbaseSession {
  id: string;
  connectUrl: string;
  contextId?: string;
  status?: "PENDING" | "RUNNING" | "ERROR" | "TIMED_OUT" | "COMPLETED";
}

/** Session listing entry with the fields billing attribution needs. */
export interface BrowserbaseSessionSummary {
  id: string;
  status?: string;
  region?: string;
  createdAt?: string;
  startedAt?: string;
  endedAt?: string;
  userMetadata?: Record<string, unknown>;
}

export interface BrowserbaseLiveView {
  debuggerUrl?: string;
  debuggerFullscreenUrl?: string;
  pages: Array<{
    id: string;
    title?: string;
    url?: string;
    debuggerUrl?: string;
    debuggerFullscreenUrl?: string;
  }>;
}

export class BrowserbaseApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "BrowserbaseApiError";
  }
}

/**
 * Server-only Browserbase API boundary. Do not import this module into web bundles:
 * its API key may only exist in the API/worker secret environment.
 */
export class BrowserbaseClient {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: BrowserbaseClientOptions) {
    if (!options.apiKey || !options.projectId)
      throw new Error("Browserbase API key and project ID are required.");
    this.fetcher = options.fetch ?? fetch;
    this.baseUrl = (options.baseUrl ?? "https://api.browserbase.com/v1").replace(/\/$/, "");
  }

  async createContext(): Promise<{ id: string }> {
    return this.request("/contexts", {
      method: "POST",
      body: { projectId: this.options.projectId },
    });
  }

  async createSession(input: {
    contextId: string;
    timeoutSeconds?: number;
    region?: BrowserbaseRegion;
    metadata: Record<string, string>;
  }): Promise<BrowserbaseSession> {
    const timeout = input.timeoutSeconds ?? 600;
    if (!Number.isInteger(timeout) || timeout < 60 || timeout > 600) {
      throw new Error("Browserbase task timeout must be an integer between 60 and 600 seconds.");
    }
    return this.request("/sessions", {
      method: "POST",
      body: {
        projectId: this.options.projectId,
        timeout,
        region: input.region,
        userMetadata: input.metadata,
        browserSettings: { context: { id: input.contextId, persist: true } },
      },
    });
  }

  async getSession(sessionId: string): Promise<BrowserbaseSession | undefined> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}`, { allowNotFound: true });
  }

  async listSessions(status?: string): Promise<BrowserbaseSessionSummary[]> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    const sessions = await this.request<BrowserbaseSessionSummary[]>(`/sessions${query}`);
    return Array.isArray(sessions) ? sessions : [];
  }

  async liveView(sessionId: string): Promise<BrowserbaseLiveView> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/debug`);
  }

  async endSession(sessionId: string): Promise<void> {
    await this.request(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      body: { projectId: this.options.projectId, status: "REQUEST_RELEASE" },
      allowNotFound: true,
    });
  }

  async deleteContext(contextId: string): Promise<void> {
    await this.request(`/contexts/${encodeURIComponent(contextId)}`, {
      method: "DELETE",
      allowNotFound: true,
    });
  }

  private async request<T>(
    path: string,
    input: { method?: string; body?: unknown; allowNotFound?: boolean } = {},
  ): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: input.method,
      headers: { "content-type": "application/json", "x-bb-api-key": this.options.apiKey },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    if (input.allowNotFound && response.status === 404) return undefined as T;
    if (!response.ok) {
      const requestId =
        response.headers.get("x-request-id") ??
        response.headers.get("x-browserbase-request-id") ??
        undefined;
      throw new BrowserbaseApiError(
        `Browserbase ${input.method ?? "GET"} ${path} failed: HTTP ${response.status}${requestId ? ` (request ${requestId})` : ""}`,
        response.status,
        requestId,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

/** Reject browser navigation to host-local, private, or cloud metadata targets. */
export function assertAllowedBrowserUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Only HTTP(S) browser navigation is allowed.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "::" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  ) {
    throw new Error("Local and internal addresses are blocked.");
  }
  if (
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    /^fe[89ab]/.test(host) ||
    host.startsWith("ff")
  ) {
    throw new Error("Private, link-local, and multicast IPv6 ranges are blocked.");
  }
  const octets = host.split(".").map(Number);
  if (
    octets.length === 4 &&
    octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    const a = octets[0]!;
    const b = octets[1]!;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a >= 224
    ) {
      throw new Error("Private and metadata IP ranges are blocked.");
    }
  }
  return url;
}
