import { describe, expect, it } from "vitest";
import { checkInLocalHour, checkInScheduleSettled, checkInTimeZone } from "./check-in.js";

describe("checkInTimeZone", () => {
  it("uses the deployment zone so the five checks land in local waking hours", () => {
    expect(checkInTimeZone("Asia/Seoul")).toBe("Asia/Seoul");
  });

  it("falls back to UTC rather than let croner silently pick it for us", () => {
    expect(checkInTimeZone("Not/AZone")).toBe("UTC");
    expect(checkInTimeZone("")).toBe("UTC");
    expect(checkInTimeZone(undefined)).toBe("UTC");
  });
});

describe("checkInLocalHour", () => {
  it("reads the hour in the bot's zone, not the server's", () => {
    // 23:00 UTC is already 08:00 the next morning in Seoul — past quiet hours.
    const night = new Date("2026-10-02T23:00:00Z");
    expect(checkInLocalHour(night, "UTC")).toBe(23);
    expect(checkInLocalHour(night, "Asia/Seoul")).toBe(8);
  });

  it("reports midnight as hour zero", () => {
    expect(checkInLocalHour(new Date("2026-10-03T15:00:00Z"), "Asia/Seoul")).toBe(0);
  });
});

describe("checkInScheduleSettled", () => {
  const want = { crons: ["30 9 * * *", "0 15 * * *"], timezone: "Asia/Seoul", active: true };
  const row = { kind: "checkin", ...want, nextRunAt: new Date("2026-10-03T00:30:00Z") };

  it("leaves a matching armed schedule alone", () => {
    // Every app load syncs. Rewriting an already-correct schedule would walk a
    // check that is due right now forward and the user would lose it.
    expect(checkInScheduleSettled(row, want)).toBe(true);
  });

  it("re-syncs when quiet hours moved the slots", () => {
    expect(checkInScheduleSettled({ ...row, crons: ["0 12 * * *"] }, want)).toBe(false);
    expect(checkInScheduleSettled({ ...row, crons: [...want.crons, "0 18 * * *"] }, want)).toBe(
      false,
    );
  });

  it("re-syncs when the zone, the switch, or the arming changed", () => {
    expect(checkInScheduleSettled({ ...row, timezone: "UTC" }, want)).toBe(false);
    expect(checkInScheduleSettled({ ...row, active: false }, want)).toBe(false);
    expect(checkInScheduleSettled({ ...row, nextRunAt: null }, want)).toBe(false);
  });

  it("does not need an armed time when check-ins are off", () => {
    expect(
      checkInScheduleSettled(
        { ...row, active: false, nextRunAt: null },
        { ...want, active: false },
      ),
    ).toBe(true);
  });

  it("re-adopts a row that lost its kind", () => {
    expect(checkInScheduleSettled({ ...row, kind: "user" }, want)).toBe(false);
  });
});
