/**
 * The timing of the opening sequence, and the sky it happens in.
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
  /** The star field, there before anything happens in front of it. */
  sky: { at: 0, lasts: 600 },
  /** The gas clouds behind the stars, warming the black. */
  gas: { at: 80, lasts: 620 },
  /** A comet crosses from the upper right and does not stop until it is the mark. */
  comet: { at: 120, lasts: 820 },
  /** The moment it lands, which is the moment everything else starts from. */
  flash: { at: 900, lasts: 420 },
  /** The shock of that landing, leaving outward. */
  ring: { at: 920, lasts: 900 },
  /** The mark, out of the flash. */
  mark: { at: 940, lasts: 620 },
  /** It wakes up: eyes, cheeks, a grin. */
  face: { at: 1_500, lasts: 360 },
  /** The motion lines it is always drawn with, flying up from below. */
  sparks: { at: 1_680, lasts: 480 },
  /** The name, last, once there is something to name. */
  word: { at: 1_900, lasts: 440 },
  /** The way out, offered only after the sequence has had its moment. */
  hint: { at: 2_340, lasts: 420 },
} satisfies Record<string, IntroBeat>;

export type IntroElement = keyof typeof INTRO_SCORE;

/** The order the elements are meant to arrive in. */
export const INTRO_ORDER: IntroElement[] = [
  "sky",
  "gas",
  "comet",
  "flash",
  "ring",
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

/**
 * The sky.
 *
 * Everything below is drawn in one box and scaled to whatever phone it lands on, so a
 * star keeps its place in the picture rather than its distance from a corner. The box is
 * a little larger than a tall phone because the whole field drifts, and a field that
 * drifts needs somewhere to drift from.
 */
export const INTRO_SKY_BOX = { width: 418, height: 864 };

/** How far the field wanders, and how long one round trip takes. */
export const INTRO_DRIFT = { px: 9, ms: 26_000 };

/** One star: where it sits in the box, and how big. */
export interface IntroStar {
  x: number;
  y: number;
  r: number;
}

/**
 * The faint field, placed by hand rather than scattered at random — a random sky has to
 * be re-rolled until it looks deliberate, and it would be a different sky on every
 * launch. This one is the same sky every time, which is what makes it the app's sky.
 */
export const INTRO_FAINT_STARS: IntroStar[] = [
  { x: 23, y: 47, r: 0.7 },
  { x: 86, y: 22, r: 0.6 },
  { x: 142, y: 63, r: 0.8 },
  { x: 203, y: 31, r: 0.6 },
  { x: 268, y: 78, r: 0.7 },
  { x: 331, y: 40, r: 0.6 },
  { x: 392, y: 96, r: 0.8 },
  { x: 57, y: 128, r: 0.6 },
  { x: 118, y: 166, r: 0.7 },
  { x: 176, y: 121, r: 0.6 },
  { x: 246, y: 153, r: 0.8 },
  { x: 312, y: 188, r: 0.6 },
  { x: 371, y: 142, r: 0.7 },
  { x: 34, y: 214, r: 0.6 },
  { x: 97, y: 252, r: 0.8 },
  { x: 158, y: 226, r: 0.6 },
  { x: 231, y: 268, r: 0.7 },
  { x: 296, y: 231, r: 0.6 },
  { x: 358, y: 276, r: 0.8 },
  { x: 19, y: 318, r: 0.7 },
  { x: 83, y: 356, r: 0.6 },
  { x: 144, y: 392, r: 0.8 },
  { x: 214, y: 341, r: 0.6 },
  { x: 281, y: 383, r: 0.7 },
  { x: 347, y: 347, r: 0.6 },
  { x: 402, y: 404, r: 0.8 },
  { x: 46, y: 438, r: 0.6 },
  { x: 109, y: 471, r: 0.7 },
  { x: 171, y: 446, r: 0.6 },
  { x: 238, y: 489, r: 0.8 },
  { x: 303, y: 452, r: 0.6 },
  { x: 366, y: 496, r: 0.7 },
  { x: 27, y: 538, r: 0.6 },
  { x: 91, y: 572, r: 0.8 },
  { x: 153, y: 546, r: 0.6 },
  { x: 221, y: 588, r: 0.7 },
  { x: 288, y: 552, r: 0.6 },
  { x: 351, y: 596, r: 0.8 },
  { x: 38, y: 642, r: 0.7 },
  { x: 102, y: 676, r: 0.6 },
  { x: 164, y: 648, r: 0.8 },
  { x: 232, y: 692, r: 0.6 },
  { x: 297, y: 656, r: 0.7 },
  { x: 361, y: 701, r: 0.6 },
  { x: 52, y: 746, r: 0.8 },
  { x: 116, y: 782, r: 0.6 },
  { x: 178, y: 752, r: 0.7 },
  { x: 244, y: 796, r: 0.6 },
  { x: 309, y: 761, r: 0.8 },
  { x: 374, y: 806, r: 0.6 },
  { x: 137, y: 836, r: 0.7 },
];

/** The nearer stars, bright enough to be noticed one at a time. */
export const INTRO_MID_STARS: IntroStar[] = [
  { x: 188, y: 58, r: 1.1 },
  { x: 41, y: 176, r: 1 },
  { x: 340, y: 232, r: 1.1 },
  { x: 262, y: 316, r: 1 },
  { x: 326, y: 424, r: 1.1 },
  { x: 252, y: 534, r: 1 },
  { x: 334, y: 648, r: 1.1 },
  { x: 268, y: 742, r: 1 },
  { x: 382, y: 556, r: 1.1 },
];

/**
 * Stars that breathe, in three groups on three clocks. Three is the point: one clock is
 * a pulse, and a whole sky keeping it reads as a fault rather than as distance. Each
 * group carries its own clock so the two can never be paired up wrong.
 */
export interface IntroTwinkle {
  /** How long one breath takes, in milliseconds. */
  ms: number;
  stars: IntroStar[];
}

export const INTRO_TWINKLE: IntroTwinkle[] = [
  {
    ms: 3_100,
    stars: [
      { x: 64, y: 88, r: 1.2 },
      { x: 78, y: 296, r: 1.3 },
      { x: 148, y: 614, r: 1.2 },
    ],
  },
  {
    ms: 4_300,
    stars: [
      { x: 296, y: 118, r: 1.3 },
      { x: 126, y: 412, r: 1.2 },
      { x: 72, y: 714, r: 1.3 },
    ],
  },
  {
    ms: 2_600,
    stars: [
      { x: 212, y: 198, r: 1.2 },
      { x: 58, y: 506, r: 1.3 },
      { x: 196, y: 806, r: 1.2 },
    ],
  },
];

/** How far down a breath takes a star. */
export const INTRO_TWINKLE_FLOOR = 0.35;

/**
 * The few stars drawn with the cross a lens puts on a bright one. This is the whole
 * trick: a field of dots reads as dots, and the same field with three crosses in it
 * reads as a photograph of the sky.
 */
export interface IntroSpike extends IntroStar {
  /** Half the length of each arm of the cross. */
  arm: number;
  color: string;
  /** Which of the three clocks it keeps. */
  clock: number;
}

export const INTRO_SPIKE_STARS: IntroSpike[] = [
  { x: 104, y: 146, r: 1.9, arm: 10, color: "#FFFFFF", clock: 0 },
  { x: 318, y: 352, r: 2.1, arm: 12, color: "#FFE9C9", clock: 2 },
  { x: 92, y: 618, r: 1.8, arm: 10, color: "#FFFFFF", clock: 1 },
];

/** A cloud of gas: where it is centred in the box, how far it reaches, and its colour. */
export interface IntroCloud {
  cx: string;
  cy: string;
  r: string;
  color: string;
  /** How solid it is at the centre, and at the stop where it starts to go. */
  core: number;
  mid: number;
  midAt: string;
}

export const INTRO_NEBULA: IntroCloud[] = [
  { cx: "30%", cy: "22%", r: "46%", color: "#6B3FA0", core: 0.3, mid: 0.12, midAt: "0.55" },
  { cx: "78%", cy: "58%", r: "44%", color: "#1C6E7E", core: 0.26, mid: 0.1, midAt: "0.6" },
  { cx: "18%", cy: "82%", r: "42%", color: "#8E2F5E", core: 0.2, mid: 0.02, midAt: "0.7" },
];

/**
 * The dark lane across the clouds. Gas without a lane through it reads as a smudge on
 * the glass; the lane is what makes it a thing at a distance.
 */
export const INTRO_DUST_LANE = { cx: 209, cy: 470, rx: 330, ry: 78, turn: -34 };

/** How much brighter the gas goes in the instant the comet lands on it. */
export const INTRO_GAS_FLARE = 1.5;

/**
 * The comet's journey, in the box's own pixels: where it starts relative to where it
 * lands, how long its tail is, and the angle the tail lies back at.
 */
export const INTRO_COMET = { fromX: 265, fromY: -325, tail: 182, turn: -50.9 };

/**
 * What the sequence actually covers, as fractions of the screen: the 168pt mark, the
 * sparks under it and the name under those, stacked and centred. Measured from those
 * sizes rather than guessed, so a star just outside it really is beside the mascot and
 * not behind it.
 */
export const INTRO_STAGE = { left: 0.3, right: 0.7, top: 0.35, bottom: 0.65 };

/**
 * Whether a star sits clear of the centre the sequence plays in. A faint point behind
 * the mark is depth and nobody sees it; a cross-flared one behind the mark is a smudge
 * on the mascot's face, so those are the ones held to this.
 */
export function clearsTheStage(star: { x: number; y: number }, stage = INTRO_STAGE): boolean {
  const x = star.x / INTRO_SKY_BOX.width;
  const y = star.y / INTRO_SKY_BOX.height;
  return x < stage.left || x > stage.right || y < stage.top || y > stage.bottom;
}

/** A piece of the comet, thrown clear on impact and left where it comes to rest. */
export interface IntroDebris {
  dx: number;
  dy: number;
  size: number;
  delayMs: number;
}

export const INTRO_DEBRIS: IntroDebris[] = [
  { dx: -96, dy: -168, size: 7, delayMs: 0 },
  { dx: 128, dy: -112, size: 5, delayMs: 50 },
  { dx: -142, dy: 92, size: 6, delayMs: 100 },
  { dx: 150, dy: 196, size: 5, delayMs: 80 },
  { dx: -58, dy: 268, size: 4, delayMs: 140 },
  { dx: 96, dy: 312, size: 6, delayMs: 120 },
];

/** How long a thrown piece takes to come to rest, and how bright it is left. */
export const INTRO_DEBRIS_MS = 1_400;
export const INTRO_DEBRIS_REST = 0.3;
