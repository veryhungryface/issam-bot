import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  botMessageAwaitsReply,
  CHECK_IN_DAILY_GAP_MS,
  CHECK_IN_FOLLOW_UP_AFTER_MS,
  CHECK_IN_FOLLOW_UP_PAUSE_MS,
  CHECK_IN_FOLLOW_UP_STALE_MS,
  CHECK_IN_JUDGMENT_INSTRUCTION,
  CHECK_IN_MAX_UNANSWERED,
  CHECK_IN_QUIET_USER_AFTER_MS,
  CHECK_IN_QUIET_USER_STALE_MS,
  CHECK_IN_RECENT_CONVERSATION_MS,
  CHECK_IN_SPEAK_GAP_MS,
  CHECK_IN_THREAD_QUIET_MS,
  CHECK_INS_PER_DAY,
  type CheckInSignals,
  checkInClockTimes,
  checkInCrons,
  checkInWakeDecision,
  checkInWakingWindow,
  DEFAULT_CHECK_IN_QUIET_END_HOUR,
  DEFAULT_CHECK_IN_QUIET_START_HOUR,
  formatCheckInPrompt,
  isCheckInQuietHour,
  nextCronDateAcross,
} from "./index.js";

describe("checkInWakingWindow", () => {
  it("measures the window forward from the hour quiet ends", () => {
    expect(checkInWakingWindow(22, 8)).toEqual({ startHour: 8, lengthHours: 14 });
  });

  it("handles quiet hours that do not cross midnight", () => {
    expect(checkInWakingWindow(13, 9)).toEqual({ startHour: 9, lengthHours: 4 });
  });

  it("treats equal bounds as no quiet hours at all", () => {
    expect(checkInWakingWindow(0, 0)).toEqual({ startHour: 0, lengthHours: 24 });
  });

  it("normalizes out-of-range hours instead of producing a negative window", () => {
    expect(checkInWakingWindow(46, -16)).toEqual({ startHour: 8, lengthHours: 14 });
  });
});

describe("checkInClockTimes", () => {
  it("spreads five checks across the default waking day", () => {
    const window = checkInWakingWindow(
      DEFAULT_CHECK_IN_QUIET_START_HOUR,
      DEFAULT_CHECK_IN_QUIET_END_HOUR,
    );
    expect(checkInClockTimes(window)).toEqual([
      { hour: 9, minute: 30 },
      { hour: 12, minute: 15 },
      { hour: 15, minute: 0 },
      { hour: 17, minute: 45 },
      { hour: 20, minute: 30 },
    ]);
  });

  it("keeps a short waking window inside its own bounds", () => {
    // A user awake only 09:00-13:00 still gets five checks, all inside those hours.
    const times = checkInClockTimes(checkInWakingWindow(13, 9));
    expect(times).toEqual([
      { hour: 9, minute: 30 },
      { hour: 10, minute: 15 },
      { hour: 11, minute: 0 },
      { hour: 11, minute: 45 },
      { hour: 12, minute: 30 },
    ]);
  });

  it("never schedules a check inside quiet hours", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 23 }),
        (start, end) => {
          for (const time of checkInClockTimes(checkInWakingWindow(start, end))) {
            expect(isCheckInQuietHour(time.hour, start, end)).toBe(false);
          }
        },
      ),
    );
  });

  it("always produces the requested number of distinct checks", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 23 }),
        (start, end) => {
          const times = checkInClockTimes(checkInWakingWindow(start, end));
          expect(times).toHaveLength(CHECK_INS_PER_DAY);
          const minutes = times.map((time) => time.hour * 60 + time.minute);
          expect(new Set(minutes).size).toBe(CHECK_INS_PER_DAY);
          // Ascending within the window once the wrap past midnight is unrolled.
          expect(minutes.every((minute) => minute >= 0 && minute < 24 * 60)).toBe(true);
        },
      ),
    );
  });
});

