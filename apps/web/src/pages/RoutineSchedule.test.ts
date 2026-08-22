import { describe, expect, it } from "vitest";
import { describeKoreanSchedule, formatKoreanCron } from "./RoutineSchedule";

describe("Korean routine schedule labels", () => {
  it("keeps the stored AM/PM value while presenting a Korean time label", () => {
    const preset = {
      freq: "Weekdays",
      n: 3,
      unit: "minutes",
      time: "9:00 AM",
      cron: "",
    } as const;

    expect(describeKoreanSchedule(preset)).toEqual({
      lead: "평일",
      detail: "오전 9:00에",
    });
    expect(preset.time).toBe("9:00 AM");
  });

  it("formats persisted cron expressions without exposing English schedule labels", () => {
    expect(formatKoreanCron("0 9 * * 1-5")).toBe("평일 오전 9:00에");
  });
});
