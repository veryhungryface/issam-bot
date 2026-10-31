import { describe, expect, it } from "vitest";
import {
  type CronPreset,
  cronFromPreset,
  describeCronPreset,
  formatCron,
  hasMixedOneShotSchedule,
  isOneShotRoutineCrons,
  MAX_ROUTINE_RUNS_PER_DAY,
  nextCronDate,
  nextCronDateAcross,
  nextCronDateAcrossStrict,
  ONCE_ROUTINE_CRON,
  presetFromCron,
  resolveRoutineNextRunAt,
  routineFrequency,
  validateRoutineFrequency,
} from "./cron.js";

function preset(partial: Partial<CronPreset> & Pick<CronPreset, "freq">): CronPreset {
  return {
    n: 3,
    unit: "minutes",
    time: "9:00 AM",
    cron: "",
    ...partial,
  };
}

describe("cronFromPreset", () => {
  it("maps everyday language onto cron", () => {
    expect(cronFromPreset(preset({ freq: "Every day", time: "9:00 AM" }))).toBe("0 9 * * *");
    expect(cronFromPreset(preset({ freq: "Weekdays", time: "8:00 AM" }))).toBe("0 8 * * 1-5");
    expect(cronFromPreset(preset({ freq: "Every week", time: "9:00 AM" }))).toBe("0 9 * * 1");
    expect(cronFromPreset(preset({ freq: "Every month", time: "12:00 PM" }))).toBe("0 12 1 * *");
    expect(cronFromPreset(preset({ freq: "Every hour" }))).toBe("0 * * * *");
    expect(cronFromPreset(preset({ freq: "Every day", time: "12:00 AM" }))).toBe("0 0 * * *");
    expect(cronFromPreset(preset({ freq: "Every day", time: "3:00 PM" }))).toBe("0 15 * * *");
  });

  it("maps intervals including days", () => {
    expect(cronFromPreset(preset({ freq: "Interval", n: 15, unit: "minutes" }))).toBe(
      "*/15 * * * *",
    );
    expect(cronFromPreset(preset({ freq: "Interval", n: 2, unit: "hours" }))).toBe("0 */2 * * *");
    expect(cronFromPreset(preset({ freq: "Interval", n: 3, unit: "days" }))).toBe("0 0 */3 * *");
  });

  it("keeps advanced expressions", () => {
    expect(cronFromPreset(preset({ freq: "Advanced", cron: "0 10 15 * *" }))).toBe("0 10 15 * *");
    expect(cronFromPreset(preset({ freq: "Advanced", cron: "" }))).toBe("*/3 * * * *");
    expect(cronFromPreset(preset({ freq: "Advanced", cron: ONCE_ROUTINE_CRON }))).toBe(
      ONCE_ROUTINE_CRON,
    );
  });
});

describe("presetFromCron", () => {
  it("reads the previous Monday-morning default as weekly", () => {
    expect(presetFromCron("0 9 * * 1")).toMatchObject({
      freq: "Every week",
      time: "9:00 AM",
    });
  });

  it("round-trips the named presets", () => {
    const cases: CronPreset[] = [
      preset({ freq: "Every hour" }),
      preset({ freq: "Every day", time: "6:00 PM" }),
      preset({ freq: "Weekdays", time: "7:00 AM" }),
      preset({ freq: "Every week", time: "9:00 AM" }),
      preset({ freq: "Every month", time: "12:00 PM" }),
      preset({ freq: "Interval", n: 10, unit: "minutes" }),
      preset({ freq: "Interval", n: 5, unit: "hours" }),
      preset({ freq: "Interval", n: 2, unit: "days" }),
      preset({ freq: "Advanced", cron: "0 10 15 * *" }),
    ];
    for (const input of cases) {
      const cron = cronFromPreset(input);
      const parsed = presetFromCron(cron);
      expect(parsed.freq).toBe(input.freq);
      if (input.freq === "Interval") {
        expect(parsed.n).toBe(input.n);
        expect(parsed.unit).toBe(input.unit);
      }
      if (["Every day", "Weekdays", "Every week", "Every month"].includes(input.freq)) {
        expect(parsed.time).toBe(input.time);
      }
      if (input.freq === "Advanced") {
        expect(parsed.cron).toBe(input.cron);
      }
    }
  });

  it("falls back to advanced for expressions the picker cannot represent", () => {
    expect(presetFromCron("0 9 * * 0")).toMatchObject({ freq: "Advanced", cron: "0 9 * * 0" });
    expect(presetFromCron("30 14 15 * *")).toMatchObject({
      freq: "Advanced",
      cron: "30 14 15 * *",
    });
    expect(presetFromCron(ONCE_ROUTINE_CRON)).toMatchObject({
      freq: "Advanced",
      cron: ONCE_ROUTINE_CRON,
    });
  });
});