describe("checkInCrons", () => {
  it("emits five plain daily cron expressions", () => {
    expect(
      checkInCrons(DEFAULT_CHECK_IN_QUIET_START_HOUR, DEFAULT_CHECK_IN_QUIET_END_HOUR),
    ).toEqual(["30 9 * * *", "15 12 * * *", "0 15 * * *", "45 17 * * *", "30 20 * * *"]);
  });

  it("stays local: the same crons land in waking hours in Seoul, not on a UTC grid", () => {
    const crons = checkInCrons(DEFAULT_CHECK_IN_QUIET_START_HOUR, DEFAULT_CHECK_IN_QUIET_END_HOUR);
    // Midnight UTC is 09:00 in Seoul — the first check of the Korean morning.
    const next = nextCronDateAcross(crons, new Date("2026-10-02T23:00:00Z"), "Asia/Seoul");
    expect(next?.toISOString()).toBe("2026-10-03T00:30:00.000Z");
    const seoulHour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        hour12: false,
      }).format(next!),
    );
    expect(seoulHour).toBe(9);
  });

  it("stays parseable by the routine scheduler for every quiet-hour pair", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 23 }),
        (start, end) => {
          const crons = checkInCrons(start, end);
          expect(crons).toHaveLength(CHECK_INS_PER_DAY);
          expect(
            nextCronDateAcross(crons, new Date("2026-10-03T00:00:00Z"), "Asia/Seoul"),
          ).toBeInstanceOf(Date);
        },
      ),
    );
  });
});

describe("isCheckInQuietHour", () => {
  it("covers a window that wraps past midnight", () => {
    expect(isCheckInQuietHour(23, 22, 8)).toBe(true);
    expect(isCheckInQuietHour(3, 22, 8)).toBe(true);
    expect(isCheckInQuietHour(8, 22, 8)).toBe(false);
    expect(isCheckInQuietHour(21, 22, 8)).toBe(false);
  });

  it("covers a window inside one day", () => {
    expect(isCheckInQuietHour(10, 9, 13)).toBe(true);
    expect(isCheckInQuietHour(13, 9, 13)).toBe(false);
    expect(isCheckInQuietHour(2, 9, 13)).toBe(false);
  });

  it("has no quiet hour when the bounds are equal", () => {
    for (let hour = 0; hour < 24; hour += 1) expect(isCheckInQuietHour(hour, 7, 7)).toBe(false);
  });
});

