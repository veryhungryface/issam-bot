/**
 * How long the launch animation stays on screen.
 *
 * The system splash hands over the moment React mounts, long before the web app has
 * anything to show, and what showed through in that gap was the loading screen of the
 * project this one is forked from. The shell covers the gap with its own character, and
 * the only question left is when to take it away.
 *
 * Three rules, and they are only arithmetic, so they live here rather than inside a
 * component where a timer would be the only way to see them.
 */

/** Below this the animation is a flicker, not a greeting, so it is never cut shorter. */
export const SPLASH_MIN_MS = 700;

/** A page that never reports in must not leave the app stuck behind a picture. */
export const SPLASH_MAX_MS = 6_000;

/**
 * How much longer to hold the splash, in milliseconds.
 *
 * A page that is ready still gets the minimum; one that is not gets until the ceiling,
 * which the next call shortens as the clock runs down. Both are clamped at zero, so a
 * caller can always treat the answer as a timeout to set.
 */
export function splashHoldMs(input: { shownForMs: number; pageReady: boolean }): number {
  const until = input.pageReady ? SPLASH_MIN_MS : SPLASH_MAX_MS;
  return Math.max(0, until - input.shownForMs);
}
