import {
  type DOMAttributes,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import {
  type DrawerEdge,
  dragAxis,
  drawerOffsetPx,
  drawerProgress,
  drawerTravelPx,
  openingDistance,
  settlesOpen,
  startsAtEdge,
} from "./drawer-swipe";

/**
 * Pointer plumbing for a drawer that follows the thumb. Every decision it makes comes from
 * `drawer-swipe`; this only listens, measures and reports, so the awkward part is tested
 * without a DOM and the part that needs a DOM has nothing to get wrong.
 *
 * It deliberately accepts a mouse as well as a finger. The hook is only switched on for the
 * phone layout, and on a narrow window dragging the drawer with a mouse is the same gesture
 * — refusing it would only make the behaviour harder to test than to use.
 */

export interface DrawerSwipeOptions {
  /** Whether the drawer is open right now. */
  open: boolean;
  /** Which edge of the viewport the drawer is anchored to. */
  edge: DrawerEdge;
  /** The drawer's width in CSS pixels, read once when a drag begins. */
  measure: () => number;
  /** Where the drawer should end up, called once as the finger lifts. */
  onSettle: (open: boolean) => void;
  /** Off entirely: on a desktop layout these panes are not drawers. */
  enabled: boolean;
  /**
   * Whether a closed drawer can be pulled open, and only from the screen edge. An open
   * drawer always closes by dragging, from anywhere on it.
   */
  openFromEdge?: boolean;
}

export interface DrawerSwipe {
  /** 0 … 1 while a pointer is moving the drawer; null while it rests where it belongs. */
  progress: number | null;
  /**
   * How far to shift the drawer from its open position, in CSS pixels, or null when it is
   * at rest and its stylesheet should place it. Measured once per drag, so reading it costs
   * no layout.
   */
  offsetPx: number | null;
  /**
   * How far the drawer has come out of the edge, in CSS pixels, or null at rest. The
   * content behind it is pushed by exactly this much, so the two move as one surface.
   */
  travelPx: number | null;
  handlers: Pick<
    DOMAttributes<Element>,
    "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel"
  >;
}

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  openAtStart: boolean;
  width: number;
  rtl: boolean;
  /** False until the drag is clearly sideways; until then the page keeps the gesture. */
  claimed: boolean;
  lastX: number;
  lastAt: number;
  /** Pixels per millisecond towards open, from the most recent movement. */
  velocity: number;
  progress: number;
}

/** Below this the clock is too coarse for a speed to mean anything. */
const MIN_VELOCITY_INTERVAL_MS = 8;

function isRtl(): boolean {
  return typeof document !== "undefined" && document.documentElement.dir === "rtl";
}

export function useDrawerSwipe(options: DrawerSwipeOptions): DrawerSwipe {
  const drag = useRef<Drag | null>(null);
  const [moved, setMoved] = useState<{
    progress: number;
    offsetPx: number;
    travelPx: number;
  } | null>(null);

  function end(settle: boolean) {
    const active = drag.current;
    drag.current = null;
    setMoved(null);
    if (active?.claimed && settle) options.onSettle(settlesOpen(active));
  }

  function onPointerDown(event: ReactPointerEvent<Element>) {
    if (!options.enabled || drag.current) return;
    const rtl = isRtl();
    if (!options.open) {
      if (!options.openFromEdge) return;
      const atEdge = startsAtEdge({
        x: event.clientX,
        viewportWidth: window.innerWidth,
        edge: options.edge,
        rtl,
      });
      if (!atEdge) return;
    }
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      openAtStart: options.open,
      width: options.measure(),
      rtl,
      claimed: false,
      lastX: event.clientX,
      lastAt: event.timeStamp,
      velocity: 0,
      progress: options.open ? 1 : 0,
    };
  }

  function onPointerMove(event: ReactPointerEvent<Element>) {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    const dx = event.clientX - active.startX;

    if (!active.claimed) {
      const axis = dragAxis(dx, event.clientY - active.startY);
      if (axis === "undecided") return;
      if (axis === "vertical") {
        // The finger is scrolling. Hand the gesture back untouched.
        drag.current = null;
        return;
      }
      active.claimed = true;
      // Follow the pointer even once it leaves the element it started on — without this a
      // drag that reaches the edge of the screen simply stops.
      event.currentTarget.setPointerCapture?.(active.pointerId);
    }

    const elapsed = event.timeStamp - active.lastAt;
    if (elapsed >= MIN_VELOCITY_INTERVAL_MS) {
      active.velocity =
        openingDistance(event.clientX - active.lastX, options.edge, active.rtl) / elapsed;
      active.lastX = event.clientX;
      active.lastAt = event.timeStamp;
    }
    active.progress = drawerProgress({
      openAtStart: active.openAtStart,
      dx,
      width: active.width,
      edge: options.edge,
      rtl: active.rtl,
    });
    const placement = {
      progress: active.progress,
      width: active.width,
      edge: options.edge,
      rtl: active.rtl,
    };
    setMoved({
      progress: active.progress,
      offsetPx: drawerOffsetPx(placement),
      travelPx: drawerTravelPx(placement),
    });
  }

  function onPointerUp(event: ReactPointerEvent<Element>) {
    if (drag.current && event.pointerId !== drag.current.pointerId) return;
    end(true);
  }

  function onPointerCancel(event: ReactPointerEvent<Element>) {
    if (drag.current && event.pointerId !== drag.current.pointerId) return;
    // A cancelled drag never happened: the drawer returns to the state it was already in.
    end(false);
  }

  return {
    progress: moved?.progress ?? null,
    offsetPx: moved?.offsetPx ?? null,
    travelPx: moved?.travelPx ?? null,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
