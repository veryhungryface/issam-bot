import net from "node:net";
import { describe, expect, it } from "vitest";
import {
  fetchImpersonatedWebText,
  type ImpersonatedClientFactory,
  type ImpersonatedResponse,
  isBotWallFailure,
  looksLikeChallengePage,
  parseConnectRequest,
  readConnectHead,
  startGuardedConnectProxy,
} from "./impersonated-fetch.js";

const PUBLIC = [{ address: "93.184.216.34", family: 4 }];

function connectHead(host: string, token: string, port = 443): string {
  const credential = Buffer.from(`impersonate:${token}`).toString("base64");
  return `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\nProxy-Authorization: Basic ${credential}`;
}

function response(init: {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}): ImpersonatedResponse {
  const headers = new Map(Object.entries(init.headers ?? {}));
  return {
    status: init.status ?? 200,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    body: null,
    text: async () => init.body ?? "",
  };
}

describe("bot wall detection", () => {
  it("treats refusal statuses as walls and ordinary failures as failures", () => {
    expect(isBotWallFailure(new Error("Request failed: HTTP 403"))).toBe(true);
    expect(isBotWallFailure(new Error("Request failed: HTTP 429"))).toBe(true);
    expect(isBotWallFailure(new Error("Request failed: HTTP 404"))).toBe(false);
    expect(isBotWallFailure(new Error("Request failed: HTTP 500"))).toBe(false);
    expect(isBotWallFailure(new Error("URL resolves to a private address"))).toBe(false);
  });

  it("recognizes a challenge page served with a 200", () => {
    expect(looksLikeChallengePage('<div id="sec-if-cpt-container">')).toBe(true);
    expect(looksLikeChallengePage("<title>Access Denied</title>")).toBe(true);
    // An article that merely mentions the wall is far longer than an interstitial.
    expect(looksLikeChallengePage(`Access Denied pages explained. ${"x".repeat(20_001)}`)).toBe(
      false,
    );
    expect(looksLikeChallengePage("<h1>치약 최저가</h1>")).toBe(false);
  });
});

