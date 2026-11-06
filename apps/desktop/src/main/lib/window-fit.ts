import type { Rectangle } from "electron";

/** Less than this on a display and the title bar may be out of reach */
const MIN_VISIBLE = { width: 100, height: 40 };

const contains = (d: Rectangle, w: Rectangle): boolean =>
  w.x >= d.x && w.y >= d.y && w.x + w.width <= d.x + d.width && w.y + w.height <= d.y + d.height;

/** Visible area of the window on a display, 0 when too little shows to reach it */
function visibleArea(w: Rectangle, d: Rectangle): number {
  const width = Math.min(w.x + w.width, d.x + d.width) - Math.max(w.x, d.x);
  const height = Math.min(w.y + w.height, d.y + d.height) - Math.max(w.y, d.y);
  return width < MIN_VISIBLE.width || height < MIN_VISIBLE.height ? 0 : width * height;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/** Onto the display showing most of it, else the primary one. Null when it already fits */
export function fitSavedWindow<T extends Rectangle>(
  saved: T,
  displays: Rectangle[],
  primary: Rectangle,
): T | null {
  if (displays.some((d) => contains(d, saved))) return null;
  let best = primary;
  let bestArea = 0;
  for (const display of displays) {
    const area = visibleArea(saved, display);
    if (area > bestArea) {
      best = display;
      bestArea = area;
    }
  }
  const width = Math.min(saved.width, best.width);
  const height = Math.min(saved.height, best.height);
  return {
    ...saved,
    width,
    height,
    x: clamp(saved.x, best.x, best.x + best.width - width),
    y: clamp(saved.y, best.y, best.y + best.height - height),
  };
}
