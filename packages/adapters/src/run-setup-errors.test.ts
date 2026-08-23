import { describe, expect, it } from "vitest";
import { BrowserbaseApiError } from "./browserbase-client.js";
import { classifyRunSetupError } from "./run-setup-errors.js";

describe("classifyRunSetupError", () => {
  it("fails Browserbase billing errors immediately", () => {
    const result = classifyRunSetupError(new BrowserbaseApiError("HTTP 402", 402), 0);

    expect(result.retry).toBe(false);
    expect(result.userMessage).toContain("이용 한도 또는 결제 상태");
  });

  it("retries rate limits with bounded exponential backoff", () => {
    const error = new BrowserbaseApiError("HTTP 429", 429);

    expect(classifyRunSetupError(error, 0)).toMatchObject({ retry: true, retryDelayMs: 15_000 });
    expect(classifyRunSetupError(error, 1)).toMatchObject({ retry: true, retryDelayMs: 30_000 });
    expect(classifyRunSetupError(error, 2)).toMatchObject({ retry: false });
  });

  it("bounds unknown setup failures too", () => {
    expect(classifyRunSetupError(new Error("network"), 1).retry).toBe(true);
    expect(classifyRunSetupError(new Error("network"), 2).retry).toBe(false);
  });
});
