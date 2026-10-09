/**
 * The timing of the opening sequence.
 *
 * An intro is a piece of rhythm, and rhythm is the first thing to rot: a delay nudged
 * here, a duration there, and the beats drift until the wordmark lands before the mark it
 * belongs to. Keeping the whole score in one table means a change is visible as a change,
 * and the tests below hold the order and the length to what was designed.
 */

/** One element's entrance: when it starts and how long it takes, in milliseconds. */
export interface IntroBeat {
  at: number;
  lasts: number;
}

export const INTRO_SCORE = {
  /** A ring of light leaves first, before there is anything to see. */
  ring: { at: 0, lasts: 900 },
  /** The mark arrives into the space the ring opened. */
  mark: { at: 120, lasts: 620 },
  /** It wakes up: eyes, cheeks, a grin. */
  face: { at: 620, lasts: 320 },
  /** The motion lines it is always drawn with, flying up from below. */
  sparks: { at: 700, lasts: 520 },
  /** The name, last, once there is something to name. */
  word: { at: 920, lasts: 460 },
  /** The way out, offered only after the sequence has had its moment. */
  hint: { at: 1_560, lasts: 420 },
} satisfies Record<string, IntroBeat>;

export type IntroElement = keyof typeof INTRO_SCORE;

/** The order the elements are meant to arrive in. */
export const INTRO_ORDER: IntroElement[] = ["ring", "mark", "face", "sparks", "word", "hint"];

/** How long the whole sequence takes, including the last thing to finish. */
export function introRunsForMs(score: Record<IntroElement, IntroBeat> = INTRO_SCORE): number {
  return Math.max(...INTRO_ORDER.map((element) => score[element].at + score[element].lasts));
}

/**
 * Whether to play the intro at all.
 *
 * A notification is a destination: someone who tapped one is on their way to a message,
 * and an opening sequence between them and it is in the way, however good it is.
 */
export function playsIntro(input: { openedFromNotification: boolean }): boolean {
  return !input.openedFromNotification;
}

/**
 * How long to keep covering the page after the intro is dismissed.
 *
 * The page underneath may not have painted yet, and what shows through before it does is
 * the loading screen of the project this app is forked from. The cover waits for the word
 * that it has painted, and gives up at the ceiling so a silent page cannot strand anyone
 * behind a blank screen.
 */
export const COVER_CEILING_MS = 6_000;

export function coverHoldMs(input: { heldForMs: number; pagePainted: boolean }): number {
  if (input.pagePainted) return 0;
  return Math.max(0, COVER_CEILING_MS - input.heldForMs);
}
