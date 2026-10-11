import { describe, expect, it } from "vitest";
import {
  COVER_CEILING_MS,
  clearsTheStage,
  coverHoldMs,
  INTRO_DEBRIS,
  INTRO_DEBRIS_REST,
  INTRO_FAINT_STARS,
  INTRO_MID_STARS,
  INTRO_ORDER,
  INTRO_SCORE,
  INTRO_SKY_BOX,
  INTRO_SPIKE_STARS,
  INTRO_STAGE,
  INTRO_TWINKLE,
  INTRO_TWINKLE_FLOOR,
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

  it("opens on the sky, so the comet has somewhere to cross", () => {
    expect(INTRO_SCORE.sky.at).toBe(0);
    expect(INTRO_SCORE.gas.at).toBeLessThan(INTRO_SCORE.comet.at);
  });

  it("lands the comet before anything it is supposed to have lit", () => {
    const lands = INTRO_SCORE.comet.at + INTRO_SCORE.comet.lasts;
    // The flash begins as it arrives, not after it has stopped.
    expect(INTRO_SCORE.flash.at).toBeGreaterThanOrEqual(lands - INTRO_SCORE.comet.lasts * 0.1);
    expect(INTRO_SCORE.flash.at).toBeLessThanOrEqual(lands);
    for (const lit of ["ring", "mark"] as const) {
      expect(INTRO_SCORE[lit].at).toBeGreaterThanOrEqual(INTRO_SCORE.flash.at);
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
    // Longer than a sequence that only fades a mark in: the comet has a journey to make
    // before anything can land. Still under three seconds, and the way out is offered
    // the moment the name is up.
    expect(introRunsForMs()).toBeLessThanOrEqual(2_900);
    expect(INTRO_SCORE.hint.at).toBeLessThanOrEqual(2_500);
  });

  it("measures the sequence by whatever finishes last, not by the last to start", () => {
    expect(
      introRunsForMs({
        ...INTRO_SCORE,
        sky: { at: 0, lasts: 9_000 },
      }),
    ).toBe(9_000);
  });
});

describe("the sky it plays in", () => {
  const field = [
    ...INTRO_FAINT_STARS,
    ...INTRO_MID_STARS,
    ...INTRO_TWINKLE.flatMap((group) => group.stars),
    ...INTRO_SPIKE_STARS,
  ];

  it("is a field, not a handful", () => {
    expect(field.length).toBeGreaterThan(60);
  });

  it("keeps every star inside the box it is drawn in", () => {
    for (const star of field) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThanOrEqual(INTRO_SKY_BOX.width);
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThanOrEqual(INTRO_SKY_BOX.height);
      // Stars are points at this distance. One drawn large enough to read as a shape
      // would be a mistake in the table, not a near star.
      expect(star.r).toBeLessThanOrEqual(2.5);
    }
  });

  it("never puts the same star in two places at once", () => {
    const seen = new Set(field.map((star) => `${star.x},${star.y}`));
    expect(seen.size).toBe(field.length);
  });

  it("keeps the cross-flared stars clear of the centre the sequence plays in", () => {
    // A faint point behind the mark is depth and nobody sees it. A cross behind the
    // mark is a smudge on the mascot's face.
    for (const spike of INTRO_SPIKE_STARS) {
      expect(clearsTheStage(spike)).toBe(true);
    }
    // The rule is worth having only if it could fail.
    const middle = { x: INTRO_SKY_BOX.width / 2, y: INTRO_SKY_BOX.height / 2 };
    expect(clearsTheStage(middle)).toBe(false);
  });

  it("gives each cross-flared star a clock that exists", () => {
    for (const spike of INTRO_SPIKE_STARS) {
      expect(INTRO_TWINKLE[spike.clock]).toBeDefined();
    }
  });

  it("breathes on clocks that do not fall into step", () => {
    const clocks = INTRO_TWINKLE.map((group) => group.ms);
    expect(new Set(clocks).size).toBe(clocks.length);
    for (const [index, ms] of clocks.entries()) {
      for (const other of clocks.slice(index + 1)) {
        // A clock that is a whole multiple of another beats with it, and the sky starts
        // pulsing in unison.
        expect(Math.max(ms, other) % Math.min(ms, other)).not.toBe(0);
      }
    }
    // Dimming, not blinking: a star that goes out reads as a dead pixel.
    expect(INTRO_TWINKLE_FLOOR).toBeGreaterThan(0.2);
  });

  it("describes a stage the mark and its name actually stand in", () => {
    expect(INTRO_STAGE.left).toBeLessThan(0.5);
    expect(INTRO_STAGE.right).toBeGreaterThan(0.5);
    expect(INTRO_STAGE.top).toBeLessThan(0.5);
    expect(INTRO_STAGE.bottom).toBeGreaterThan(0.5);
  });
});

describe("what the landing throws", () => {
  it("sends every piece somewhere, and leaves it faint", () => {
    for (const piece of INTRO_DEBRIS) {
      expect(Math.hypot(piece.dx, piece.dy)).toBeGreaterThan(60);
      expect(piece.delayMs).toBeGreaterThanOrEqual(0);
    }
    expect(INTRO_DEBRIS_REST).toBeLessThan(0.5);
  });

  it("throws them in different directions rather than in a fan", () => {
    const quarters = [
      INTRO_DEBRIS.filter((piece) => piece.dy < 0),
      INTRO_DEBRIS.filter((piece) => piece.dy > 0),
      INTRO_DEBRIS.filter((piece) => piece.dx < 0),
      INTRO_DEBRIS.filter((piece) => piece.dx > 0),
    ];
    for (const quarter of quarters) {
      expect(quarter.length).toBeGreaterThan(0);
    }
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
