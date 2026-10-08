import type { DictationOverlayPosition } from "@exegol/shared";
import { layoutHasPane } from "../../stores/workspace/helpers";
import type { ProjectWorkspace } from "../../stores/workspace/types";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Span {
  left: number;
  right: number;
}

/** Where the card goes. Anchored (`docked` false): `top` is the middle of what it sits over (the
 *  card is shifted up by half its height). Docked: the pill's top edge, inside the title bar */
export interface OverlayBox {
  left: number;
  top: number;
  width: number;
  docked: boolean;
}

/** pane: over the target pane. window: centered on the window (no pane, or a panel such as the
 *  model chooser whose pane is off screen). dock: the recording pill in the title bar */
export type OverlayMode = "pane" | "window" | "dock";

const GUTTER = 8;
/** Space kept between the pill and the project name */
const TITLE_GAP = 12;
/** Narrower than this beside the name, the pill takes the whole free span instead */
const MIN_PILL_WIDTH = 220;
export const PILL_HEIGHT = 28;

/** The target pane is on screen: the workspace's Agents section of its project, in the active
 *  tab, and not floated out to its own window */
export function paneOnScreen(
  view: { activeView: string; workspaceSection: string; activeProjectId: string | null },
  ws: {
    projectWorkspaces: Record<string, Pick<ProjectWorkspace, "tabs" | "activeTabId">>;
    floatingPanes: Record<string, unknown>;
  },
  paneId: string,
): boolean {
  if (view.activeView !== "workspace" || view.workspaceSection !== "agents") return false;
  const pw = view.activeProjectId ? ws.projectWorkspaces[view.activeProjectId] : undefined;
  const tab = pw?.tabs.find((t) => t.id === pw.activeTabId);
  return !!tab && layoutHasPane(tab.layout, paneId) && !ws.floatingPanes[paneId];
}

/** The title bar takes a recording (pill) only: a panel with buttons centers on the window */
export function overlayMode(
  position: DictationOverlayPosition,
  hasPane: boolean,
  onScreen: boolean,
  recording: boolean,
): OverlayMode {
  if (position === "titlebar") return recording ? "dock" : "window";
  if (hasPane && onScreen) return "pane";
  return hasPane && recording ? "dock" : "window";
}

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

/** The title bar's free span: past the traffic-light inset and the controls left of the middle,
 *  before the ones right of it. A control across the middle is ignored */
export function freeSpan(viewportWidth: number, controls: Span[], leftInset: number): Span {
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

/** The pill beside the project name (right of it, else left), inside the free span; with no
 *  room beside it, centered over the whole span */
export function dockedPill(
  free: Span,
  title: Span | null,
  maxWidth: number,
): { left: number; width: number } {
  const lo = free.left + GUTTER;
  const hi = free.right - GUTTER;
  if (title) {
    const right = { left: Math.max(lo, title.right + TITLE_GAP), right: hi };
    const left = { left: lo, right: Math.min(hi, title.left - TITLE_GAP) };
    const rightW = right.right - right.left;
    const leftW = left.right - left.left;
    if (rightW >= MIN_PILL_WIDTH || leftW >= MIN_PILL_WIDTH) {
      if (rightW >= leftW || rightW >= maxWidth) {
        return { left: right.left, width: Math.min(maxWidth, rightW) };
      }
      const width = Math.min(maxWidth, leftW);
      return { left: left.right - width, width };
    }
  }
  const width = Math.max(0, Math.min(maxWidth, hi - lo));
  const center = (lo + hi) / 2;
  return { left: center - width / 2, width };
}

export const sameBox = (a: OverlayBox | null, b: OverlayBox): boolean =>
  !!a &&
  a.docked === b.docked &&
  Math.abs(a.left - b.left) < 0.5 &&
  Math.abs(a.top - b.top) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5;
