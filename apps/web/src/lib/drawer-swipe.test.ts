import { describe, expect, it } from "vitest";
import {
  DRAG_AXIS_SLOP_PX,
  dragAxis,
  drawerOffsetPx,
  drawerProgress,
  openingDistance,
  openingSign,
  settlesOpen,
  startsAtEdge,
} from "./drawer-swipe";

describe("dragAxis", () => {
  it("waits until the finger has committed to a direction", () => {
    expect(dragAxis(0, 0)).toBe("undecided");
    expect(dragAxis(9, 9)).toBe("undecided");
    expect(dragAxis(-9, 4)).toBe("undecided");
  });

  it("gives a diagonal to the drawer and a scroll to the list", () => {
    expect(dragAxis(40, 12)).toBe("horizontal");
    expect(dragAxis(-40, 12)).toBe("horizontal");
    expect(dragAxis(12, 40)).toBe("vertical");
    expect(dragAxis(12, -40)).toBe("vertical");
  });

  it("treats an exactly diagonal drag as the drawer's", () => {
    // Ties go sideways: a drawer that ignores them feels unresponsive, while a list that
    // ignores them does not, because the next move resolves the ambiguity anyway.
    expect(dragAxis(DRAG_AXIS_SLOP_PX, DRAG_AXIS_SLOP_PX)).toBe("horizontal");
  });
});

describe("openingSign", () => {
  it("knows which way each drawer opens in each writing direction", () => {
    expect(openingSign("start", false)).toBe(1);
    expect(openingSign("start", true)).toBe(-1);
    expect(openingSign("end", false)).toBe(-1);
    expect(openingSign("end", true)).toBe(1);
  });

  it("measures movement towards open rather than to the right", () => {
    expect(openingDistance(30, "start", false)).toBe(30);
    expect(openingDistance(30, "start", true)).toBe(-30);
    expect(openingDistance(-30, "end", false)).toBe(30);
  });
});

describe("startsAtEdge", () => {
  const viewportWidth = 390;

  it("opens the start drawer only from the leading edge", () => {
    expect(startsAtEdge({ x: 6, viewportWidth, edge: "start", rtl: false })).toBe(true);
    expect(startsAtEdge({ x: 120, viewportWidth, edge: "start", rtl: false })).toBe(false);
  });

  it("mirrors for a right-to-left layout", () => {
    expect(startsAtEdge({ x: 384, viewportWidth, edge: "start", rtl: true })).toBe(true);
    expect(startsAtEdge({ x: 6, viewportWidth, edge: "start", rtl: true })).toBe(false);
  });

  it("puts the end drawer's edge on the opposite side", () => {
    expect(startsAtEdge({ x: 384, viewportWidth, edge: "end", rtl: false })).toBe(true);
    expect(startsAtEdge({ x: 6, viewportWidth, edge: "end", rtl: false })).toBe(false);
  });
});

describe("drawerProgress", () => {
  const width = 300;

  it("follows the finger out of a closed drawer", () => {
    expect(drawerProgress({ openAtStart: false, dx: 0, width, edge: "start", rtl: false })).toBe(0);
    expect(drawerProgress({ openAtStart: false, dx: 150, width, edge: "start", rtl: false })).toBe(
      0.5,
    );
  });

  it("follows the finger back into an open drawer", () => {
    expect(drawerProgress({ openAtStart: true, dx: -75, width, edge: "start", rtl: false })).toBe(
      0.75,
    );
  });

  it("never runs past either end, so a long drag cannot overshoot", () => {
    expect(drawerProgress({ openAtStart: false, dx: 9000, width, edge: "start", rtl: false })).toBe(
      1,
    );
    expect(drawerProgress({ openAtStart: true, dx: -9000, width, edge: "start", rtl: false })).toBe(
      0,
    );
    expect(drawerProgress({ openAtStart: false, dx: -200, width, edge: "start", rtl: false })).toBe(
      0,
    );
  });

  it("holds still rather than dividing by a width it has not measured yet", () => {
    expect(
      drawerProgress({ openAtStart: true, dx: -50, width: 0, edge: "start", rtl: false }),
    ).toBe(1);
    expect(
      drawerProgress({ openAtStart: false, dx: 50, width: 0, edge: "start", rtl: false }),
    ).toBe(0);
  });

  it("reads a right-to-left drag the same way round", () => {
    expect(drawerProgress({ openAtStart: false, dx: -150, width, edge: "start", rtl: true })).toBe(
      0.5,
    );
  });
});

describe("settlesOpen", () => {
  it("goes wherever the drawer is already more than half way towards", () => {
    expect(settlesOpen({ progress: 0.6, velocity: 0 })).toBe(true);
    expect(settlesOpen({ progress: 0.4, velocity: 0 })).toBe(false);
    expect(settlesOpen({ progress: 0.5, velocity: 0 })).toBe(true);
  });

  it("lets a flick win over position in both directions", () => {
    // Barely moved, but thrown open.
    expect(settlesOpen({ progress: 0.08, velocity: 1.4 })).toBe(true);
    // Nearly all the way open, but thrown shut.
    expect(settlesOpen({ progress: 0.92, velocity: -1.4 })).toBe(false);
  });

  it("ignores a drift too slow to be a flick", () => {
    expect(settlesOpen({ progress: 0.2, velocity: 0.2 })).toBe(false);
    expect(settlesOpen({ progress: 0.8, velocity: -0.2 })).toBe(true);
  });
});

describe("drawerOffsetPx", () => {
  const width = 300;

  it("hides a closed drawer exactly off screen and shows an open one in place", () => {
    expect(drawerOffsetPx({ progress: 0, width, edge: "start", rtl: false })).toBe(-300);
    expect(drawerOffsetPx({ progress: 1, width, edge: "start", rtl: false })).toBe(0);
    expect(drawerOffsetPx({ progress: 0.5, width, edge: "start", rtl: false })).toBe(-150);
  });

  it("pushes an end drawer off the other side", () => {
    expect(drawerOffsetPx({ progress: 0, width, edge: "end", rtl: false })).toBe(300);
  });

  it("clamps, so a progress outside the track cannot tear the drawer off screen", () => {
    expect(drawerOffsetPx({ progress: 2, width, edge: "start", rtl: false })).toBe(0);
    expect(drawerOffsetPx({ progress: -1, width, edge: "start", rtl: false })).toBe(-300);
  });
});
