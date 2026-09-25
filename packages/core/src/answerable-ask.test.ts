import { describe, expect, it } from "vitest";
import { latestAnswerableAskMessageId, selectedAskActionLabel } from "./answerable-ask.js";

describe("latestAnswerableAskMessageId", () => {
  it("finds a waiting prompt even when a newer group run is active", () => {
    expect(
      latestAnswerableAskMessageId({
        run: { id: "run-newer", status: "running" },
        activeRuns: [
          { id: "run-newer", status: "running" },
          { id: "run-waiting", status: "waiting_input" },
        ],
        messages: [
          {
            id: "ask-1",
            runId: "run-waiting",
            blocks: [{ kind: "ask", status: "pending" }],
          },
        ],
      }),
    ).toBe("ask-1");
  });

  it("enables the sign-in sheet, which is not an ask block", () => {
    // Shipped disabled: the card rendered, said "action needed", and accepted nothing.
    expect(
      latestAnswerableAskMessageId({
        run: { id: "run-1", status: "waiting_input" },
        messages: [
          {
            id: "login-1",
            runId: "run-1",
            blocks: [{ kind: "browser_login", status: "pending" }],
          },
        ],
      }),
    ).toBe("login-1");
  });

  it("leaves a resolved sign-in sheet alone", () => {
    for (const status of ["filled", "cancelled"]) {
      expect(
        latestAnswerableAskMessageId({
          run: { id: "run-1", status: "waiting_input" },
          messages: [
            { id: "login-1", runId: "run-1", blocks: [{ kind: "browser_login", status }] },
          ],
        }),
      ).toBeNull();
    }
  });

  it("ignores answered prompts and prompts from non-waiting runs", () => {
    expect(
      latestAnswerableAskMessageId({
        run: { id: "run-1", status: "running" },
        messages: [{ id: "ask-1", runId: "run-1", blocks: [{ kind: "ask", status: "pending" }] }],
      }),
    ).toBeNull();
    expect(
      latestAnswerableAskMessageId({
        run: { id: "run-1", status: "waiting_input" },
        messages: [{ id: "ask-1", runId: "run-1", blocks: [{ kind: "ask", status: "answered" }] }],
      }),
    ).toBeNull();
  });
});

describe("selectedAskActionLabel", () => {
  it("maps a choice answer id to its user-facing label", () => {
    expect(
      selectedAskActionLabel("choice-2", [
        { id: "choice-1", label: "Berlin" },
        { id: "choice-2", label: "Seoul" },
      ]),
    ).toBe("Seoul");
  });

  it("falls back to the answer when an action is unavailable", () => {
    expect(selectedAskActionLabel("custom", undefined)).toBe("custom");
  });
});
