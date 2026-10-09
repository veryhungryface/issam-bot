import { describe, expect, it } from "vitest";
import { SPLASH_MAX_MS, SPLASH_MIN_MS, splashHoldMs } from "./launch-splash";

describe("splashHoldMs", () => {
  it("gives a page that is already ready the rest of the minimum", () => {
    expect(splashHoldMs({ shownForMs: 0, pageReady: true })).toBe(SPLASH_MIN_MS);
    expect(splashHoldMs({ shownForMs: 200, pageReady: true })).toBe(SPLASH_MIN_MS - 200);
  });

  it("never asks for a wait that has already passed", () => {
    // A slow start that reports ready late leaves nothing to wait for.
    expect(splashHoldMs({ shownForMs: 4_000, pageReady: true })).toBe(0);
    expect(splashHoldMs({ shownForMs: 99_000, pageReady: false })).toBe(0);
  });

  it("holds a silent page only until the ceiling", () => {
    expect(splashHoldMs({ shownForMs: 0, pageReady: false })).toBe(SPLASH_MAX_MS);
    expect(splashHoldMs({ shownForMs: 1_000, pageReady: false })).toBe(SPLASH_MAX_MS - 1_000);
  });

  it("keeps the greeting long enough to read as one", () => {
    // The two bounds only mean anything in this order: a minimum above zero and a
    // ceiling well beyond it.
    expect(SPLASH_MIN_MS).toBeGreaterThan(0);
    expect(SPLASH_MAX_MS).toBeGreaterThan(SPLASH_MIN_MS);
  });
});
