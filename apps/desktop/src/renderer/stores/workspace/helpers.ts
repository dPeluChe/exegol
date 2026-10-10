import { nanoid } from "nanoid";
import type {
  ClosedEntry,
  CloseTarget,
  FilesViewPatch,
  LayoutNode,
  Pane,
  PaneSlot,
  ProjectWorkspace,
  WorkspaceStore,
  WorkspaceTab,
} from "./types";

// ─── Helpers ────────────────────────────────────────────────────────────────

export function createEmptyPane(): Pane {
  return { id: nanoid(8), type: "empty" };
}

const EMPTY_PW: ProjectWorkspace = { tabs: [], activeTabId: null, panes: {} };

export function getPw(state: WorkspaceStore): ProjectWorkspace {
  const pid = state._activeProjectId;
  if (!pid) return EMPTY_PW;
  return state.projectWorkspaces[pid] ?? EMPTY_PW;
}

export function setPw(
  state: WorkspaceStore,
  updates: Partial<ProjectWorkspace>,
): Partial<WorkspaceStore> {
  const pid = state._activeProjectId;
  if (!pid) return {};
  const current = state.projectWorkspaces[pid] ?? EMPTY_PW;
  return {
    projectWorkspaces: {
      ...state.projectWorkspaces,
      [pid]: { ...current, ...updates },
    },
  };
}

/** A files pane with `patch` applied; another file starts at its own default mode and the top */
export function applyFilesView(pane: Pane, patch: FilesViewPatch): Pane {
  const { openFile, ...view } = patch;
  let files = { ...pane.files, ...view };
  let next = pane;
  if (openFile !== undefined && (openFile ?? undefined) !== pane.openFile) {
    files = { ...files, mode: view.mode, cursor: view.cursor };
    next = { ...pane, openFile: openFile ?? undefined };
  }
  return { ...next, files };
}

export function removeNodeByPaneId(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === "pane") {
    return node.paneId === paneId ? null : node;
  }

  const remaining: LayoutNode[] = [];
  const remainingSizes: number[] = [];
  for (let i = 0; i < node.children.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: layout tree guarantees non-null
    const child = node.children[i]!;
    const kept = removeNodeByPaneId(child, paneId);
    if (kept) {
      remaining.push(kept);
      remainingSizes.push(node.sizes[i] ?? 50);
    }
  }

  if (remaining.length === 0) return null;
  // biome-ignore lint/style/noNonNullAssertion: layout tree guarantees non-null
  if (remaining.length === 1) return remaining[0]!;

  const total = remainingSizes.reduce((a, b) => a + b, 0);
  const normalizedSizes = remainingSizes.map((s) =>
    total > 0 ? (s / total) * 100 : 100 / remainingSizes.length,
  );

  return { ...node, children: remaining, sizes: normalizedSizes };
}

export function findFirstPaneId(node: LayoutNode): string | null {
  if (node.type === "pane") return node.paneId;
  for (const child of node.children) {
    const found = findFirstPaneId(child);
    if (found) return found;
  }
  return null;
}

export function splitNodeByPaneId(
  node: LayoutNode,
  paneId: string,
  direction: "horizontal" | "vertical",
  newPaneId: string,
  /** Place the new pane BEFORE the target (drop on its left/top edge). */
  newPaneFirst = false,
): LayoutNode {
  if (node.type === "pane") {
    if (node.paneId === paneId) {
      const incoming: LayoutNode = { type: "pane", paneId: newPaneId };
      return {
        type: "split",
        direction,
        children: newPaneFirst ? [incoming, node] : [node, incoming],
        sizes: [50, 50],
      };
    }
    return node;
  }

  const newChildren = node.children.map((child) =>
    splitNodeByPaneId(child, paneId, direction, newPaneId, newPaneFirst),
  );
  const changed = newChildren.some((c, i) => c !== node.children[i]);
  return changed ? { ...node, children: newChildren } : node;
}