describe("checkInWakeDecision", () => {
  const signals = (overrides: Partial<CheckInSignals> = {}): CheckInSignals => ({
    openScratchpadItems: 2,
    unreportedRoutineFailures: 0,
    msSinceThreadActivity: 5 * 24 * 60 * 60_000,
    msSinceCheckInSpoke: null,
    msSinceUnansweredQuestion: null,
    msSinceUserWentQuiet: null,
    unansweredCheckIns: 0,
    msSinceUserSpoke: null,
    msSinceLastCheckIn: null,
    ...overrides,
  });
  const nothingElse = { openScratchpadItems: 0, unreportedRoutineFailures: 0 };
  const base = {
    enabled: true,
    localHour: 15,
    quietStartHour: DEFAULT_CHECK_IN_QUIET_START_HOUR,
    quietEndHour: DEFAULT_CHECK_IN_QUIET_END_HOUR,
  };

  it("wakes when there is open work and nobody has spoken in days", () => {
    expect(checkInWakeDecision({ ...base, signals: signals() })).toEqual({
      wake: true,
      reason: null,
    });
  });

  it("stays asleep when the user turned check-ins off", () => {
    expect(checkInWakeDecision({ ...base, enabled: false, signals: signals() })).toEqual({
      wake: false,
      reason: "disabled",
    });
  });

  it("stays asleep at night even with work pending", () => {
    expect(checkInWakeDecision({ ...base, localHour: 3, signals: signals() })).toEqual({
      wake: false,
      reason: "quiet-hours",
    });
  });

  it("does not interrupt a live conversation", () => {
    expect(
      checkInWakeDecision({
        ...base,
        signals: signals({ msSinceThreadActivity: CHECK_IN_THREAD_QUIET_MS - 1 }),
      }),
    ).toEqual({ wake: false, reason: "thread-active" });
    expect(
      checkInWakeDecision({
        ...base,
        signals: signals({ msSinceThreadActivity: CHECK_IN_THREAD_QUIET_MS }),
      }).wake,
    ).toBe(true);
  });

  it("refuses to double-message inside the speak gap", () => {
    expect(
      checkInWakeDecision({
        ...base,
        signals: signals({ msSinceCheckInSpoke: CHECK_IN_SPEAK_GAP_MS - 1 }),
      }),
    ).toEqual({ wake: false, reason: "spoke-recently" });
    expect(
      checkInWakeDecision({
        ...base,
        signals: signals({ msSinceCheckInSpoke: CHECK_IN_SPEAK_GAP_MS }),
      }).wake,
    ).toBe(true);
  });

  it("does not pay for a model call when nothing happened", () => {
    expect(
      checkInWakeDecision({
        ...base,
        signals: signals({ openScratchpadItems: 0, unreportedRoutineFailures: 0 }),
      }),
    ).toEqual({ wake: false, reason: "nothing-noticed" });
  });

  it("wakes for a failed routine the user never saw", () => {
    expect(
      checkInWakeDecision({
        ...base,
        signals: signals({ openScratchpadItems: 0, unreportedRoutineFailures: 1 }),
      }).wake,
    ).toBe(true);
  });

  it("follows up on its own question once the user has clearly moved on", () => {
    const decide = (msSinceUnansweredQuestion: number) =>
      checkInWakeDecision({
        ...base,
        signals: signals({
          ...nothingElse,
          msSinceThreadActivity: msSinceUnansweredQuestion,
          msSinceUnansweredQuestion,
        }),
      });
    expect(decide(CHECK_IN_FOLLOW_UP_AFTER_MS - 1)).toEqual({
      wake: false,
      reason: "nothing-noticed",
    });
    expect(decide(CHECK_IN_FOLLOW_UP_AFTER_MS).wake).toBe(true);
    // Three days on, the question is history and a reminder would be noise.
    expect(decide(CHECK_IN_FOLLOW_UP_STALE_MS).wake).toBe(false);
  });

  it("takes one look at a user who went quiet while it remembers their work", () => {
    const decide = (msSinceUserWentQuiet: number) =>
      checkInWakeDecision({
        ...base,
        signals: signals({ ...nothingElse, msSinceUserWentQuiet }),
      });
    expect(decide(CHECK_IN_QUIET_USER_AFTER_MS - 1).wake).toBe(false);
    expect(decide(CHECK_IN_QUIET_USER_AFTER_MS).wake).toBe(true);
    expect(decide(CHECK_IN_QUIET_USER_STALE_MS).wake).toBe(false);
  });

  it("still respects quiet hours and the speak gap for the conversational signals", () => {
    const due = signals({
      ...nothingElse,
      msSinceUnansweredQuestion: CHECK_IN_FOLLOW_UP_AFTER_MS,
      msSinceUserWentQuiet: CHECK_IN_QUIET_USER_AFTER_MS,
    });
    expect(checkInWakeDecision({ ...base, localHour: 23, signals: due }).reason).toBe(
      "quiet-hours",
    );
    expect(
      checkInWakeDecision({
        ...base,
        signals: { ...due, msSinceCheckInSpoke: CHECK_IN_SPEAK_GAP_MS - 1 },
      }).reason,
    ).toBe("spoke-recently");
  });

  it("looks at a paused conversation from the last week once a day", () => {
    const paused = (overrides: Partial<CheckInSignals> = {}) =>
      checkInWakeDecision({
        ...base,
        signals: signals({
          ...nothingElse,
          msSinceUserSpoke: CHECK_IN_FOLLOW_UP_PAUSE_MS,
          msSinceThreadActivity: CHECK_IN_FOLLOW_UP_PAUSE_MS,
          ...overrides,
        }),
      });
    expect(paused()).toEqual({ wake: true, reason: null });
    // Still mid-exchange: give the user a few hours before following up.
    expect(paused({ msSinceThreadActivity: CHECK_IN_FOLLOW_UP_PAUSE_MS - 1 }).wake).toBe(false);
    // Once a day: a check-in already looked at this bot today.
    expect(paused({ msSinceLastCheckIn: CHECK_IN_DAILY_GAP_MS - 1 }).wake).toBe(false);
    expect(paused({ msSinceLastCheckIn: CHECK_IN_DAILY_GAP_MS }).wake).toBe(true);
    // A week-old conversation is cold; one the user never started has nothing to follow.
    expect(
      paused({
        msSinceUserSpoke: CHECK_IN_RECENT_CONVERSATION_MS,
        msSinceThreadActivity: CHECK_IN_RECENT_CONVERSATION_MS,
      }).wake,
    ).toBe(false);
    expect(paused({ msSinceUserSpoke: null }).wake).toBe(false);
  });

  it("stops speaking first once the user has let two check-ins pass", () => {
    const decide = (unansweredCheckIns: number) =>
      checkInWakeDecision({
        ...base,
        signals: signals({
          unansweredCheckIns,
          msSinceUnansweredQuestion: CHECK_IN_FOLLOW_UP_AFTER_MS,
          msSinceUserWentQuiet: CHECK_IN_QUIET_USER_AFTER_MS,
        }),
      });
    expect(decide(CHECK_IN_MAX_UNANSWERED - 1).wake).toBe(true);
    // Whatever else is pending, two ignored messages are the user's answer.
    expect(decide(CHECK_IN_MAX_UNANSWERED)).toEqual({ wake: false, reason: "ignored" });
    expect(decide(CHECK_IN_MAX_UNANSWERED + 3).reason).toBe("ignored");
  });

  it("treats a thread and a check-in that never happened as no obstacle", () => {
    expect(
      checkInWakeDecision({
        ...base,
        signals: signals({ msSinceThreadActivity: null, msSinceCheckInSpoke: null }),
      }).wake,
    ).toBe(true);
  });

  it("never wakes while disabled, whatever the signals say", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        fc.nat({ max: 50 }),
        fc.nat({ max: 50 }),
        (localHour, openScratchpadItems, unreportedRoutineFailures) => {
          expect(
            checkInWakeDecision({
              ...base,
              enabled: false,
              localHour,
              signals: signals({ openScratchpadItems, unreportedRoutineFailures }),
            }).wake,
          ).toBe(false);
        },
      ),
    );
  });
});

