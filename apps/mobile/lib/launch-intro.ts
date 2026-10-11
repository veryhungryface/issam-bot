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
  /** The sky the sequence happens in: stars, there before anything arrives. */
  field: { at: 0, lasts: 1_400 },
  /** A ring of light leaves first, before there is anything to see. */
  ring: { at: 0, lasts: 900 },
  /** Warmth gathering where the mark is about to land. */
  glow: { at: 120, lasts: 900 },
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
export const INTRO_ORDER: IntroElement[] = [
  "field",
  "ring",
  "glow",
  "mark",
  "face",
  "sparks",
  "word",
  "hint",
];

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

/** One star in the field: where it sits, how big, how faint, how it is turned. */
export interface IntroStar {
  /** Fractions of the screen, from the top left. */
  x: number;
  y: number;
  /** Points across, in density-independent pixels. */
  size: number;
  /** The brightest this one ever gets. */
  dim: number;
  /** Degrees, so no two sit at the same angle and read as a pattern. */
  turn: number;
}

/**
 * The centre the sequence plays in, as fractions of the screen. Nothing in the field may
 * sit inside it: the mark, its face, the sparks and the name all land here, and a star
 * behind them is not depth, it is dirt on the lens.
 */
export const INTRO_STAGE = { left: 0.2, right: 0.8, top: 0.28, bottom: 0.72 };

/**
 * Placed by hand rather than scattered at random. A random field has to be re-rolled
 * until it looks deliberate, and it would look different on every launch — this one is
 * the same sky every time, which is what makes it the app's sky rather than noise.
 */
export const INTRO_FIELD: IntroStar[] = [
  { x: 0.13, y: 0.14, size: 18, dim: 0.34, turn: 12 },
  { x: 0.78, y: 0.1, size: 13, dim: 0.24, turn: -18 },
  { x: 0.9, y: 0.22, size: 21, dim: 0.3, turn: 26 },
  { x: 0.07, y: 0.37, size: 12, dim: 0.2, turn: -9 },
  { x: 0.88, y: 0.46, size: 15, dim: 0.26, turn: 33 },
  { x: 0.1, y: 0.63, size: 17, dim: 0.23, turn: -24 },
  { x: 0.84, y: 0.74, size: 19, dim: 0.31, turn: 7 },
  { x: 0.24, y: 0.84, size: 14, dim: 0.21, turn: -31 },
  // Clear of the line the hint sits on, which is the one piece of text down here.
  { x: 0.7, y: 0.8, size: 11, dim: 0.18, turn: 19 },
];

/** Whether a star sits clear of the centre the sequence plays in. */
export function clearsTheStage(star: IntroStar, stage = INTRO_STAGE): boolean {
  return star.x < stage.left || star.x > stage.right || star.y < stage.top || star.y > stage.bottom;
}

/**
 * Where the light gathers, as fractions of the screen. The mark lands at the same point,
 * so the glow reads as light coming off it rather than as a shape of its own.
 */
export const INTRO_LIGHT = { x: 0.5, y: 0.42 };

/** The two rings the mark rests inside, in points. Faint: they are depth, not drawing. */
export const INTRO_HALOS = [
  { radius: 128, dim: 0.16 },
  { radius: 176, dim: 0.08 },
];
