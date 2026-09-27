import { describe, expect, it } from "vitest";
import { NARRATION_STEP_MS, workingNarration } from "./working-narration";

describe("workingNarration", () => {
  it("moves through the start of a turn instead of freezing on one label", () => {
    const at = (ms: number) => workingNarration({ elapsedMs: ms })?.id;
    expect(at(0)).toBe("reading");
    expect(at(NARRATION_STEP_MS + 10)).toBe("planning");
    expect(at(NARRATION_STEP_MS * 2 + 10)).toBe("web");
    expect(at(NARRATION_STEP_MS * 3 + 10)).toBe("control");
  });

  it("holds on the last line rather than looping back", () => {
    // A cold boot runs 7-9s; cycling back to "reading your request" would be a lie.
    expect(workingNarration({ elapsedMs: NARRATION_STEP_MS * 20 })?.id).toBe("control");
  });

  it("says the browser is coming up as soon as that is a fact", () => {
    expect(workingNarration({ elapsedMs: 0, computerState: "booting" })?.id).toBe("booting");
    expect(workingNarration({ elapsedMs: 30_000, computerState: "booting" })?.id).toBe("booting");
  });

  it("goes quiet once the run has real tool activity to show", () => {
    expect(workingNarration({ elapsedMs: 1_000, hasToolActivity: true })).toBeUndefined();
    expect(
      workingNarration({ elapsedMs: 1_000, computerState: "booting", hasToolActivity: true }),
    ).toBeUndefined();
  });

  it("never reports a negative elapsed time as a later phase", () => {
    expect(workingNarration({ elapsedMs: -5_000 })?.id).toBe("reading");
  });
});
