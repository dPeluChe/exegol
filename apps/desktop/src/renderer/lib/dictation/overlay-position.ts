import type { DictationOverlayPosition } from "@exegol/shared";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the card goes. Anchored: `top` is the pane's middle (the card is shifted up by half its
 *  height). Docked: `top` is the card's top edge, at the top center of the window */
export interface OverlayBox {
  left: number;
  top: number;
  width: number;
  docked: boolean;
}

const GUTTER = 8;
/** Docked card's top: inside the title bar, clear of its border */
export const DOCK_TOP = 6;
/** Narrower than this and a docked card shifts off center instead of shrinking further */
const MIN_DOCK_WIDTH = 280;

/** Centered on the rect, kept inside the window */
export function anchoredBox(r: Rect, viewportWidth: number, width: number): OverlayBox {
  const w = Math.min(width, viewportWidth - GUTTER * 2);
  const left = Math.max(GUTTER, r.left + r.width / 2 - w / 2);
  return {
    left: Math.min(left, viewportWidth - w - GUTTER),
    top: r.top + r.height / 2,
    width: w,
    docked: false,
  };
}

/** Top center of the window, inside the span the title bar leaves free (traffic lights and its
 *  buttons stay uncovered): centered while it fits, else shrunk, else shifted */
export function dockedBox(
  viewportWidth: number,
  width: number,
  free: { left: number; right: number },
): OverlayBox {
  const lo = free.left + GUTTER;
  const hi = Math.max(lo, free.right - GUTTER);
  const center = viewportWidth / 2;
  const centered = 2 * Math.min(center - lo, hi - center);
  const w = Math.min(width, Math.max(centered, Math.min(MIN_DOCK_WIDTH, hi - lo)));
  const left = Math.min(Math.max(center - w / 2, lo), Math.max(lo, hi - w));
  return { left, top: DOCK_TOP, width: w, docked: true };
}

/** The title bar's free span: past the controls left of the middle, before the ones right of it.
 *  A control across the middle (the project name) is covered */
export function freeSpan(
  viewportWidth: number,
  controls: { left: number; right: number }[],
  leftInset: number,
): { left: number; right: number } {
  const mid = viewportWidth / 2;
  let left = leftInset;
  let right = viewportWidth;
  for (const c of controls) {
    if (c.right <= c.left) continue;
    if (c.right <= mid) left = Math.max(left, c.right);
    else if (c.left >= mid) right = Math.min(right, c.left);
  }
  return { left, right };
}

/** Over the pane only while it is on screen; with no pane at all, over the window */
export function overlayBox(
  position: DictationOverlayPosition,
  hasPane: boolean,
  shown: Rect | null,
  viewport: { width: number; height: number },
  width: number,
  free: () => { left: number; right: number },
): OverlayBox {
  if (position === "pane" && shown) return anchoredBox(shown, viewport.width, width);
  if (position === "pane" && !hasPane) {
    return anchoredBox({ left: 0, top: 0, ...viewport }, viewport.width, width);
  }
  return dockedBox(viewport.width, width, free());
}

export const sameBox = (a: OverlayBox | null, b: OverlayBox): boolean =>
  !!a &&
  a.docked === b.docked &&
  Math.abs(a.left - b.left) < 0.5 &&
  Math.abs(a.top - b.top) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5;
