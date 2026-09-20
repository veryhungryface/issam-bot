import { Readability } from "@mozilla/readability";
import type {
  AdapterContext,
  WebFetchRequest,
  WebFetchResult,
  WebProvider,
  WebSearchHit,
  WebSearchRequest,
} from "@rakazo/adapter-kit";
import { JSDOM } from "jsdom";
import {
  type ImpersonatedFetchOptions,
  isBotWallFailure,
  looksLikeChallengePage,
} from "./impersonated-fetch.js";
import { clampMaxChars, clampMaxResults } from "./web-limits.js";
import { fetchSafeWebText, type ResolveHostname } from "./web-ssrf.js";

export {
  clampMaxChars,
  clampMaxResults,
  DEFAULT_WEB_FETCH_MAX_CHARS,
  DEFAULT_WEB_SEARCH_MAX_RESULTS,
  MAX_WEB_FETCH_MAX_CHARS,
  MAX_WEB_SEARCH_RESULTS,
  MIN_WEB_FETCH_MAX_CHARS,
} from "./web-limits.js";

const DEFAULT_SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/";

export type KeylessHtmlSearchBackend = {
  id: string;
  endpoint: string;
  parse(html: string, maxResults: number): WebSearchHit[];
};

export type KeylessHttpWebOptions = {
  fetch?: typeof globalThis.fetch;
  resolveHostname?: ResolveHostname;
  searchBackend?: KeylessHtmlSearchBackend;
  searchTimeoutMs?: number;
  fetchTimeoutMs?: number;
  maxBufferBytes?: number;
  userAgent?: string;
  /**
   * Second attempt with a real browser's TLS fingerprint when the ordinary fetch is
   * turned away by a bot wall. Off unless supplied, so tests stay offline; the
   * deployment factory wires in the real one.
   */
  impersonatedFetch?: ImpersonatedFetch;
  /** Accept-Language for the impersonated attempt. Defaults to the deployment locale. */
  acceptLanguage?: string;
};

export type ImpersonatedFetch = (
  url: string,
  options: ImpersonatedFetchOptions,
) => Promise<{ url: string; body: string; contentType: string | null }>;

/** HTML search backend using DuckDuckGo’s public HTML form. One keyless option, not the interface. */
export const duckDuckGoHtmlSearchBackend: KeylessHtmlSearchBackend = {
  id: "duckduckgo-html",
  endpoint: DEFAULT_SEARCH_ENDPOINT,
  parse: parseDuckDuckGoResults,
};

/**
 * Keyless HTTP web search + page fetch. No API key, no sandbox, no JS execution.
 * Search uses a pluggable HTML backend (default: DuckDuckGo HTML). Fetch uses
 * Mozilla Readability with a lightweight HTML-strip fallback.
 */
export class KeylessHttpWebProvider implements WebProvider {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly resolveHostname?: ResolveHostname;
  private readonly searchBackend: KeylessHtmlSearchBackend;
  private readonly searchTimeoutMs: number;
  private readonly fetchTimeoutMs: number;
  private readonly maxBufferBytes: number;
  private readonly userAgent: string;
  private readonly impersonatedFetch: ImpersonatedFetch | null;
  private readonly acceptLanguage: string;

  constructor(options: KeylessHttpWebOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.resolveHostname = options.resolveHostname;
    this.searchBackend = options.searchBackend ?? duckDuckGoHtmlSearchBackend;
    this.searchTimeoutMs = options.searchTimeoutMs ?? 15_000;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 15_000;
    this.maxBufferBytes = options.maxBufferBytes ?? 5 * 1024 * 1024;
    this.userAgent =
      options.userAgent ?? "Rakazo/0.1 (+https://github.com/elie222/rakazo; web tools)";
    this.impersonatedFetch = options.impersonatedFetch ?? null;
    // This deployment serves Korean users; sites that vary by language should answer
    // in the language the user will be shown.
    this.acceptLanguage = options.acceptLanguage ?? "ko-KR,ko;q=0.9,en;q=0.8";
  }

