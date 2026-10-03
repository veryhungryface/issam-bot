import { describe, expect, it } from "vitest";
import {
  isAgedStuckWork,
  isStuckWorkStatus,
  STUCK_WORK_EXPIRE_AFTER_MS,
  STUCK_WORK_NOTIFY_AFTER_MS,
  stuckWorkAction,
  stuckWorkAgeMs,
  stuckWorkReminder,
  stuckWorkStatusMessage,
  stuckWorkStatusMessages,
  stuckWorkStoppedNotification,
} from "./stuck-work.js";

const NOW = new Date("2026-10-03T09:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("stuckWorkAction", () => {
  it("stays quiet while a wait is still young", () => {
    expect(stuckWorkAction({ ageMs: 0, alreadyNotified: false })).toBe("none");
    expect(stuckWorkAction({ ageMs: STUCK_WORK_NOTIFY_AFTER_MS - 1, alreadyNotified: false })).toBe(
      "none",
    );
  });

  it("reminds once and then stays quiet for the same episode", () => {
    expect(stuckWorkAction({ ageMs: STUCK_WORK_NOTIFY_AFTER_MS, alreadyNotified: false })).toBe(
      "notify",
    );
    expect(stuckWorkAction({ ageMs: STUCK_WORK_NOTIFY_AFTER_MS, alreadyNotified: true })).toBe(
      "none",
    );
  });

  it("cancels a day-old wait whether or not the reminder landed", () => {
    for (const alreadyNotified of [false, true]) {
      expect(stuckWorkAction({ ageMs: STUCK_WORK_EXPIRE_AFTER_MS, alreadyNotified })).toBe(
        "expire",
      );
    }
  });

  it("reminds before it cancels", () => {
    expect(STUCK_WORK_NOTIFY_AFTER_MS).toBeLessThan(STUCK_WORK_EXPIRE_AFTER_MS);
  });
});

describe("stuckWorkAgeMs", () => {
  it("reads both a Date and the string a JSON payload carries", () => {
    expect(stuckWorkAgeMs(ago(5_000), NOW)).toBe(5_000);
    expect(stuckWorkAgeMs(ago(5_000).toISOString(), NOW)).toBe(5_000);
  });

  it("treats an unreadable stamp as brand new rather than ancient", () => {
    // A bad stamp must never be the reason a run is cancelled.
    expect(stuckWorkAgeMs("not a date", NOW)).toBe(0);
  });
});

describe("isAgedStuckWork", () => {
  it("only counts the statuses that wait on a person or a worker", () => {
    expect(isStuckWorkStatus("running")).toBe(false);
    expect(isAgedStuckWork("running", ago(STUCK_WORK_EXPIRE_AFTER_MS), NOW.getTime())).toBe(false);
    for (const status of ["queued", "waiting_input", "waiting_takeover"]) {
      expect(isAgedStuckWork(status, ago(STUCK_WORK_NOTIFY_AFTER_MS), NOW.getTime())).toBe(true);
      expect(isAgedStuckWork(status, ago(60_000), NOW.getTime())).toBe(false);
    }
  });
});

describe("what the user reads", () => {
  it("says what was being waited for, in Korean", () => {
    expect(stuckWorkStatusMessage("waiting_input")).toContain("답을 기다리다");
    expect(stuckWorkStatusMessage("waiting_takeover")).toContain("화면에서 기다리다");
    expect(stuckWorkStatusMessage("queued")).toContain("시작하지 못해서");
    expect(new Set(stuckWorkStatusMessages()).size).toBe(3);
  });

  it("asks for the screen only when the screen is what is waiting", () => {
    expect(stuckWorkReminder("waiting_takeover", "이삼봇").kind).toBe("takeover");
    expect(stuckWorkReminder("waiting_input", "이삼봇").kind).toBe("help");
    expect(stuckWorkReminder("queued", "이삼봇").kind).toBe("help");
  });

  it("names the bot, and stays readable when it has no name", () => {
    expect(stuckWorkReminder("waiting_input", "이삼봇").title).toContain("이삼봇");
    expect(stuckWorkReminder("waiting_input", "  ").title).toContain("봇");
    expect(stuckWorkStoppedNotification("queued", "이삼봇")).toMatchObject({
      kind: "failure",
      body: stuckWorkStatusMessage("queued"),
    });
  });
});
