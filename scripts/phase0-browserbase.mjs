import { createRequire } from "node:module";

const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = requireFromWeb("@playwright/test");

const apiKey = process.env.BROWSERBASE_API_KEY;
const projectId = process.env.BROWSERBASE_PROJECT_ID;

if (!apiKey || !projectId) {
  throw new Error("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are required.");
}

async function request(path, init = {}) {
  const response = await fetch(`https://api.browserbase.com/v1${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-bb-api-key": apiKey,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} failed: HTTP ${response.status}`);
  return body;
}

let context;
let session;
let browser;
const result = { contextCreated: false, sessionCreated: false, cdpConnected: false, liveViewAvailable: false };

try {
  context = await request("/contexts", {
    method: "POST",
    body: JSON.stringify({ projectId }),
  });
  result.contextCreated = Boolean(context.id);

  session = await request("/sessions", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      browserSettings: { context: { id: context.id, persist: true }, viewport: { width: 1280, height: 720 } },
      timeout: 120,
    }),
  });
  result.sessionCreated = Boolean(session.id && session.connectUrl);

  browser = await chromium.connectOverCDP(session.connectUrl);
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error("Browserbase session did not expose an initial page.");
  await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
  result.title = await page.title();
  result.cdpConnected = true;

  const debug = await request(`/sessions/${session.id}/debug`);
  result.liveViewAvailable = Boolean(debug.debuggerUrl || debug.debuggerFullscreenUrl);
} finally {
  await browser?.close().catch(() => undefined);
  if (session?.id) result.sessionDeleted = await request(`/sessions/${session.id}`, { method: "DELETE" }).then(() => true).catch(() => false);
  if (context?.id) result.contextDeleted = await request(`/contexts/${context.id}`, { method: "DELETE" }).then(() => true).catch(() => false);
}

console.log(JSON.stringify(result));