/** Whether a pane lives in this layout: stops at the first hit, builds no list */
export function layoutHasPane(node: LayoutNode, paneId: string): boolean {
  if (node.type === "pane") return node.paneId === paneId;
  return node.children.some((child) => layoutHasPane(child, paneId));
}

export function collectPaneIds(node: LayoutNode): string[] {
  if (node.type === "pane") return [node.paneId];
  return node.children.flatMap(collectPaneIds);
}

/**
 * A project's workspace without a session's panes: a tab left with nothing else in it closes
 * (unless it is the project's only tab), otherwise the pane becomes a launcher. Null: not shown.
 */
export function releaseAgentPanes(pw: ProjectWorkspace, agentId: string): ProjectWorkspace | null {
  const held = (pid: string) => pw.panes[pid]?.agentId === agentId;
  if (!Object.keys(pw.panes).some(held)) return null;
  const panes = { ...pw.panes };
  let tabs = pw.tabs;
  for (const tab of pw.tabs) {
    const ids = collectPaneIds(tab.layout);
    if (!ids.some(held)) continue;
    const emptied = ids.every((pid) => held(pid) || pw.panes[pid]?.type === "empty");
    if (emptied && tabs.length > 1) {
      tabs = tabs.filter((t) => t.id !== tab.id);
      for (const pid of ids) delete panes[pid];
      continue;
    }
    for (const pid of ids.filter(held)) {
      panes[pid] = { ...(panes[pid] as Pane), type: "empty", agentId: undefined };
    }
  }
  // A closed active tab hands over to its neighbour, as removeTab does
  const at = pw.tabs.findIndex((t) => t.id === pw.activeTabId);
  const activeTabId = tabs.some((t) => t.id === pw.activeTabId)
    ? pw.activeTabId
    : (tabs[Math.min(Math.max(at, 0), tabs.length - 1)]?.id ?? null);
  return { ...pw, tabs, panes, activeTabId };
}

/**
 * A project's tabs and panes with `paneId` moved from `fromTabId` into `toTabId`, to the right of
 * that tab's last focused (or first) pane, or in place of it when that pane is an empty launcher.
 * A source tab left with no pane closes. Null: nothing to move.
 */
export function movePaneToTab(
  pw: ProjectWorkspace,
  fromTabId: string,
  paneId: string,
  toTabId: string,
): Pick<ProjectWorkspace, "tabs" | "panes"> | null {
  if (fromTabId === toTabId || !pw.panes[paneId]) return null;
  const from = pw.tabs.find((t) => t.id === fromTabId);
  const to = pw.tabs.find((t) => t.id === toTabId);
  if (!from || !to || !layoutHasPane(from.layout, paneId)) return null;
  const target = paneInTabOrFirst(to, to.lastFocusedPaneId);
  if (!target) return null;

  const panes = { ...pw.panes };
  let toLayout: LayoutNode;
  if (pw.panes[target]?.type === "empty") {
    delete panes[target];
    toLayout = replacePaneId(to.layout, target, paneId);
  } else {
    toLayout = splitNodeByPaneId(to.layout, target, "horizontal", paneId);
  }
  const fromLayout = removeNodeByPaneId(from.layout, paneId);
  const tabs = pw.tabs.flatMap((t) => {
    if (t.id === toTabId) return [{ ...t, layout: toLayout, lastFocusedPaneId: paneId }];
    if (t.id !== fromTabId) return [t];
    return fromLayout ? [{ ...t, layout: fromLayout }] : [];
  });
  return { tabs, panes };
}

function replacePaneId(node: LayoutNode, oldId: string, newId: string): LayoutNode {
  if (node.type === "pane") return node.paneId === oldId ? { type: "pane", paneId: newId } : node;
  return { ...node, children: node.children.map((c) => replacePaneId(c, oldId, newId)) };
}

/** `paneId` when the tab's layout holds it, else the tab's first pane */
export function paneInTabOrFirst(
  tab: WorkspaceTab,
  paneId: string | null | undefined,
): string | null {
  return paneId && layoutHasPane(tab.layout, paneId) ? paneId : findFirstPaneId(tab.layout);
}

