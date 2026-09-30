/** Room kept between a menu and the window's edge */
const MARGIN = 4;

/**
 * Where a menu opened at `point` fits: below and to the right of the cursor when there is room,
 * otherwise above it or to its left. Taller than the window: pinned to the top, capped to scroll.
 */
export function fitMenuToViewport(
  point: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number; maxHeight: number } {
  const maxHeight = viewport.height - MARGIN * 2;
  const height = Math.min(size.height, maxHeight);
  let left = point.x;
  if (left + size.width + MARGIN > viewport.width) left = Math.max(MARGIN, point.x - size.width);
  let top = point.y;
  if (top + height + MARGIN > viewport.height) top = Math.max(MARGIN, point.y - height);
  return { left, top, maxHeight };
}
