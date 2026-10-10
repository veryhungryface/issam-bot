/**
 * The arithmetic behind a drawer that follows the thumb.
 *
 * On a phone a panel that only closes through a button reads as a web page. A native
 * drawer tracks the finger, settles where the finger was heading, and gives up as soon
 * as the gesture turns out to be a scroll. All of those are decisions about numbers, so
 * they live here rather than inside a pointer handler, where they would be untestable.
 *
 * "Opening" is a direction, not a side: a drawer anchored to the start edge opens to the
 * right in a left-to-right layout and to the left in a right-to-left one, and one anchored
 * to the end edge does the opposite. Every function below takes that pair and works out
 * the sign itself, so no caller has to repeat the four-way reasoning.
 */

/** Which edge of the viewport the drawer is anchored to, in writing-direction terms. */
export type DrawerEdge = "start" | "end";

/** A drag counts as the drawer's only once it has travelled this far — below this it could
 * still become a scroll, and stealing it would make lists feel sticky. */
export const DRAG_AXIS_SLOP_PX = 10;

/** How much steeper than sideways a drag has to be before the drawer hands it back as a
 * scroll. Between the two answers the drag is neither: see `dragAxis`. */
export const VERTICAL_DOMINANCE = 2;

/** How close to the viewport edge a drag must begin to pull a closed drawer out. Matches
 * the system back-gesture zone closely enough to feel familiar without fighting it. */
export const EDGE_ZONE_PX = 24;

/** Past this share of the drawer's width, letting go finishes the move. */
export const SETTLE_AT = 0.5;

/** A flick settles in its own direction however short it was, in pixels per millisecond. */
export const FLICK_VELOCITY_PX_PER_MS = 0.5;

export type DragAxis = "horizontal" | "vertical" | "undecided";

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Which way a drag is going, once it has moved far enough to tell.
 *
 * "undecided" is not a failure: it is the state where the gesture still belongs to
 * whatever was under the finger, and the drawer must not claim it yet.
 *
 * A thumb does not travel in a straight line. It leaves the edge of the screen on an arc,
 * so the first movement of an ordinary drawer swipe is often as far up or down as it is
 * sideways. Answering "vertical" there — and a drag answered once is answered for good —
 * is what made the drawer ignore every swipe that was not dead level. So the two answers
 * no longer share one boundary: sideways travel that matches the vertical claims the
 * gesture, vertical travel twice the sideways hands it back, and in between the drag stays
 * open and keeps watching, which costs nothing because it has claimed nothing.
 */
export function dragAxis(dx: number, dy: number, slop: number = DRAG_AXIS_SLOP_PX): DragAxis {
  const across = Math.abs(dx);
  const down = Math.abs(dy);
  if (across >= slop && across >= down) return "horizontal";
  if (down >= slop && down >= across * VERTICAL_DOMINANCE) return "vertical";
  return "undecided";
}

/** +1 when opening the drawer moves the pointer right, -1 when it moves left. */
export function openingSign(edge: DrawerEdge, rtl: boolean): 1 | -1 {
  const opensRight = edge === "start" ? !rtl : rtl;
  return opensRight ? 1 : -1;
}

/** Horizontal movement expressed as progress towards open, whichever side the drawer is on. */
export function openingDistance(dx: number, edge: DrawerEdge, rtl: boolean): number {
  return dx * openingSign(edge, rtl);
}

/** True when a drag beginning at this x is close enough to the drawer's edge to open it. */
export function startsAtEdge(input: {
  x: number;
  viewportWidth: number;
  edge: DrawerEdge;
  rtl: boolean;
  zone?: number;
}): boolean {
  const zone = input.zone ?? EDGE_ZONE_PX;
  return openingSign(input.edge, input.rtl) === 1
    ? input.x <= zone
    : input.x >= input.viewportWidth - zone;
}

/** Where the drawer sits for a drag this far along: 0 fully closed, 1 fully open. */
export function drawerProgress(input: {
  openAtStart: boolean;
  dx: number;
  width: number;
  edge: DrawerEdge;
  rtl: boolean;
}): number {
  const from = input.openAtStart ? 1 : 0;
  if (input.width <= 0) return from;
  const moved = openingDistance(input.dx, input.edge, input.rtl) / input.width;
  return clamp(from + moved, 0, 1);
}

/**
 * Whether letting go here leaves the drawer open.
 *
 * A flick wins over position, so a short sharp swipe closes a drawer the finger barely
 * moved — that is the gesture people actually make. Otherwise the drawer goes wherever
 * it is already more than half way towards.
 */
export function settlesOpen(input: {
  progress: number;
  /** Pixels per millisecond towards open; negative means towards closed. */
  velocity: number;
  flick?: number;
}): boolean {
  const flick = input.flick ?? FLICK_VELOCITY_PX_PER_MS;
  if (input.velocity >= flick) return true;
  if (input.velocity <= -flick) return false;
  return input.progress >= SETTLE_AT;
}

export interface DrawerPlacement {
  progress: number;
  width: number;
  edge: DrawerEdge;
  rtl: boolean;
}

/**
 * How far to shift the drawer from its resting open position, in CSS pixels.
 *
 * The drawer's own stylesheet already places it open or closed; this is the offset that
 * makes it follow the finger in between, so it is always "open position, less the part
 * still outside the screen". The conversation behind it does not move: the drawer passes
 * over it.
 */
export function drawerOffsetPx(input: DrawerPlacement): number {
  return (clamp(input.progress, 0, 1) - 1) * input.width * openingSign(input.edge, input.rtl);
}
