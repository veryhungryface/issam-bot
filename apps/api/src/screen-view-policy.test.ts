import { describe, expect, it } from "vitest";
import { applyScreenViewPolicy } from "./screen-view-policy.js";

describe("applyScreenViewPolicy", () => {
  it("preserves Browserbase's signed Live View URL for interactive iframe control", () => {
    const url = "https://www.browserbase.com/devtools-fullscreen/token?sessionId=session-1";

    expect(applyScreenViewPolicy(url, "browserbase", false)).toBe(url);
    expect(applyScreenViewPolicy(url, "browserbase", true)).toBe(url);
  });

  it("keeps enforcing the noVNC view-only policy for local browser providers", () => {
    expect(applyScreenViewPolicy("http://127.0.0.1:49152/embed.html", "docker", false)).toBe(
      "http://127.0.0.1:49152/embed.html?view_only=false",
    );
    expect(applyScreenViewPolicy("/novnc/embed.html?token=test", "box", true)).toBe(
      "/novnc/embed.html?token=test&view_only=true",
    );
  });
});
