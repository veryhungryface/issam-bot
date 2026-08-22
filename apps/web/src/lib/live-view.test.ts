import { describe, expect, it } from "vitest";
import { isBrowserbaseDisconnectedMessage, screenIframeSandbox } from "./live-view";

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
});
