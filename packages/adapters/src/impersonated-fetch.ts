import { randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { isPrivateAddress, type ResolvedAddress, type ResolveHostname } from "./network-address.js";
import { assertSafeWebUrl, isBlockedHostname, readBodyCapped, withAbort } from "./web-ssrf.js";

/**
 * A second way to read a public page when the ordinary fetch is turned away.
 *
 * Bot walls (Akamai, Cloudflare, Naver) classify a client by its TLS and HTTP/2
 * fingerprint, not by its User-Agent — Node's fingerprint is refused where a real
 * Chrome is served, and sending browser-shaped headers over Node's TLS changes
 * nothing. Measured from the Seoul VPS: coupang.com returns 403 to Node with perfect
 * Chrome headers and 200 to a Chrome fingerprint; the same page returns 403 to our
 * Browserbase Chrome, so this path reaches sites the computer cannot.
 *
 * It is a reader for public pages. It does not sign in, does not solve behavioural
 * challenges (a site that answers with an Akamai sensor page stays unreadable here),
 * and never sends credentials.
 */

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const CONNECT_HEAD_MAX_BYTES = 8 * 1024;
const DEFAULT_ALLOWED_PORTS: ReadonlySet<number> = new Set([80, 443]);

/** Impersonation profiles, in the order they are tried. */
export type ImpersonationProfile = "chrome" | "firefox";
const DEFAULT_PROFILES: ImpersonationProfile[] = ["chrome", "firefox"];

export type ImpersonatedFetchOptions = {
  resolveHostname?: ResolveHostname;
  timeoutMs?: number;
  maxBytes?: number;
  acceptLanguage?: string;
  profiles?: ImpersonationProfile[];
  signal?: AbortSignal;
  /** Test seam: the impit-shaped client factory. Defaults to a lazy `impit` import. */
  createClient?: ImpersonatedClientFactory;
};

export type ImpersonatedResponse = {
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
};

export type ImpersonatedClient = {
  fetch(url: string, init?: { headers?: Record<string, string> }): Promise<ImpersonatedResponse>;
};

export type ImpersonatedClientFactory = (options: {
  profile: ImpersonationProfile;
  proxyUrl: string;
  timeoutMs: number;
}) => Promise<ImpersonatedClient>;

/** Statuses a bot wall answers with. A 404 or a 500 is the site, not the wall. */
const BOT_WALL_STATUSES = new Set([401, 403, 405, 406, 418, 429, 451, 503]);

export function isBotWallFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const match = /^Request failed: HTTP (\d{3})$/.exec(message);
  return match ? BOT_WALL_STATUSES.has(Number(match[1])) : false;
}

/**
 * A page that returned 200 but carries a bot wall's challenge instead of content.
 * Kept narrow on purpose: these markers belong to the wall's own interstitial, and
 * an article merely discussing them is far longer than the cutoff.
 */
export function looksLikeChallengePage(body: string): boolean {
  if (body.length > 20_000) return false;
  return /sec-if-cpt-container|errors\.edgesuite\.net|Access Denied|__cf_chl_|Checking your browser|Just a moment\.\.\./i.test(
    body,
  );
}

/**
 * Fetch a public page with a real browser's TLS fingerprint.
 *
 * Mirrors `fetchSafeWebText`: same return shape, same public-address rule. The
 * impersonating client cannot take our address-checked lookup, so every request goes
 * through a loopback CONNECT proxy that resolves the host itself and dials only the
 * address it verified — the check and the connection use one resolution, so a
 * rebinding DNS answer cannot slip a private address in between.
 */