describe("resolveRoutineNextRunAt", () => {
  it("preserves existing nextRunAt for one-shot routines", () => {
    const existing = new Date("2030-01-01T09:00:00.000Z");
    expect(resolveRoutineNextRunAt(ONCE_ROUTINE_CRON, new Date(), "UTC", existing)).toEqual(
      existing,
    );
    expect(resolveRoutineNextRunAt(ONCE_ROUTINE_CRON, new Date(), "UTC", null)).toBeNull();
  });

  it("computes cron schedules for repeating routines", () => {
    const next = resolveRoutineNextRunAt("*/1 * * * *", new Date(), "UTC", null);
    expect(next?.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("formatCron", () => {
  it("shows a human schedule instead of the expression", () => {
    expect(formatCron("0 9 * * 1")).toBe("Every Monday at 9:00 AM");
    expect(formatCron("0 8 * * 1-5")).toBe("Weekdays at 8:00 AM");
    expect(formatCron("*/15 * * * *")).toBe("Every 15 minutes");
    expect(formatCron(ONCE_ROUTINE_CRON)).toBe("One-time");
    expect(describeCronPreset(preset({ freq: "Every hour" }))).toEqual({
      lead: "Every hour",
      detail: "",
    });
  });
});

describe("nextCronDate", () => {
  it("returns the next matching time today for a daily cron", () => {
    const from = new Date("2026-08-24T10:30:00.000Z");
    expect(nextCronDate("0 11 * * *", from)).toEqual(new Date("2026-08-24T11:00:00.000Z"));
  });

  it("honors day-of-week instead of matching the same hour tomorrow", () => {
    // Monday 13:52 UTC; the weekly slot is Monday 13:00, so the next fire is
    // the following Monday, not Tuesday.
    const from = new Date("2026-08-24T13:52:00.000Z");
    expect(nextCronDate("0 13 * * 1", from)).toEqual(new Date("2026-08-31T13:00:00.000Z"));
  });

  it("maps cron day 7 to Sunday", () => {
    const from = new Date("2026-08-26T12:00:00.000Z"); // Wednesday
    expect(nextCronDate("0 9 * * 7", from)).toEqual(new Date("2026-08-30T09:00:00.000Z"));
  });

  it("supports day 7 inside composite day expressions", () => {
    const from = new Date("2026-08-26T12:00:00.000Z"); // Wednesday
    // 1,7 = Monday and Sunday -> next is Sunday Aug 30.
    expect(nextCronDate("0 9 * * 1,7", from)).toEqual(new Date("2026-08-30T09:00:00.000Z"));
    // 5-7 = Friday, Saturday, Sunday -> next is Friday Aug 28.
    expect(nextCronDate("0 9 * * 5-7", from)).toEqual(new Date("2026-08-28T09:00:00.000Z"));
    expect(nextCronDate("0 9 * * 0-7", from)).toEqual(new Date("2026-08-27T09:00:00.000Z"));
  });

  it("honors day-of-month and month fields", () => {
    const from = new Date("2026-08-24T10:30:00.000Z");
    expect(nextCronDate("0 9 1 * *", from)).toEqual(new Date("2026-09-01T09:00:00.000Z"));
    expect(nextCronDate("0 9 1 10 *", from)).toEqual(new Date("2026-10-01T09:00:00.000Z"));
  });

  it("evaluates the schedule in the routine timezone", () => {
    // 10:00 UTC is 06:00 in New York on the same day, so a 7 AM America/New_York
    // daily slot still fires later the same UTC day.
    const from = new Date("2026-08-24T10:00:00.000Z");
    expect(nextCronDate("0 7 * * *", from, "America/New_York")).toEqual(
      new Date("2026-08-24T11:00:00.000Z"),
    );
  });

  it("falls back to UTC for an unknown timezone", () => {
    const from = new Date("2026-08-24T10:00:00.000Z");
    expect(nextCronDate("0 7 * * *", from, "Mars/Olympus")).toEqual(
      new Date("2026-08-25T07:00:00.000Z"),
    );
  });

  it("keeps the local hour across daylight saving time", () => {
    const from = new Date("2026-03-07T12:01:00.000Z");
    expect(nextCronDate("0 7 * * *", from, "America/New_York")).toEqual(
      new Date("2026-03-08T11:00:00.000Z"),
    );
  });

  it("rejects malformed expressions instead of scheduling one minute later", () => {
    const from = new Date("2026-08-24T10:00:00.000Z");
    expect(() => nextCronDate("61 25 * * *", from)).toThrow();
    expect(() => nextCronDate("not-a-cron", from)).toThrow();
    expect(() => nextCronDate("0 0 9 * * *", from)).toThrow();
  });
});

describe("isOneShotRoutineCrons", () => {
  it("is one-shot only for a single @once schedule", () => {
    expect(isOneShotRoutineCrons([ONCE_ROUTINE_CRON])).toBe(true);
    expect(isOneShotRoutineCrons(["0 9 * * *"])).toBe(false);
    expect(isOneShotRoutineCrons([ONCE_ROUTINE_CRON, "0 9 * * *"])).toBe(false);
    expect(isOneShotRoutineCrons([])).toBe(false);
  });
});

describe("nextCronDateAcross", () => {
  it("returns the nearest next run across every recurring schedule", () => {
    const from = new Date("2026-08-24T00:00:00.000Z");
    expect(nextCronDateAcross(["0 9 * * *", "0 15 * * *"], from, "UTC")).toEqual(
      new Date("2026-08-24T09:00:00.000Z"),
    );
  });

  it("ignores @once entries and schedules that fail to parse", () => {
    const from = new Date("2026-08-24T00:00:00.000Z");
    expect(nextCronDateAcross([ONCE_ROUTINE_CRON, "0 9 * * *", "not-a-cron"], from, "UTC")).toEqual(
      new Date("2026-08-24T09:00:00.000Z"),
    );
  });

  it("returns null when nothing is a valid recurring schedule", () => {
    const from = new Date("2026-08-24T00:00:00.000Z");
    expect(nextCronDateAcross([ONCE_ROUTINE_CRON], from, "UTC")).toBeNull();
    expect(nextCronDateAcross(["not-a-cron"], from, "UTC")).toBeNull();
  });
});

describe("hasMixedOneShotSchedule", () => {
  it("flags @once combined with anything else", () => {
    expect(hasMixedOneShotSchedule([ONCE_ROUTINE_CRON, "0 9 * * *"])).toBe(true);
    expect(hasMixedOneShotSchedule(["0 9 * * *", ONCE_ROUTINE_CRON])).toBe(true);
  });

  it("does not flag a lone schedule of any kind", () => {
    expect(hasMixedOneShotSchedule([ONCE_ROUTINE_CRON])).toBe(false);
    expect(hasMixedOneShotSchedule(["0 9 * * *"])).toBe(false);
    expect(hasMixedOneShotSchedule([])).toBe(false);
  });

  it("does not flag multiple recurring schedules", () => {
    expect(hasMixedOneShotSchedule(["0 9 * * *", "0 15 * * *"])).toBe(false);
  });
});

describe("nextCronDateAcrossStrict", () => {
  it("returns the nearest next run across every recurring schedule", () => {
    const from = new Date("2026-08-24T00:00:00.000Z");
    expect(nextCronDateAcrossStrict(["0 9 * * *", "0 15 * * *"], from, "UTC")).toEqual(
      new Date("2026-08-24T09:00:00.000Z"),
    );
  });

  it("ignores @once entries", () => {
    const from = new Date("2026-08-24T00:00:00.000Z");
    expect(nextCronDateAcrossStrict([ONCE_ROUTINE_CRON, "0 9 * * *"], from, "UTC")).toEqual(
      new Date("2026-08-24T09:00:00.000Z"),
    );
  });

  it("throws on a malformed recurring cron even when another entry is valid", () => {
    const from = new Date("2026-08-24T00:00:00.000Z");
    expect(() => nextCronDateAcrossStrict(["0 9 * * *", "not-a-cron"], from, "UTC")).toThrow();
  });

  it("returns null when the array is empty or only @once", () => {
    const from = new Date("2026-08-24T00:00:00.000Z");
    expect(nextCronDateAcrossStrict([ONCE_ROUTINE_CRON], from, "UTC")).toBeNull();
    expect(nextCronDateAcrossStrict([], from, "UTC")).toBeNull();
  });
});

describe("routine frequency", () => {
  // Monday, mid-morning Korean time: a weekday, so the Weekdays cron has a day to land on.
  const from = new Date("2026-10-19T01:00:00.000Z");

  it("counts the wakes the schedule that emptied a teacher's credit actually made", () => {
    // `0 */4 * * *`, twice over: the two stock-watchers, as they ran in production.
    expect(routineFrequency(["0 */4 * * *"], "Asia/Seoul", from).perDay).toBe(6);
    expect(validateRoutineFrequency(["0 */4 * * *"], "Asia/Seoul", from)).toContain("하루 6번");
  });

  it("counts every cron on the routine together, because each one is its own wake", () => {
    // Two schedules of one a day is two wakes a day, not one — the cost is per wake.
    const twice = routineFrequency(["0 9 * * *", "0 21 * * *"], "Asia/Seoul", from);
    expect(twice.perDay).toBe(2);
    expect(validateRoutineFrequency(["0 9 * * *", "0 21 * * *"], "Asia/Seoul", from)).toBeNull();

    const thrice = ["0 9 * * *", "0 15 * * *", "0 21 * * *"];
    expect(routineFrequency(thrice, "Asia/Seoul", from).perDay).toBe(3);
    expect(validateRoutineFrequency(thrice, "Asia/Seoul", from)).not.toBeNull();
  });

  it("allows everything at or under the ceiling", () => {
    for (const crons of [["0 9 * * *"], ["0 */12 * * *"], ["0 0 */3 * *"], ["30 9 * * 1"]]) {
      expect(validateRoutineFrequency(crons, "Asia/Seoul", from)).toBeNull();
      expect(routineFrequency(crons, "Asia/Seoul", from).perDay).toBeLessThanOrEqual(
        MAX_ROUTINE_RUNS_PER_DAY,
      );
    }
  });

  it("refuses to quote a number it only partly counted", () => {
    // Every minute is 1,440 a day; the walk stops long before that, so the message says
    // "much more often" rather than naming the floor it happened to stop at.
    const every = routineFrequency(["* * * * *"], "Asia/Seoul", from);
    expect(every.truncated).toBe(true);
    const message = validateRoutineFrequency(["* * * * *"], "Asia/Seoul", from);
    expect(message).toContain("훨씬 잦아요");
    expect(message).not.toMatch(/하루 \d+번이에요/);
  });

  it("counts days in the routine's own timezone, not UTC", () => {
    // 09:00 and 23:00 Seoul is twice on one Korean day; read as UTC the second lands at
    // 14:00 the day before, and the pair would look like one a day and slip through.
    const crons = ["0 9 * * *", "0 23 * * *"];
    expect(routineFrequency(crons, "Asia/Seoul", from).perDay).toBe(2);
    expect(routineFrequency(crons, "UTC", from).perDay).toBe(2);
    // The boundary case: 00:30 and 23:30 Seoul are the same Korean day, 15:30 and 14:30 UTC
    // on two different UTC days.
    const edge = ["30 0 * * *", "30 23 * * *"];
    expect(routineFrequency(edge, "Asia/Seoul", from).perDay).toBe(2);
  });

  it("ignores one-shots and unparseable crons", () => {
    expect(routineFrequency([ONCE_ROUTINE_CRON], "Asia/Seoul", from).perDay).toBe(0);
    expect(validateRoutineFrequency([ONCE_ROUTINE_CRON], "Asia/Seoul", from)).toBeNull();
    expect(validateRoutineFrequency([], "Asia/Seoul", from)).toBeNull();
    // Malformed crons are rejected by nextCronDateAcrossStrict, not here; this must not
    // throw on the way past them.
    expect(routineFrequency(["not-a-cron"], "Asia/Seoul", from).perDay).toBe(0);
  });

  it("falls back to UTC for a timezone it cannot read instead of throwing", () => {
    expect(routineFrequency(["0 */4 * * *"], "Mars/Olympus", from).perDay).toBe(6);
  });

  it("turns down the hourly preset the picker used to offer", () => {
    expect(
      validateRoutineFrequency(
        [cronFromPreset(preset({ freq: "Every hour" }))],
        "Asia/Seoul",
        from,
      ),
    ).not.toBeNull();
    // And the interval default now lands inside the limit.
    expect(
      validateRoutineFrequency(
        [cronFromPreset({ freq: "Interval", n: 12, unit: "hours" })],
        "Asia/Seoul",
        from,
      ),
    ).toBeNull();
  });
});
