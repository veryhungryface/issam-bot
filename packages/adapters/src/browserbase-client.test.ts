import { describe, expect, it, vi } from "vitest";
import { assertAllowedBrowserUrl, BrowserbaseClient } from "./browserbase-client.js";

describe("BrowserbaseClient", () => {
  it("keeps the provider key server-side and applies the product timeout ceiling", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "session-1", connectUrl: "wss://example" }), { status: 201 }));
    const client = new BrowserbaseClient({ apiKey: "server-secret", projectId: "project-1", fetch: fetcher });
    await client.createSession({ contextId: "context-1", metadata: { taskId: "task-1" } });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.browserbase.com/v1/sessions",
      expect.objectContaining({ headers: expect.objectContaining({ "x-bb-api-key": "server-secret" }) }),
    );
    await expect(client.createSession({ contextId: "context-1", timeoutSeconds: 601, metadata: {} })).rejects.toThrow(/600/);
  });
});

describe("assertAllowedBrowserUrl", () => {
  it.each(["http://localhost", "http://127.0.0.1", "http://10.0.0.1", "http://172.16.0.1", "http://192.168.0.1", "http://169.254.169.254"]) (
    "blocks %s",
    (url) => expect(() => assertAllowedBrowserUrl(url)).toThrow(),
  );

  it("allows a public HTTPS URL", () => {
    expect(assertAllowedBrowserUrl("https://example.com/path").hostname).toBe("example.com");
  });
});
