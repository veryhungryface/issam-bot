/**
 * What to say while a turn is starting and the bot has not spoken yet.
 *
 * A cold browser takes seven to nine seconds to exist, and the model's own first sentence
 * only arrives after its first turn. A single frozen label ("Thinking…") for that long reads
 * as a stuck bot, so the line moves through the work that is actually happening in order:
 * the request is read, then the web is the place to look, then the browser is taken over,
 * then it is coming up. Each line is true of the phase it belongs to - none of them claims
 * progress the run has not made.
 *
 * Once real tool activity starts, the step list takes over and this stops.
 */
export type WorkingNarrationInput = {
  /** Milliseconds since this turn started working. */
  elapsedMs: number;
  /** Provider state of the bot's computer, when the shell knows it. */
  computerState?: "stopped" | "booting" | "running" | "suspended" | "error";
  /** True once the run has done something with a tool; the step list speaks from then on. */
  hasToolActivity?: boolean;
};

export type WorkingNarrationLine = {
  /** Stable id so the UI can animate a change rather than re-render identical text. */
  id: string;
  /** English source string; the caller translates it. */
  text: string;
};

const OPENING: WorkingNarrationLine[] = [
  { id: "reading", text: "Reading your request…" },
  { id: "planning", text: "Working out how to find this…" },
  { id: "web", text: "This needs something from the web…" },
  { id: "control", text: "Taking over the browser…" },
];

/** Roughly how long each opening line holds before the next one. */
export const NARRATION_STEP_MS = 2_400;

export function workingNarration(input: WorkingNarrationInput): WorkingNarrationLine | undefined {
  if (input.hasToolActivity) return undefined;
  // A booting computer is a fact, not a guess: say that and stop rotating.
  if (input.computerState === "booting") {
    return { id: "booting", text: "Getting the browser ready…" };
  }
  const step = Math.floor(Math.max(0, input.elapsedMs) / NARRATION_STEP_MS);
  return OPENING[Math.min(step, OPENING.length - 1)];
}