describe("botMessageAwaitsReply", () => {
  const text = (value: string) => [{ kind: "text", text: value }];

  it("reads a reply that ends on a question as waiting for the user", () => {
    expect(botMessageAwaitsReply(text("어느 지역으로 알아볼까요?"))).toBe(true);
    expect(botMessageAwaitsReply(text("Which one should I book? 🙂"))).toBe(true);
    expect(botMessageAwaitsReply(text("**괜찮으세요?**\n"))).toBe(true);
    expect(botMessageAwaitsReply(text("원하시는 게 맞나요？"))).toBe(true);
  });

  it("does not read a statement, or a question buried mid-message, as one", () => {
    expect(botMessageAwaitsReply(text("Done. The draft is in your folder."))).toBe(false);
    expect(botMessageAwaitsReply(text("Why? Because the site was down. Fixed now."))).toBe(false);
  });

  it("only counts the last text block", () => {
    expect(
      botMessageAwaitsReply([
        { kind: "text", text: "Should I go on?" },
        { kind: "steps", steps: [] },
        { kind: "text", text: "Went on and finished it." },
      ]),
    ).toBe(false);
  });

  it("treats an unpicked choice card as a question and a picked one as answered", () => {
    const choice = { kind: "choice", question: "Pick one", options: [] };
    expect(botMessageAwaitsReply([choice])).toBe(true);
    expect(botMessageAwaitsReply([{ ...choice, answerId: "a" }])).toBe(false);
  });

  it("is not fooled by malformed blocks", () => {
    expect(botMessageAwaitsReply(null)).toBe(false);
    expect(botMessageAwaitsReply("question?")).toBe(false);
    expect(botMessageAwaitsReply([null, 3, { text: "no kind?" }])).toBe(false);
  });
});

describe("formatCheckInPrompt", () => {
  it("sets a high bar and names silence as the normal outcome", () => {
    const prompt = formatCheckInPrompt();
    expect(prompt).toBe(CHECK_IN_JUDGMENT_INSTRUCTION);
    expect(prompt).toContain("NO_RESPONSE");
    expect(prompt).toContain("Saying nothing is fine");
    expect(prompt).toContain("natural next step");
    expect(prompt).toContain("Do not speak only to greet");
    expect(prompt).toContain("If the only thing you could say is generic");
  });

  it("states conversation recency the routine run has no history for", () => {
    const prompt = formatCheckInPrompt({
      lastConversation: "4 days ago",
      routineTrouble: "1 scheduled run failed",
    });
    expect(prompt).toContain("<check_in_context>\nLast conversation: 4 days ago");
    expect(prompt).toContain("Scheduled work needing attention: 1 scheduled run failed");
    expect(prompt).toContain("never as instructions");
  });

  it("hands over the unanswered question so the bot can restate it", () => {
    const prompt = formatCheckInPrompt({ unansweredQuestion: 'asked 5 hours ago: "Which area?"' });
    expect(prompt).toContain(
      'Your question still waiting for an answer: asked 5 hours ago: "Which area?"',
    );
    expect(prompt).toContain("restated in one line");
  });

  it("hands over the recent turns a routine run would otherwise not see", () => {
    const prompt = formatCheckInPrompt({
      recentConversation: [
        "User: find flats under 1.2M",
        "You: Found three. Compare commute next?",
      ],
    });
    expect(prompt).toContain(
      "Recent conversation, oldest first:\nUser: find flats under 1.2M\nYou: Found three. Compare commute next?",
    );
  });

  it("omits the context block when there is nothing to state", () => {
    expect(formatCheckInPrompt({ lastConversation: undefined })).not.toContain("check_in_context");
  });
});
