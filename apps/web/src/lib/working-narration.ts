/**
 * What to say while a turn is starting and the bot has not spoken yet.
 *
 * The model's own first sentence only arrives after its first turn, and a single frozen
 * label ("Thinking…") for that long reads as a stuck bot. So the line moves through the
 * work every turn really does in order: the request is read, an approach is chosen, what
 * is needed is gathered, the answer is assembled.
 *
 * None of these lines names a tool, and that is deliberate. An earlier version said "this
 * needs something from the web" and "taking over the browser" during the wait; most turns
 * never open a browser at all, so those lines were claiming work that never happened.
 * The browser is mentioned only once its boot is a fact the shell can see.
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
  { id: "planning", text: "Working out how to answer this…" },
  { id: "gathering", text: "Gathering what I need…" },
  { id: "assembling", text: "Putting the answer together…" },
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