export function activeTabOf(pw: ProjectWorkspace): WorkspaceTab | null {
  return pw.tabs.find((t) => t.id === pw.activeTabId) ?? null;
}

/** The pane the keyboard acts on: the focused pane when the active tab holds it, else that tab's
 *  last focused (or first) pane. Never a pane of another tab */
export function activePaneId(pw: ProjectWorkspace, focusedPaneId: string | null): string | null {
  const tab = activeTabOf(pw);
  if (!tab) return null;
  if (focusedPaneId && layoutHasPane(tab.layout, focusedPaneId)) return focusedPaneId;
  return paneInTabOrFirst(tab, tab.lastFocusedPaneId);
}

/** The invariant every action keeps: the focused pane is in the active tab (none without one) */
export function focusInActiveTab(pw: ProjectWorkspace, focusedPaneId: string | null): boolean {
  const tab = activeTabOf(pw);
  if (!tab) return focusedPaneId === null;
  return !!focusedPaneId && layoutHasPane(tab.layout, focusedPaneId);
}

/** The active tab remembers `focusedPaneId` (when it holds it): a tab or project switch back
 *  restores it */
export function rememberFocus(
  pw: ProjectWorkspace,
  focusedPaneId: string | null,
): ProjectWorkspace {
  const tab = activeTabOf(pw);
  if (!tab || !focusedPaneId || tab.lastFocusedPaneId === focusedPaneId) return pw;
  if (!layoutHasPane(tab.layout, focusedPaneId)) return pw;
  const tabs = pw.tabs.map((t) =>
    t.id === tab.id ? { ...t, lastFocusedPaneId: focusedPaneId } : t,
  );
  return { ...pw, tabs };
}

/** Make `tabId` the active tab with the focus on `paneId` (else the tab's last focused or first
 *  pane), remembering the pane the old active tab was left on */
export function activateTab(
  pw: ProjectWorkspace,
  focusedPaneId: string | null,
  tabId: string | null,
  paneId?: string | null,
): { pw: ProjectWorkspace; focusedPaneId: string | null } {
  const remembered = rememberFocus(pw, focusedPaneId);
  const tab = remembered.tabs.find((t) => t.id === tabId);
  if (!tab) return { pw: { ...remembered, activeTabId: null }, focusedPaneId: null };
  const focus =
    paneId && layoutHasPane(tab.layout, paneId)
      ? paneId
      : paneInTabOrFirst(tab, tab.lastFocusedPaneId);
  return { pw: { ...remembered, activeTabId: tab.id }, focusedPaneId: focus };
}

/** Close one pane of a tab; `wholeTabIfLast`: its last pane takes the tab with it (Cmd+W) */
export function closeTargetFor(
  pw: ProjectWorkspace,
  tabId: string,
  paneId: string | null,
  wholeTabIfLast: boolean,
): CloseTarget | null {
  const tab = pw.tabs.find((t) => t.id === tabId);
  if (!tab) return null;
  const target = paneInTabOrFirst(tab, paneId);
  if (!target) return null;
  const all = collectPaneIds(tab.layout);
  const closesTab = wholeTabIfLast && all.length <= 1;
  return { tabId, paneId: target, paneIds: closesTab ? all : [target], closesTab };
}

/** A whole tab */
export function tabCloseTarget(pw: ProjectWorkspace, tabId: string): CloseTarget | null {
  const tab = pw.tabs.find((t) => t.id === tabId);
  const first = tab ? findFirstPaneId(tab.layout) : null;
  if (!tab || !first) return null;
  return { tabId, paneId: first, paneIds: collectPaneIds(tab.layout), closesTab: true };
}

/** Cmd+W: the active tab's own focused pane, never one in another tab */
export function resolveCloseTarget(
  pw: ProjectWorkspace,
  focusedPaneId: string | null,
): CloseTarget | null {
  const tab = activeTabOf(pw);
  return tab ? closeTargetFor(pw, tab.id, activePaneId(pw, focusedPaneId), true) : null;
}

