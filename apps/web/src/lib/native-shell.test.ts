import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  inNativeShell,
  nativePushToken,
  notifyNativeShellPainted,
  registerNativePushToken,
  resetNativeShellPaintedForTest,
} from "./native-shell";

const KEY = "__ISSAM_NATIVE__";

// The suite runs in node; this module only ever reads one property off window.
beforeEach(() => {
  vi.stubGlobal("window", {});
  resetNativeShellPaintedForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setShell(value: unknown) {
  (globalThis.window as unknown as Record<string, unknown>)[KEY] = value;
}

describe("native shell bridge", () => {
  it("is absent in a plain browser", () => {
    expect(inNativeShell()).toBe(false);
    expect(nativePushToken()).toBeNull();
  });

  it("reports the token the shell injected", () => {
    setShell({ pushToken: "ExponentPushToken[abc123def456]", platform: "android" });
    expect(inNativeShell()).toBe(true);
    expect(nativePushToken()).toBe("ExponentPushToken[abc123def456]");
  });

  it("knows it is in the shell even before a token exists", () => {
    // Permission may still be pending, or the user may have refused it.
    setShell({ platform: "ios" });
    expect(inNativeShell()).toBe(true);
    expect(nativePushToken()).toBeNull();
  });

  it("refuses a token the API would reject anyway", () => {
    for (const token of ["", "   ", "short", 42, null, "x".repeat(513)]) {
      setShell({ pushToken: token });
      expect(nativePushToken()).toBeNull();
    }
  });
});

describe("registerNativePushToken", () => {
  it("sends the token the shell injected", async () => {
    setShell({ pushToken: "ExponentPushToken[abc123def456]" });
    const calls: Array<{ token: string }> = [];
    const result = await registerNativePushToken(async (input) => {
      calls.push(input);
    });
    expect(result).toBe("registered");
    expect(calls).toEqual([{ token: "ExponentPushToken[abc123def456]" }]);
  });

  it("does nothing in a browser", async () => {
    let called = false;
    const result = await registerNativePushToken(async () => {
      called = true;
    });
    expect(result).toBe("no-token");
    expect(called).toBe(false);
  });

  it("swallows a failure: a phone without push is still a working app", async () => {
    setShell({ pushToken: "ExponentPushToken[abc123def456]" });
    const result = await registerNativePushToken(async () => {
      throw new Error("offline");
    });
    expect(result).toBe("failed");
  });
});

describe("telling the shell the app has something to show", () => {
  function listen() {
    const posted: string[] = [];
    (globalThis.window as unknown as Record<string, unknown>).ReactNativeWebView = {
      postMessage: (data: string) => posted.push(data),
    };
    return posted;
  }

  it("says it once, however often it is asked", () => {
    const posted = listen();
    notifyNativeShellPainted();
    notifyNativeShellPainted();
    expect(posted).toEqual([JSON.stringify({ type: "painted" })]);
  });

  it("does nothing in a plain browser", () => {
    expect(() => notifyNativeShellPainted()).not.toThrow();
  });

  it("leaves a shell that throws to its own timeout", () => {
    (globalThis.window as unknown as Record<string, unknown>).ReactNativeWebView = {
      postMessage: () => {
        throw new Error("bridge gone");
      },
    };
    expect(() => notifyNativeShellPainted()).not.toThrow();
  });
});