export async function fetchImpersonatedWebText(
  url: string,
  options: ImpersonatedFetchOptions = {},
): Promise<{ url: string; body: string; contentType: string | null }> {
  const resolve = options.resolveHostname ?? defaultResolveHostname;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const profiles = options.profiles ?? DEFAULT_PROFILES;
  const createClient = options.createClient ?? importImpitClient;
  const signal = combineSignals(options.signal, AbortSignal.timeout(timeoutMs));

  const proxy = await startGuardedConnectProxy({ resolveHostname: resolve });
  try {
    let lastError: unknown;
    for (const profile of profiles) {
      const client = await createClient({ profile, proxyUrl: proxy.url, timeoutMs });
      try {
        return await follow(url, {
          client,
          resolve,
          maxBytes,
          acceptLanguage: options.acceptLanguage,
          signal,
          redirectsRemaining: MAX_REDIRECTS,
        });
      } catch (error) {
        // Only a wall is worth a second profile: sites differ in which fingerprint
        // they accept. A private-address rejection or a timeout must not be retried.
        if (!isBotWallFailure(error) || signal.aborted) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new Error(`Failed to fetch content from ${url}`);
  } finally {
    await proxy.close();
  }
}

async function follow(
  rawUrl: string,
  state: {
    client: ImpersonatedClient;
    resolve: ResolveHostname;
    maxBytes: number;
    acceptLanguage?: string;
    signal: AbortSignal;
    redirectsRemaining: number;
  },
): Promise<{ url: string; body: string; contentType: string | null }> {
  const validated = await assertSafeWebUrl(rawUrl, state.resolve, state.signal);
  const headers: Record<string, string> = {};
  if (state.acceptLanguage) headers["accept-language"] = state.acceptLanguage;
  const response = await withAbort(state.client.fetch(validated.href, { headers }), state.signal);

  if (response.status >= 300 && response.status < 400) {
    if (state.redirectsRemaining <= 0) throw new Error("Too many redirects");
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect missing Location header");
    return follow(new URL(location, validated.href).href, {
      ...state,
      redirectsRemaining: state.redirectsRemaining - 1,
    });
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed: HTTP ${response.status}`);
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > state.maxBytes) {
    throw new Error("Response is too large");
  }
  const body = response.body
    ? new TextDecoder().decode(
        await readBodyCapped(response as unknown as Response, state.maxBytes, state.signal),
      )
    : await withAbort(response.text(), state.signal);

  return { url: validated.href, body, contentType: response.headers.get("content-type") };
}

/**
 * A loopback HTTP CONNECT proxy that only tunnels to public addresses.
 *
 * The impersonating client offers no DNS hook, so this restores the pinning the
 * ordinary fetch gets from `createAddressCheckedLookup`. Bound to 127.0.0.1 on an
 * ephemeral port and gated by a per-call random token, so nothing else on the host
 * can borrow it as an open proxy.
 */
export async function startGuardedConnectProxy(options: {
  resolveHostname?: ResolveHostname;
  /** Ports the tunnel may reach. Standard web ports only, so nothing else is reachable. */
  allowedPorts?: number[];
}): Promise<{ url: string; close(): Promise<void> }> {
  const resolve = options.resolveHostname ?? defaultResolveHostname;
  const allowedPorts = new Set(options.allowedPorts ?? DEFAULT_ALLOWED_PORTS);
  const token = randomBytes(24).toString("base64url");
  const sockets = new Set<net.Socket>();
  const server = net.createServer();

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    readConnectHead(socket)
      .then(async ({ head, rest }) => {
        const target = parseConnectRequest(head, token, allowedPorts);
        if (!target) {
          socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
          return;
        }
        const address = await resolvePublicAddress(target.host, resolve);
        const upstream = net.connect({ host: address, port: target.port }, () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          // A client may pipeline its first TLS bytes behind the CONNECT line.
          if (rest.length > 0) upstream.write(rest);
          upstream.pipe(socket);
          socket.pipe(upstream);
        });
        sockets.add(upstream);
        upstream.on("close", () => sockets.delete(upstream));
        upstream.on("error", () => {
          upstream.destroy();
          socket.destroy();
        });
      })
      .catch(() => {
        if (!socket.destroyed) socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      });
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolveListen();
    });
  });
  const address = server.address();
  if (typeof address === "string" || !address) {
    server.close();
    throw new Error("Could not start the fetch proxy");
  }

  return {
    url: `http://impersonate:${token}@127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((done) => {
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        server.close(() => done());
      }),
  };
}