/** Whether a close target still matches the workspace (it can change while a dialog asks) */
export function closeTargetValid(pw: ProjectWorkspace, target: CloseTarget): boolean {
  const tab = pw.tabs.find((t) => t.id === target.tabId);
  return !!tab && target.paneIds.every((id) => layoutHasPane(tab.layout, id));
}

/** Where a pane sits: beside which pane, in which direction, before or after it */
export function paneSlot(tab: WorkspaceTab, paneId: string): PaneSlot | null {
  const walk = (node: LayoutNode): PaneSlot | null => {
    if (node.type === "pane") return null;
    const at = node.children.findIndex((c) => c.type === "pane" && c.paneId === paneId);
    if (at !== -1) {
      const siblingAt = at + 1 < node.children.length ? at + 1 : at - 1;
      const sibling = node.children[siblingAt];
      const siblingPaneId = sibling ? findFirstPaneId(sibling) : null;
      if (!siblingPaneId) return null;
      return { tabId: tab.id, siblingPaneId, direction: node.direction, before: at < siblingAt };
    }
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(tab.layout);
}

export const MAX_RECENTLY_CLOSED = 10;

export function pushClosed(list: ClosedEntry[], entry: ClosedEntry): ClosedEntry[] {
  return [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, MAX_RECENTLY_CLOSED);
}

/** Put a closed tab or pane back: the tab at its index, the pane beside the pane it sat next to
 *  (a tab of its own when that is gone). Its sessions' panes come back as launchers to fill */
export function restoreClosedInto(
  pw: ProjectWorkspace,
  entry: ClosedEntry,
): { pw: ProjectWorkspace; tabId: string; paneId: string } {
  const sessionPanes = new Set(entry.sessions.map((s) => s.paneId));
  const panes = { ...pw.panes };
  for (const pane of entry.panes) {
    panes[pane.id] = sessionPanes.has(pane.id) ? { id: pane.id, type: "empty" } : pane;
  }
  const firstPane = entry.panes[0]?.id ?? nanoid(8);
  if (!panes[firstPane]) panes[firstPane] = { id: firstPane, type: "empty" };
  const slot = entry.slot;
  const host = slot ? pw.tabs.find((t) => t.id === slot.tabId) : undefined;
  if (entry.kind === "pane" && slot && host && layoutHasPane(host.layout, slot.siblingPaneId)) {
    const layout = splitNodeByPaneId(
      host.layout,
      slot.siblingPaneId,
      slot.direction,
      firstPane,
      slot.before,
    );
    const tabs = pw.tabs.map((t) => (t.id === host.id ? { ...t, layout } : t));
    return { pw: { ...pw, panes, tabs }, tabId: host.id, paneId: firstPane };
  }
  const reuseId = entry.tab && !pw.tabs.some((t) => t.id === entry.tab?.id);
  const tab: WorkspaceTab = {
    id: reuseId && entry.tab ? entry.tab.id : nanoid(8),
    label: entry.label,
    layout: entry.tab?.layout ?? { type: "pane", paneId: firstPane },
  };
  const tabs = [...pw.tabs];
  tabs.splice(Math.min(entry.tab?.index ?? tabs.length, tabs.length), 0, tab);
  return {
    pw: { ...pw, panes, tabs },
    tabId: tab.id,
    paneId: findFirstPaneId(tab.layout) ?? firstPane,
  };
}

/** Leave the active project (its active tab remembering the focused pane) for `next`, as left */
export function switchProject(state: WorkspaceStore, next: string | null): Partial<WorkspaceStore> {
  const prev = state._activeProjectId;
  const prevPw = prev ? state.projectWorkspaces[prev] : undefined;
  const leftPw = prevPw ? rememberFocus(prevPw, state.focusedPaneId) : undefined;
  const projectWorkspaces =
    prev && leftPw && leftPw !== prevPw
      ? { ...state.projectWorkspaces, [prev]: leftPw }
      : state.projectWorkspaces;
  const nextPw = next ? projectWorkspaces[next] : undefined;
  return {
    _activeProjectId: next,
    projectWorkspaces,
    focusedPaneId: nextPw ? activePaneId(nextPw, null) : null,
  };
}
