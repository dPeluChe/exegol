/** The floating file window's place in the app window (CSS px from the top-left) */
export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const FILE_WINDOW_MIN = { width: 320, height: 200 };
const MARGIN = 8;

/** Fits inside the viewport: never smaller than the minimum (unless the window is), never past
 *  an edge, so the header stays reachable */
export function clampRect(rect: WindowRect, viewport: Viewport): WindowRect {
  const maxW = Math.max(viewport.width - 2 * MARGIN, 0);
  const maxH = Math.max(viewport.height - 2 * MARGIN, 0);
  const width = Math.min(Math.max(rect.width, FILE_WINDOW_MIN.width), maxW);
  const height = Math.min(Math.max(rect.height, FILE_WINDOW_MIN.height), maxH);
  const x = Math.min(Math.max(rect.x, MARGIN), viewport.width - MARGIN - width);
  const y = Math.min(Math.max(rect.y, MARGIN), viewport.height - MARGIN - height);
  return { x: Math.max(x, 0), y: Math.max(y, 0), width, height };
}

/** First open: centered, most of the window, capped for a large screen */
export function defaultRect(viewport: Viewport): WindowRect {
  const width = Math.min(Math.round(viewport.width * 0.6), 960);
  const height = Math.min(Math.round(viewport.height * 0.7), 760);
  return clampRect(
    {
      x: Math.round((viewport.width - width) / 2),
      y: Math.round((viewport.height - height) / 2),
      width,
      height,
    },
    viewport,
  );
}

/** A drag of the header (`move`) or the bottom-right corner (`resize`) by dx, dy from `start` */
export function dragRect(
  start: WindowRect,
  kind: "move" | "resize",
  dx: number,
  dy: number,
  viewport: Viewport,
): WindowRect {
  if (kind === "move") return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, viewport);
  // A resize never moves the window: the size gives way at the edge instead
  const width = Math.min(start.width + dx, viewport.width - MARGIN - start.x);
  const height = Math.min(start.height + dy, viewport.height - MARGIN - start.y);
  return clampRect({ ...start, width, height }, viewport);
}

/** Cmd+W: an open file window goes first, so it never reaches the close-session confirm */
export function closeRoute(fileWindowOpen: boolean): "file-window" | "pane" {
  return fileWindowOpen ? "file-window" : "pane";
}

/** The header's label: relative to the project when inside it, else the full path */
export function displayPath(path: string, projectPath?: string): string {
  if (!projectPath) return path;
  const root = projectPath.endsWith("/") ? projectPath : `${projectPath}/`;
  return path.startsWith(root) ? path.slice(root.length) : path;
}
