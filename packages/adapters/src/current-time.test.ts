import { describe, expect, it } from "vitest";
import { formatCurrentTimeInstruction } from "./current-time.js";

const NOON_UTC = new Date("2026-09-20T12:34:56.789Z");

describe("formatCurrentTimeInstruction", () => {
  it("states the weekday and a seconds-precision UTC timestamp", () => {
    const instruction = formatCurrentTimeInstruction(NOON_UTC, undefined);
    expect(instruction).toContain("Sunday, 2026-09-20T12:34:56Z (UTC)");
    expect(instruction).not.toContain(".789");
    expect(instruction).toContain("Treat this as the present moment");
  });

  it("adds the deployment's local reading, which can be the next day", () => {
    // 2026-09-20T15:10Z is already Monday the 21st in Seoul: a bot that only knew UTC
    // would answer a Korean "오늘" with yesterday's date all evening.
    const instruction = formatCurrentTimeInstruction(
      new Date("2026-09-20T15:10:00Z"),
      "Asia/Seoul",
    );
    expect(instruction).toContain("Asia/Seoul");
    expect(instruction).toContain("Monday, 2026-09-21");
  });

  it("keeps the UTC anchor when the configured zone is unusable", () => {
    const instruction = formatCurrentTimeInstruction(NOON_UTC, "Not/AZone");
    expect(instruction).toContain("2026-09-20T12:34:56Z (UTC)");
    expect(instruction).not.toContain("Not/AZone");
  });
});
