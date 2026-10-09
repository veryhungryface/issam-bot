import { describe, expect, it } from "vitest";
import {
  COVER_CEILING_MS,
  coverHoldMs,
  INTRO_ORDER,
  INTRO_SCORE,
  introRunsForMs,
  playsIntro,
} from "./launch-intro";

describe("the intro's score", () => {
  it("brings every element in, in the order it was written", () => {
    const starts = INTRO_ORDER.map((element) => INTRO_SCORE[element].at);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    // Not a sorted copy of itself by accident: the beats are genuinely apart.
    expect(new Set(starts).size).toBeGreaterThan(1);
  });

  it("never gives an element a backwards or instant entrance", () => {
    for (const element of INTRO_ORDER) {
      expect(INTRO_SCORE[element].at).toBeGreaterThanOrEqual(0);
      expect(INTRO_SCORE[element].lasts).toBeGreaterThan(0);
    }
  });

  it("wakes the face only once the mark it belongs to has landed", () => {
    expect(INTRO_SCORE.face.at).toBeGreaterThanOrEqual(
      INTRO_SCORE.mark.at + INTRO_SCORE.mark.lasts * 0.6,
    );
  });

  it("offers the way out last, and only after the sequence has played", () => {
    const beforeHint = INTRO_ORDER.filter((element) => element !== "hint");
    for (const element of beforeHint) {
      expect(INTRO_SCORE.hint.at).toBeGreaterThanOrEqual(
        INTRO_SCORE[element].at + INTRO_SCORE[element].lasts,
      );
    }
  });

  it("stays short enough to be an opening rather than a wait", () => {
    expect(introRunsForMs()).toBeLessThanOrEqual(2_200);
  });

  it("measures the sequence by whatever finishes last, not by the last to start", () => {
    expect(
      introRunsForMs({
        ...INTRO_SCORE,
        ring: { at: 0, lasts: 9_000 },
      }),
    ).toBe(9_000);
  });
});

describe("playsIntro", () => {
  it("plays on an ordinary launch", () => {
    expect(playsIntro({ openedFromNotification: false })).toBe(true);
  });

  it("gets out of the way of someone who tapped a notification", () => {
    expect(playsIntro({ openedFromNotification: true })).toBe(false);
  });
});

describe("coverHoldMs", () => {
  it("lifts as soon as the page has painted", () => {
    expect(coverHoldMs({ heldForMs: 0, pagePainted: true })).toBe(0);
    expect(coverHoldMs({ heldForMs: 5_000, pagePainted: true })).toBe(0);
  });

  it("waits out the ceiling for a page that never says anything", () => {
    expect(coverHoldMs({ heldForMs: 0, pagePainted: false })).toBe(COVER_CEILING_MS);
    expect(coverHoldMs({ heldForMs: 1_000, pagePainted: false })).toBe(COVER_CEILING_MS - 1_000);
    expect(coverHoldMs({ heldForMs: 99_000, pagePainted: false })).toBe(0);
  });
});
