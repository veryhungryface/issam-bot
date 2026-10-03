import { describe, expect, it } from "vitest";
import { checkInLocalHour, checkInTimeZone } from "./check-in.js";

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
