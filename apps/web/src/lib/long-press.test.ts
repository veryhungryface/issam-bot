import { describe, expect, it } from "vitest";
import { heldOnPlainContent, heldStill, LONG_PRESS_SLOP_PX } from "./long-press";

/** Just enough of an element for the only DOM question these functions ask. */
function target(match: string | null): Pick<Element, "closest"> {
  return {
    closest: (selector: string) => (match && selector.includes(match) ? ({} as Element) : null),
  };
}

describe("heldOnPlainContent", () => {
  it("leaves a hold on a control to the control", () => {
    expect(heldOnPlainContent(target("button"))).toBe(false);
    expect(heldOnPlainContent(target("a,"))).toBe(false);
    expect(heldOnPlainContent(target("contenteditable"))).toBe(false);
  });

  it("takes a hold on the words of a message", () => {
    expect(heldOnPlainContent(target(null))).toBe(true);
  });
});

describe("heldStill", () => {
  it("forgives the wobble of a finger that means to stay put", () => {
    expect(heldStill(0, 0)).toBe(true);
    expect(heldStill(4, -6)).toBe(true);
  });

  it("lets go as soon as the finger is going somewhere", () => {
    expect(heldStill(LONG_PRESS_SLOP_PX, 0)).toBe(false);
    expect(heldStill(0, -LONG_PRESS_SLOP_PX)).toBe(false);
    expect(heldStill(40, 2)).toBe(false);
  });
});