  describe() {
    return {
      id: "keyless-http",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        search: true,
        fetch: true,
        keyless: true,
        native: false,
        readability: true,
      },
    };
  }

  async search(request: WebSearchRequest, context: AdapterContext): Promise<WebSearchHit[]> {
    const query = request.query.trim();
    if (!query) throw new Error("query is required");
    const maxResults = clampMaxResults(request.maxResults);
    const searchUrl = new URL(this.searchBackend.endpoint);
    searchUrl.searchParams.set("q", query);
    const { body } = await fetchSafeWebText(searchUrl.href, {
      fetch: this.fetchImpl,
      resolveHostname: this.resolveHostname,
      timeoutMs: this.searchTimeoutMs,
      maxBytes: 1024 * 1024,
      userAgent: this.userAgent,
      signal: request.signal ?? context.signal,
    });
    return this.searchBackend.parse(body, maxResults);
  }

  async fetch(request: WebFetchRequest, context: AdapterContext): Promise<WebFetchResult> {
    const maxChars = clampMaxChars(request.maxChars);
    const signal = request.signal ?? context.signal;
    const { url, body } = await this.fetchPage(request.url, signal);
    if (!body.trim()) throw new Error(`Failed to fetch content from ${url}`);
    const extracted = extractReadableText(body, url);
    const truncated = extracted.text.length > maxChars;
    return {
      url,
      title: extracted.title,
      text: truncated
        ? `${extracted.text.slice(0, maxChars)}\n\n[Content truncated]`
        : extracted.text,
      truncated,
    };
  }

  /**
   * Plain fetch first, and only where it is refused, a second attempt with a real
   * browser's TLS fingerprint. Bot walls answer the ordinary client with 403 (or with
   * a 200 carrying a challenge page), and the escalation reaches several sites our
   * Browserbase Chrome cannot — at a fraction of a browser session's cost. If it also
   * fails, the caller sees the original refusal, which is the honest one.
   */
  private async fetchPage(
    requestUrl: string,
    signal?: AbortSignal,
  ): Promise<{ url: string; body: string }> {
    try {
      const plain = await fetchSafeWebText(requestUrl, {
        fetch: this.fetchImpl,
        resolveHostname: this.resolveHostname,
        timeoutMs: this.fetchTimeoutMs,
        maxBytes: this.maxBufferBytes,
        userAgent: this.userAgent,
        signal,
      });
      if (!looksLikeChallengePage(plain.body)) return plain;
      const escalated = await this.fetchImpersonated(requestUrl, signal);
      return escalated ?? plain;
    } catch (error) {
      if (!isBotWallFailure(error)) throw error;
      const escalated = await this.fetchImpersonated(requestUrl, signal);
      if (!escalated) throw error;
      return escalated;
    }
  }

  private async fetchImpersonated(
    requestUrl: string,
    signal?: AbortSignal,
  ): Promise<{ url: string; body: string } | null> {
    if (!this.impersonatedFetch) return null;
    try {
      const result = await this.impersonatedFetch(requestUrl, {
        resolveHostname: this.resolveHostname,
        timeoutMs: this.fetchTimeoutMs,
        maxBytes: this.maxBufferBytes,
        acceptLanguage: this.acceptLanguage,
        signal,
      });
      return looksLikeChallengePage(result.body) ? null : result;
    } catch (error) {
      // A cancelled run is not a failed escalation: let the caller see the abort.
      if (signal?.aborted) throw error;
      return null;
    }
  }
}

export function parseDuckDuckGoResults(html: string, maxResults: number): WebSearchHit[] {
  const dom = new JSDOM(html, { url: DEFAULT_SEARCH_ENDPOINT });
  const document = dom.window.document;
  const results: WebSearchHit[] = [];

  for (const node of Array.from(document.querySelectorAll(".result"))) {
    const link = node.querySelector("a.result__a");
    if (!link) continue;
    const title = normalizeWhitespace(link.textContent ?? "");
    let url: string;
    try {
      url = unwrapDuckDuckGoUrl(link.getAttribute("href") ?? "");
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      url = parsed.href;
    } catch {
      continue;
    }
    const snippet = normalizeWhitespace(node.querySelector(".result__snippet")?.textContent ?? "");
    if (title && url) results.push({ title, url, snippet });
    if (results.length >= maxResults) break;
  }
  return results;
}

function unwrapDuckDuckGoUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, DEFAULT_SEARCH_ENDPOINT);
    const target = parsed.searchParams.get("uddg");
    if (target) return target;
    return parsed.href;
  } catch {
    return rawUrl;
  }
}

export function extractReadableText(html: string, url: string): { title: string; text: string } {
  const readable = extractWithReadability(html, url);
  if (readable) return readable;
  return stripHtmlFallback(html);
}

function extractWithReadability(html: string, url: string): { title: string; text: string } | null {
  try {
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (article?.textContent && article.textContent.length > 0) {
      return {
        title: article.title?.trim() || "Untitled",
        text: normalizeArticleText(article.textContent),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function stripHtmlFallback(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = normalizeWhitespace(titleMatch?.[1] ?? "") || "Untitled";
  const text = normalizeArticleText(
    html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " "),
  );
  return { title, text };
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeArticleText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
