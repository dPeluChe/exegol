import { collectPaneIds } from "../stores/workspace/helpers";
import type { WorkspaceTab } from "../stores/workspace/types";

/** A tab row selects the tab's last focused pane; a pane row selects itself */
export interface SwitcherItem {
  kind: "tab" | "pane";
  tabId: string;
  paneId: string;
}

/** Under Ctrl+Tab this long the switch is a quick one (no overlay) */
export const QUICK_SWITCH_MS = 200;

const MRU_LIMIT = 50;

/** The pane goes to the front of the most-recently-used list */
export function touchMru(mru: readonly string[], paneId: string): string[] {
  if (mru[0] === paneId) return mru as string[];
  return [paneId, ...mru.filter((id) => id !== paneId)].slice(0, MRU_LIMIT);
}

function rankOf(mru: readonly string[]): (paneId: string) => number {
  return (paneId) => {
    const at = mru.indexOf(paneId);
    return at === -1 ? Number.POSITIVE_INFINITY : at;
  };
}

/** The tab's pane used last, else its first */
export function lastPaneOfTab(tab: WorkspaceTab, mru: readonly string[]): string | null {
  const ids = collectPaneIds(tab.layout);
  const rank = rankOf(mru);
  let best: string | null = ids[0] ?? null;
  for (const id of ids) if (best === null || rank(id) < rank(best)) best = id;
  return best;
}

/** Tabs by their most recently used pane; never-used tabs keep their order at the end */
export function tabsByMru(tabs: readonly WorkspaceTab[], mru: readonly string[]): WorkspaceTab[] {
  const rank = rankOf(mru);
  const tabRank = (tab: WorkspaceTab) => Math.min(...collectPaneIds(tab.layout).map(rank));
  return tabs
    .map((tab, i) => ({ tab, i, r: tabRank(tab) }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r - b.r))
    .map((x) => x.tab);
}

/** The overlay's rows, flattened: each tab (MRU order) followed by its panes (layout order) */
export function buildSwitcherItems(
  tabs: readonly WorkspaceTab[],
  mru: readonly string[],
): SwitcherItem[] {
  return tabsByMru(tabs, mru).flatMap((tab) => {
    const panes = collectPaneIds(tab.layout);
    const last = lastPaneOfTab(tab, mru);
    if (!last) return [];
    return [
      { kind: "tab" as const, tabId: tab.id, paneId: last },
      ...panes.map((paneId) => ({ kind: "pane" as const, tabId: tab.id, paneId })),
    ];
  });
}

/** One step down (or up) the list, wrapping */
export function stepIndex(index: number, length: number, direction: "next" | "prev"): number {
  if (length === 0) return -1;
  const step = direction === "next" ? 1 : -1;
  return (index + step + length) % length;
}

/** The pane a quick Ctrl+Tab goes to: the one used before the current one */
export function quickSwitchTarget(
  mru: readonly string[],
  current: string | null,
  existing: ReadonlySet<string>,
): string | null {
  return mru.find((id) => id !== current && existing.has(id)) ?? null;
}

/** Where the highlight starts: the previous pane (Ctrl+Tab) or one row above the current pane */
export function initialIndex(
  items: readonly SwitcherItem[],
  current: string | null,
  previous: string | null,
  direction: "next" | "prev",
): number {
  if (items.length === 0) return -1;
  const currentRow = items.findIndex((it) => it.kind === "pane" && it.paneId === current);
  if (direction === "next") {
    const prevRow = items.findIndex((it) => it.kind === "pane" && it.paneId === previous);
    if (prevRow !== -1) return prevRow;
    return currentRow === -1 ? 0 : stepIndex(currentRow, items.length, "next");
  }
  return stepIndex(currentRow === -1 ? 0 : currentRow, items.length, "prev");
}

/** A single Ctrl+Tab released before the overlay would show: jump, show nothing */
export function isQuickSwitch(presses: number, heldMs: number): boolean {
  return presses === 1 && heldMs < QUICK_SWITCH_MS;
}
