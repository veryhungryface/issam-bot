import { describe, expect, it, vi } from "vitest";
import {
  isBrowserbaseDisconnectedMessage,
  pollBrowserbaseLiveViewRecovery,
  screenIframeSandbox,
} from "./live-view";

describe("Browserbase Live View embedding", () => {
  it("uses Browserbase's documented iframe sandbox without top-navigation privileges", () => {
    expect(
      screenIframeSandbox(
        "https://www.browserbase.com/devtools-fullscreen/session-token",
        "browserbase",
        "https://app.example",
      ),
    ).toBe("allow-same-origin allow-scripts");
  });

  it("keeps the stricter local noVNC policy", () => {
    expect(
      screenIframeSandbox(
        "/novnc/host/49152/control/token/embed.html",
        "docker",
        "https://app.example",
      ),
    ).toBe("allow-scripts allow-pointer-lock");
  });

  it("only accepts Browserbase disconnect messages from the active frame", () => {
    expect(isBrowserbaseDisconnectedMessage("browserbase-disconnected", true)).toBe(true);
    expect(isBrowserbaseDisconnectedMessage("browserbase-disconnected", false)).toBe(false);
    expect(isBrowserbaseDisconnectedMessage("unrelated", true)).toBe(false);
  });

  it("polls with bounded backoff until a replacement Live View is available", async () => {
    const refresh = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("https://live.example/replacement");
    const wait = vi.fn(async () => undefined);

    await expect(
      pollBrowserbaseLiveViewRecovery(refresh, {
        signal: new AbortController().signal,
        attempts: 15,
        intervalMs: 2_000,
        wait,
      }),
    ).resolves.toBe("https://live.example/replacement");
    expect(wait).toHaveBeenCalledTimes(3);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("stops recovery after its attempt limit without creating a session", async () => {
    const refresh = vi.fn(async () => null);

    await expect(
      pollBrowserbaseLiveViewRecovery(refresh, {
        signal: new AbortController().signal,
        attempts: 2,
        wait: async () => undefined,
      }),
    ).resolves.toBeNull();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
