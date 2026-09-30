/** Past this a press is a drag, not a click */
const THRESHOLD_PX = 4;

export interface ReorderGesture {
  key: string;
  startX: number;
  startY: number;
  active: boolean;
  /** The item under the pointer while dragging */
  over: string | null;
}

export function startGesture(key: string, x: number, y: number): ReorderGesture {
  return { key, startX: x, startY: y, active: false, over: null };
}

export function moveGesture(
  g: ReorderGesture,
  x: number,
  y: number,
  keyAtPoint: string | null,
): ReorderGesture {
  const active = g.active || Math.hypot(x - g.startX, y - g.startY) > THRESHOLD_PX;
  return { ...g, active, over: active ? keyAtPoint : null };
}

/** The move to apply, and whether the click that follows must be swallowed */
export function endGesture(g: ReorderGesture): {
  drop: { drag: string; target: string } | null;
  wasDrag: boolean;
} {
  const drop = g.active && g.over && g.over !== g.key ? { drag: g.key, target: g.over } : null;
  return { drop, wasDrag: g.active };
}