/** `CONNECT host:port` plus the proxy credential. Returns null for anything else. */
export function parseConnectRequest(
  head: string,
  token: string,
  allowedPorts: ReadonlySet<number> = DEFAULT_ALLOWED_PORTS,
): { host: string; port: number } | null {
  const [requestLine, ...headerLines] = head.split("\r\n");
  const match = /^CONNECT (\[[^\]]+\]|[^\s:]+):(\d{1,5}) HTTP\/1\.[01]$/.exec(requestLine ?? "");
  if (!match) return null;
  const authorization = headerLines.find((line) => /^proxy-authorization:/i.test(line));
  if (!authorizesProxy(authorization, token)) return null;
  const port = Number(match[2]);
  if (!allowedPorts.has(port)) return null;
  const host = (match[1] ?? "").replace(/^\[|\]$/g, "");
  if (!host || isBlockedHostname(host)) return null;
  return { host, port };
}

function authorizesProxy(header: string | undefined, token: string): boolean {
  if (!header) return false;
  const encoded = header.split(/\s+/)[2];
  if (!encoded) return false;
  const presented = Buffer.from(encoded, "base64").toString("utf8").split(":").slice(1).join(":");
  const expected = Buffer.from(token);
  const actual = Buffer.from(presented);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function resolvePublicAddress(host: string, resolve: ResolveHostname): Promise<string> {
  if (net.isIP(host) !== 0) {
    if (isPrivateAddress(host)) throw new Error("URL resolves to a private address");
    return host;
  }
  const addresses = await resolve(host);
  const usable = addresses.filter((entry) => !isPrivateAddress(entry.address));
  if (usable.length === 0 || usable.length !== addresses.length) {
    throw new Error("URL resolves to a private address");
  }
  return usable[0]?.address ?? "";
}

/** Splits the CONNECT head from any bytes the client pipelined behind it. */
export function readConnectHead(socket: net.Socket): Promise<{ head: string; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const onData = (chunk: Buffer) => {
      // latin1 maps bytes 1:1, so the tail survives the round trip back to a Buffer.
      buffered += chunk.toString("latin1");
      const end = buffered.indexOf("\r\n\r\n");
      if (end >= 0) {
        socket.removeListener("data", onData);
        socket.pause();
        resolve({
          head: buffered.slice(0, end),
          rest: Buffer.from(buffered.slice(end + 4), "latin1"),
        });
        return;
      }
      if (buffered.length > CONNECT_HEAD_MAX_BYTES) {
        socket.removeListener("data", onData);
        reject(new Error("Proxy request header is too large"));
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
    socket.once("close", () => reject(new Error("Proxy connection closed")));
  });
}

const defaultResolveHostname: ResolveHostname = (hostname: string) =>
  lookup(hostname, { all: true, verbatim: true }) as Promise<ResolvedAddress[]>;

/**
 * `impit` ships a native binary per platform. Import it lazily so a build without it
 * degrades to the ordinary fetch instead of failing to start.
 */
const importImpitClient: ImpersonatedClientFactory = async ({ profile, proxyUrl, timeoutMs }) => {
  const { Impit } = (await import("impit")) as unknown as {
    Impit: new (options: Record<string, unknown>) => ImpersonatedClient;
  };
  return new Impit({
    browser: profile,
    proxyUrl,
    timeout: timeoutMs,
    followRedirects: false,
    http3: false,
  });
};

function combineSignals(signal: AbortSignal | undefined, deadline: AbortSignal): AbortSignal {
  if (!signal) return deadline;
  return AbortSignal.any([signal, deadline]);
}
