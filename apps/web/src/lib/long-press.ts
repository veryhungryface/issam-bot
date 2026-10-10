import {
  type DOMAttributes,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from "react";

/**
 * A press held still long enough to mean "show me what I can do with this".
 *
 * A phone has no right button, so the menus a desktop opens with one — everything a bot in
 * the list can do, everything that can be done with a message — had no way in at all. The
 * `contextmenu` event is not the answer either: Safari never sends it, it raises its own
 * callout over the page instead, so the app has to decide for itself when a press has
 * become a hold. Only a finger does: a mouse already has its own button for this.
 *
 * One hook serves a whole list. It is attached to the scroller and reads what is under the
 * finger when the hold completes, so a list of rows does not become a list of hooks.
 */

export const LONG_PRESS_MS = 450;

/** A finger that travels this far is scrolling or dragging, and the hold is off. */
export const LONG_PRESS_SLOP_PX = 10;

/**
 * How long the click a completed hold leaves behind still belongs to it. Generous: it only
 * has to outlive the gap between the finger lifting and the click, and the alternative — a
 * flag that never expires — would swallow somebody's next real tap.
 */
export const PRESS_ECHO_MS = 1200;

export interface PressPoint {
  x: number;
  y: number;
}

/** Controls whose own press already means something; a hold on one of those is theirs. */
const OWN_PRESS =
  'a, button, input, textarea, select, summary, [role="button"], [contenteditable=""], [contenteditable="true"]';

/**
 * Whether a hold here is the menu's to take. Pass as `claims` where a surface carries
 * controls of its own — a message with an approval button or a link in it — and leave it
 * out where the surface is the control, as a row in a list is.
 */
export function heldOnPlainContent(target: Pick<Element, "closest">): boolean {
  return !target.closest(OWN_PRESS);
}

/** Whether the finger has stayed close enough to the spot it went down on. */
export function heldStill(dx: number, dy: number, slop: number = LONG_PRESS_SLOP_PX): boolean {
  return Math.abs(dx) < slop && Math.abs(dy) < slop;
}

export interface LongPressOptions {
  /** Where the finger is and what is under it, once the hold completes. */
  onLongPress: (point: PressPoint, target: Element) => void;
  /** Which presses are the menu's; everything, unless this says otherwise. */
  claims?: (target: Element) => boolean;
  enabled?: boolean;
  delayMs?: number;
}

export interface LongPress {
  handlers: Pick<
    DOMAttributes<Element>,
    "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel"
  >;
  /**
   * True for the click a completed hold leaves behind, once. The finger lifting off a row
   * must not also open the row, and the hold has already said what it meant.
   */
  afterPress: () => boolean;
}

export function useLongPress(options: LongPressOptions): LongPress {
  const timer = useRef<number | undefined>(undefined);
  const press = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const firedAt = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function stop() {
    window.clearTimeout(timer.current);
    press.current = null;
  }

  function onPointerDown(event: ReactPointerEvent<Element>) {
    stop();
    if (options.enabled === false || event.pointerType !== "touch") return;
    const target = event.target as Element | null;
    if (!target || (options.claims && !options.claims(target))) return;
    const point = { x: event.clientX, y: event.clientY };
    press.current = { pointerId: event.pointerId, ...point };
    timer.current = window.setTimeout(() => {
      press.current = null;
      firedAt.current = Date.now();
      options.onLongPress(point, target);
    }, options.delayMs ?? LONG_PRESS_MS);
  }

  function onPointerMove(event: ReactPointerEvent<Element>) {
    const active = press.current;
    if (!active || event.pointerId !== active.pointerId) return;
    if (!heldStill(event.clientX - active.x, event.clientY - active.y)) stop();
  }

  function onPointerUp(event: ReactPointerEvent<Element>) {
    if (press.current?.pointerId === event.pointerId) stop();
  }

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      // The browser takes the pointer the moment the list starts scrolling under it.
      onPointerCancel: onPointerUp,
    },
    afterPress: () => {
      if (!firedAt.current || Date.now() - firedAt.current > PRESS_ECHO_MS) return false;
      firedAt.current = 0;
      return true;
    },
  };
}
