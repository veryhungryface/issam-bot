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

/** A drag counts as the drawer's only once it is clearly sideways — below this it could
 * still become a scroll, and stealing it would make lists feel sticky. */
export const DRAG_AXIS_SLOP_PX = 10;

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
 */
export function dragAxis(dx: number, dy: number, slop: number = DRAG_AXIS_SLOP_PX): DragAxis {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return "undecided";
  return Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical";
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
 * How far the drawer has come out of the edge, in CSS pixels, signed for the layout
 * direction. This is also how far the content behind it has been pushed: a drawer that
 * slides over a page that did not notice reads as a sheet, not as a phone app.
 */
export function drawerTravelPx(input: DrawerPlacement): number {
  return clamp(input.progress, 0, 1) * input.width * openingSign(input.edge, input.rtl);
}

/**
 * How far to shift the drawer from its resting open position, in CSS pixels.
 *
 * The drawer's own stylesheet already places it open or closed; this is the offset that
 * makes it follow the finger in between, so it is always "how far out it is, less the
 * whole width it has when open".
 */
export function drawerOffsetPx(input: DrawerPlacement): number {
  return drawerTravelPx(input) - input.width * openingSign(input.edge, input.rtl);
}