describe("guarded CONNECT proxy", () => {
  it("accepts an authorized CONNECT to a public host", () => {
    expect(parseConnectRequest(connectHead("example.com", "tok"), "tok")).toEqual({
      host: "example.com",
      port: 443,
    });
  });

  it("refuses without the token, to private hosts, and to odd ports", () => {
    expect(parseConnectRequest(connectHead("example.com", "wrong"), "tok")).toBeNull();
    expect(parseConnectRequest("CONNECT example.com:443 HTTP/1.1", "tok")).toBeNull();
    expect(parseConnectRequest(connectHead("localhost", "tok"), "tok")).toBeNull();
    expect(parseConnectRequest(connectHead("169.254.169.254", "tok"), "tok")).toBeNull();
    expect(parseConnectRequest(connectHead("metadata.google.internal", "tok"), "tok")).toBeNull();
    expect(parseConnectRequest(connectHead("example.com", "tok", 25), "tok")).toBeNull();
    expect(parseConnectRequest(`GET http://example.com/ HTTP/1.1`, "tok")).toBeNull();
  });

  it("refuses a hostname that resolves to a private address", async () => {
    const proxy = await startGuardedConnectProxy({
      resolveHostname: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    try {
      const { port, token } = parseProxyUrl(proxy.url);
      const reply = await speakToProxy(port, `${connectHead("rebind.test", token)}\r\n\r\n`);
      expect(reply).toContain("502");
    } finally {
      await proxy.close();
    }
  });

  it("splits the CONNECT head from bytes pipelined behind it", async () => {
    const server = net.createServer();
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as net.AddressInfo).port;
    const accepted = new Promise<net.Socket>((done) => server.once("connection", done));
    const client = net.connect({ host: "127.0.0.1", port });
    try {
      const serverSocket = await accepted;
      const head = readConnectHead(serverSocket);
      // Split mid-header: the head can arrive across any number of reads.
      client.write("CONNECT example.com:443 HTTP/1.1\r\nHost: exa");
      await new Promise((done) => setTimeout(done, 10));
      client.write("mple.com:443\r\n\r\nping");
      const { head: parsed, rest } = await head;
      expect(parsed).toBe("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443");
      expect(rest.toString("utf8")).toBe("ping");
    } finally {
      client.destroy();
      server.close();
    }
  });
});

describe("fetchImpersonatedWebText", () => {
  it("returns the page body through the proxy-backed client, with no added headers", async () => {
    const seen: string[] = [];
    let sawInit: unknown = "unset";
    const createClient: ImpersonatedClientFactory = async ({ profile }) => ({
      fetch: async (url, init) => {
        seen.push(`${profile} ${url}`);
        sawInit = init;
        return response({ body: "<h1>hello</h1>", headers: { "content-type": "text/html" } });
      },
    });
    const result = await fetchImpersonatedWebText("https://example.com/page", {
      resolveHostname: async () => PUBLIC,
      createClient,
    });
    expect(result.body).toBe("<h1>hello</h1>");
    expect(result.contentType).toBe("text/html");
    expect(seen).toEqual(["chrome https://example.com/page"]);
    // Any header we add is a fingerprint mismatch: a single Accept-Language turns
    // coupang.com's 200 back into a 403 from the same machine.
    expect(sawInit).toBeUndefined();
  });

  it("tries the next profile only when the first is walled", async () => {
    const seen: string[] = [];
    const createClient: ImpersonatedClientFactory = async ({ profile }) => ({
      fetch: async () => {
        seen.push(profile);
        return profile === "chrome" ? response({ status: 403 }) : response({ body: "ok" });
      },
    });
    const result = await fetchImpersonatedWebText("https://example.com/", {
      resolveHostname: async () => PUBLIC,
      createClient,
    });
    expect(result.body).toBe("ok");
    expect(seen).toEqual(["chrome", "firefox"]);
  });

  it("does not retry a profile after a non-wall failure", async () => {
    const seen: string[] = [];
    const createClient: ImpersonatedClientFactory = async ({ profile }) => ({
      fetch: async () => {
        seen.push(profile);
        return response({ status: 404 });
      },
    });
    await expect(
      fetchImpersonatedWebText("https://example.com/", {
        resolveHostname: async () => PUBLIC,
        createClient,
      }),
    ).rejects.toThrow("HTTP 404");
    expect(seen).toEqual(["chrome"]);
  });

  it("refuses a private target before any request is made", async () => {
    let called = false;
    const createClient: ImpersonatedClientFactory = async () => ({
      fetch: async () => {
        called = true;
        return response({ body: "secret" });
      },
    });
    await expect(
      fetchImpersonatedWebText("http://169.254.169.254/latest/meta-data/", {
        resolveHostname: async () => PUBLIC,
        createClient,
      }),
    ).rejects.toThrow(/private or internal host/);
    expect(called).toBe(false);
  });

  it("checks every redirect hop, not just the first", async () => {
    const createClient: ImpersonatedClientFactory = async () => ({
      fetch: async (url) =>
        url === "https://example.com/"
          ? response({ status: 302, headers: { location: "http://127.0.0.1/admin" } })
          : response({ body: "internal" }),
    });
    await expect(
      fetchImpersonatedWebText("https://example.com/", {
        resolveHostname: async () => PUBLIC,
        createClient,
      }),
    ).rejects.toThrow(/private or internal host/);
  });
});

function parseProxyUrl(url: string): { port: number; token: string } {
  const parsed = new URL(url);
  return { port: Number(parsed.port), token: decodeURIComponent(parsed.password) };
}

async function speakToProxy(port: number, request: string, chunks = 1): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => socket.write(request));
    let reply = "";
    let seen = 0;
    socket.on("data", (chunk) => {
      reply += chunk.toString("latin1");
      seen += 1;
      if (reply.includes("\r\n\r\n") && seen >= chunks) {
        socket.destroy();
        resolve(reply);
      }
    });
    socket.on("error", reject);
    socket.setTimeout(5_000, () => {
      socket.destroy();
      reject(new Error("proxy did not answer"));
    });
  });
}
