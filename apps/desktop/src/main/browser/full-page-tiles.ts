/** What scrolls and how far, in CSS px; `offset` is the scroller's top inside the viewport */
export interface TilePlan {
  total: number;
  view: number;
  offset: number;
}

/** Scroll targets that cover `total` CSS px in steps of the visible height */
export function tileStops(total: number, view: number): number[] {
  if (view <= 0) return [0];
  return Array.from({ length: Math.max(1, Math.ceil(total / view)) }, (_, i) => i * view);
}

/** Rows to keep, in image px, of the capture taken at `stop`: the page clamps the last scroll,
 *  so `real` can be above `stop` and the strip starts lower in the image */
export function tileCrop(
  stop: number,
  real: number,
  plan: TilePlan,
  scale: number,
  imageHeight: number,
): { y: number; height: number } | null {
  const skip = Math.max(0, stop - real);
  const y = Math.round((plan.offset + skip) * scale);
  const keep = Math.min(plan.view - skip, plan.total - stop);
  const height = Math.min(Math.round(keep * scale), imageHeight - y);
  return height > 0 ? { y, height } : null;
}
