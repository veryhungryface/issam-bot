import { describe, expect, it } from "vitest";
import {
  COVER_CEILING_MS,
  clearsTheStage,
  coverHoldMs,
  INTRO_FIELD,
  INTRO_ORDER,
  INTRO_SCORE,
  INTRO_STAGE,
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

describe("the sky it plays in", () => {
  it("is already there when the sequence starts, and warms as the mark arrives", () => {
    expect(INTRO_SCORE.field.at).toBe(0);
    expect(INTRO_SCORE.glow.at).toBe(INTRO_SCORE.mark.at);
  });

  it("keeps every star clear of the centre the sequence plays in", () => {
    for (const star of INTRO_FIELD) {
      expect(clearsTheStage(star)).toBe(true);
    }
    // The rule is worth having only if it could fail: one in the middle must not pass.
    expect(clearsTheStage({ x: 0.5, y: 0.5, size: 10, dim: 0.2, turn: 0 })).toBe(false);
  });

  it("stays on the screen, stays faint, and stays scattered", () => {
    for (const star of INTRO_FIELD) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThanOrEqual(1);
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThanOrEqual(1);
      // Background, not decoration: a star bright enough to read as an element would
      // compete with the mark it sits behind. The ceiling is higher than it looks —
      // the field's sparkle is a thin shape, so it puts far less ink on the screen at
      // the same opacity than the plump mark would.
      expect(star.dim).toBeLessThanOrEqual(0.35);
      expect(star.size).toBeLessThanOrEqual(22);
    }
    for (const [index, star] of INTRO_FIELD.entries()) {
      for (const other of INTRO_FIELD.slice(index + 1)) {
        const apart = Math.hypot(star.x - other.x, star.y - other.y);
        expect(apart).toBeGreaterThan(0.12);
      }
    }
  });

  it("describes a stage the mark and its name actually stand in", () => {
    expect(INTRO_STAGE.left).toBeLessThan(0.5);
    expect(INTRO_STAGE.right).toBeGreaterThan(0.5);
    expect(INTRO_STAGE.top).toBeLessThan(0.5);
    expect(INTRO_STAGE.bottom).toBeGreaterThan(0.5);
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
