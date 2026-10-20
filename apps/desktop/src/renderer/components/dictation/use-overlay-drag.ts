import { type MouseEvent, type PointerEvent, useRef, useState } from "react";
import {
  anchorRect,
  NO_OFFSET,
  type Offset,
  type OverlayBox,
  type OverlayMode,
  offsetAt,
  offsetBox,
  offsetOf,
  type Rect,
} from "../../lib/dictation/overlay-position";
import { paneRoot } from "../../lib/pane-focus";
import { useDictationOverlayStore } from "../../stores/dictation-overlay";

/** Marks where the card can be grabbed: its header, never a button or the text */
export const DRAG_HANDLE = { "data-drag-handle": "" };
const DRAG_START_PX = 3;

const onHandle = (t: EventTarget | null): boolean =>
  t instanceof Element &&
  !!t.closest("[data-drag-handle]") &&
  !t.closest("button, a, input, textarea, select");

interface Frame {
  anchor: Rect;
  viewport: { width: number; height: number };
  size: { width: number; height: number };
}

function measure(
  mode: OverlayMode,
  paneId: string | null,
  card: { width: number; el: HTMLElement | null },
): Frame {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const pane = mode === "pane" && paneId ? paneRoot(paneId) : null;
  const anchor = anchorRect(mode, pane?.getBoundingClientRect() ?? null, viewport);
  return { anchor, viewport, size: { width: card.width, height: card.el?.offsetHeight ?? 0 } };
}

const boxIn = (f: Frame, offset: Offset): OverlayBox =>
  offsetBox(f.anchor, f.viewport, f.size, offset);

export function cardBox(
  mode: OverlayMode,
  paneId: string | null,
  card: { width: number; el: HTMLElement | null },
  offset: Offset,
): { box: OverlayBox; anchor: Rect } {
  const frame = measure(mode, paneId, card);
  return { box: boxIn(frame, offset), anchor: frame.anchor };
}

interface Gesture {
  pointerId: number;
  x: number;
  y: number;
  /** The card's center when grabbed, in px */
  start: { x: number; y: number };
  /** Measured once at the grab: a move only recomputes the box */
  frame: Frame;
  moved: boolean;
}

/** The card's stored offset and its drag by the handle (pointer capture). `live` holds the
 *  offset mid-drag so a relayout does not snap the card back; it is stored on release */
export function useOverlayDrag({
  mode,
  paneId,
  width,
  card,
  apply,
}: {
  mode: OverlayMode;
  paneId: string | null;
  width: number;
  card: HTMLElement | null;
  apply: (box: OverlayBox) => void;
}) {
  const kind = mode === "dock" ? null : mode;
  const stored = useDictationOverlayStore((s) => (kind ? s.offsets[kind] : undefined));
  const setOffset = useDictationOverlayStore((s) => s.setOffset);
  const gestureRef = useRef<Gesture | null>(null);
  const live = useRef<Offset | null>(null);
  const [dragging, setDragging] = useState(false);
  const { fx, fy } = stored ?? NO_OFFSET;
  const reset = stored && kind ? () => setOffset(kind, null) : undefined;

  const end = (e: PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (kind && gesture.moved && live.current) setOffset(kind, live.current);
    live.current = null;
    gestureRef.current = null;
    setDragging(false);
  };

  const handlers = {
    // The pane keeps the focus (Enter and Esc stay the dictation's) and no text gets selected
    onMouseDown: (e: MouseEvent) => {
      if (kind && onHandle(e.target)) e.preventDefault();
    },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (!kind || e.button !== 0 || !onHandle(e.target)) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      // From where the card shows: a stored offset may be clamped by a smaller window now
      const frame = measure(mode, paneId, { width, el: card });
      const box = boxIn(frame, { fx, fy });
      gestureRef.current = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        start: { x: box.left + box.width / 2, y: box.top },
        frame,
        moved: false,
      };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || e.pointerId !== gesture.pointerId) return;
      const mx = e.clientX - gesture.x;
      const my = e.clientY - gesture.y;
      if (!gesture.moved) {
        if (Math.hypot(mx, my) < DRAG_START_PX) return;
        gesture.moved = true;
        setDragging(true);
      }
      const { frame } = gesture;
      const box = boxIn(frame, offsetAt(gesture.start.x + mx, gesture.start.y + my, frame.anchor));
      live.current = offsetOf(box, frame.anchor);
      apply(box);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
    onDoubleClick: (e: MouseEvent) => {
      if (onHandle(e.target)) reset?.();
    },
  };
  return { fx, fy, reset, dragging, handlers, live };
}
