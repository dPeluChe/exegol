export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  left: number;
  top: number;
}

/** Where `object-fit: contain` draws a `frame` inside `box` */
export function containRect(box: Rect, frame: Size): Rect {
  if (frame.width <= 0 || frame.height <= 0) return box;
  const scale = Math.min(box.width / frame.width, box.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  return {
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height,
  };
}

/** A pointer in client px to device points, null outside the drawn screen */
export function toDevicePoint(
  client: { x: number; y: number },
  box: Rect,
  frame: Size,
  points: Size,
): { x: number; y: number } | null {
  const drawn = containRect(box, frame);
  if (drawn.width <= 0 || drawn.height <= 0) return null;
  const fx = (client.x - drawn.left) / drawn.width;
  const fy = (client.y - drawn.top) / drawn.height;
  if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return null;
  return { x: fx * points.width, y: fy * points.height };
}

/** Clamped into the screen: a swipe that ends past the edge still lands on it */
export function clampToScreen(
  client: { x: number; y: number },
  box: Rect,
  frame: Size,
): {
  x: number;
  y: number;
} {
  const drawn = containRect(box, frame);
  return {
    x: Math.min(Math.max(client.x, drawn.left), drawn.left + drawn.width),
    y: Math.min(Math.max(client.y, drawn.top), drawn.top + drawn.height),
  };
}

/** Pixels per point by device family; the 2x iPhones are the SE, 8, XR and 11 */
export function deviceScale(name: string): number {
  if (/^iPhone (SE|8|XR|11)\b(?! Pro)/.test(name)) return 2;
  return name.startsWith("iPhone") ? 3 : 2;
}

/** Without AXe's tree: frames are points × device scale × stream scale */
export function pointsFromFrame(frame: Size, streamScale: number, scale: number): Size {
  const factor = streamScale * scale;
  return { width: Math.round(frame.width / factor), height: Math.round(frame.height / factor) };
}

/** describe-ui answers in one orientation; a rotated frame swaps the axes */
export function orientPoints(points: Size, frame: Size): Size {
  if (!frame.width || !frame.height) return points;
  const frameWide = frame.width > frame.height;
  const pointsWide = points.width > points.height;
  return frameWide === pointsWide ? points : { width: points.height, height: points.width };
}

/** A press that barely moved is a tap; anything longer a swipe */
export const TAP_SLOP_PX = 6;
export function isTap(down: { x: number; y: number }, up: { x: number; y: number }): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= TAP_SLOP_PX;
}

/** Swipe duration from how long the drag took, inside what AXe accepts well */
export function swipeSeconds(ms: number): number {
  return Math.min(Math.max(ms / 1000, 0.1), 1.5);
}
