import { type MouseEvent, type PointerEvent, useRef, useState } from "react";
import {
  type Offset,
  type OverlayBox,
  type OverlayMode,
  offsetBox,
  offsetOf,
  type Rect,
} from "../../lib/dictation/overlay-position";
import { paneRoot } from "../../lib/pane-focus";
import { type AnchorKind, useDictationOverlayStore } from "../../stores/dictation-overlay";

/** Marks where the card can be grabbed: its header, never a button or the text */
export const DRAG_HANDLE = { "data-drag-handle": "" };
const DRAG_START_PX = 3;

const onHandle = (t: EventTarget | null): boolean =>
  t instanceof Element &&
  !!t.closest("[data-drag-handle]") &&
  !t.closest("button, a, input, textarea, select");

export const anchorKind = (mode: OverlayMode): AnchorKind | null => (mode === "dock" ? null : mode);

/** The pane the card sits over, else the window (also when the pane is not in the DOM) */
export function anchorRect(mode: OverlayMode, paneId: string | null): Rect {
  const el = mode === "pane" && paneId ? paneRoot(paneId) : null;
  return el
    ? el.getBoundingClientRect()
    : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

export function cardBox(
  mode: OverlayMode,
  paneId: string | null,
  card: { width: number; el: HTMLElement | null },
  offset: Offset,
): { box: OverlayBox; anchor: Rect } {
  const anchor = anchorRect(mode, paneId);
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const size = { width: card.width, height: card.el?.offsetHeight ?? 0 };
  return { box: offsetBox(anchor, viewport, size, offset), anchor };
}

interface Gesture {
  pointerId: number;
  x: number;
  y: number;
  start: Offset;
  moved: boolean;
}

/** Drags the card by its handle with pointer capture. `live` holds the offset while dragging so
 *  a relayout (text growing) does not snap the card back; it is stored on release */
export function useOverlayDrag({
  mode,
  paneId,
  width,
  card,
  stored,
  apply,
}: {
  mode: OverlayMode;
  paneId: string | null;
  width: number;
  card: HTMLElement | null;
  stored: Offset;
  apply: (box: OverlayBox) => void;
}) {
  const kind = anchorKind(mode);
  const setOffset = useDictationOverlayStore((s) => s.setOffset);
  const gestureRef = useRef<Gesture | null>(null);
  const live = useRef<Offset | null>(null);
  const [dragging, setDragging] = useState(false);

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
      const { box, anchor } = cardBox(mode, paneId, { width, el: card }, stored);
      gestureRef.current = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        start: offsetOf(box, anchor),
        moved: false,
      };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || e.pointerId !== gesture.pointerId) return;
      const dx = e.clientX - gesture.x;
      const dy = e.clientY - gesture.y;
      if (!gesture.moved) {
        if (Math.hypot(dx, dy) < DRAG_START_PX) return;
        gesture.moved = true;
        setDragging(true);
      }
      const offset = { dx: gesture.start.dx + dx, dy: gesture.start.dy + dy };
      const { box, anchor } = cardBox(mode, paneId, { width, el: card }, offset);
      live.current = offsetOf(box, anchor);
      apply(box);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onDoubleClick: (e: MouseEvent) => {
      if (kind && onHandle(e.target)) setOffset(kind, null);
    },
  };
  return { dragging, handlers, live };
}
