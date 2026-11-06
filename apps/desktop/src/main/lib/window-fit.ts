export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Less than this on a display and the title bar may be out of reach */
const MIN_VISIBLE = { width: 100, height: 40 };

const overlap = (a: Bounds, b: Bounds): { width: number; height: number } => ({
  width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
});

const contains = (d: Bounds, w: Bounds): boolean =>
  w.x >= d.x && w.y >= d.y && w.x + w.width <= d.x + d.width && w.y + w.height <= d.y + d.height;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/** A saved window that hangs off its display, moved fully onto the display showing most of it.
 *  Null when there is nothing to fix: it already fits, or no display really shows it */
export function fitSavedWindow<T extends Bounds>(
  saved: T,
  displays: Bounds[],
): (T & { displayBounds: Bounds }) | null {
  if (displays.some((d) => contains(d, saved))) return null;
  let best: Bounds | null = null;
  let bestArea = 0;
  for (const display of displays) {
    const { width, height } = overlap(saved, display);
    if (width < MIN_VISIBLE.width || height < MIN_VISIBLE.height) continue;
    if (width * height > bestArea) {
      best = display;
      bestArea = width * height;
    }
  }
  if (!best) return null;
  const width = Math.min(saved.width, best.width);
  const height = Math.min(saved.height, best.height);
  return {
    ...saved,
    width,
    height,
    x: clamp(saved.x, best.x, best.x + best.width - width),
    y: clamp(saved.y, best.y, best.y + best.height - height),
    displayBounds: best,
  };
}
