import { nanoid } from "nanoid";
import { useAppStore } from "../app";
import { useTerminalStore } from "../terminals";
import {
  activateTab,
  activePaneId,
  activeTabOf,
  applyFilesView,
  collectPaneIds,
  createEmptyPane,
  getPw,
  layoutHasPane,
  paneInTabOrFirst,
  pushClosed,
  releaseAgentPanes,
  removeNodeByPaneId,
  resolveCloseTarget,
  restoreClosedInto,
  setPw,
  splitNodeByPaneId,
} from "./helpers";
import type {
  LayoutNode,
  Pane,
  ProjectWorkspace,
  WorkspaceSliceCreator,
  WorkspaceStore,
  WorkspaceTab,
} from "./types";

/** The active project's workspace with `updates`, its focus kept in its active tab (or moved to
 *  `tabId` and `paneId`): every change of the active tab goes through here */
function withFocus(
  s: WorkspaceStore,
  updates: Partial<ProjectWorkspace>,
  tabId?: string | null,
  paneId?: string | null,
): Partial<WorkspaceStore> {
  if (!s._activeProjectId) return { focusedPaneId: null };
  const pw = { ...getPw(s), ...updates };
  const next = activateTab(
    pw,
    s.focusedPaneId,
    tabId === undefined ? pw.activeTabId : tabId,
    paneId,
  );
  return { ...setPw(s, next.pw), focusedPaneId: next.focusedPaneId };
}

type TabsPanesSlice = Pick<
  WorkspaceStore,
  | "projectWorkspaces"
  | "_activeProjectId"
  | "focusedPaneId"
  | "paneCwd"
  | "paneLastExit"
  | "addTab"
  | "removeTab"
  | "setActiveTab"
  | "renameTab"
  | "reorderTab"
  | "mergeTabIntoSplit"
  | "removePane"
  | "movePaneBeside"
  | "splitPane"
  | "updatePane"
  | "setPaneUrl"
  | "setFilesView"
  | "releaseAgent"
  | "setFocusedPane"
  | "extractPaneToNewTab"
  | "closeTarget"
  | "closeFocusedPane"
  | "recentlyClosed"
  | "rememberClosed"
  | "restoreClosed"
  | "splitFocusedPane"
  | "getActiveTab"
  | "ensureDefaultTab"
  | "equalizeSplits"
  | "setSplitSizes"
  | "setPaneCwd"
  | "setPaneLastExit"
>;

export const createTabsPanesSlice: WorkspaceSliceCreator<TabsPanesSlice> = (set, get) => ({
  projectWorkspaces: {},
  _activeProjectId: useAppStore.getState().activeProjectId,
  focusedPaneId: null,
  paneCwd: {},
  paneLastExit: {},
  recentlyClosed: [],

  addTab: (label) => {
    const pane = createEmptyPane();
    const pw = getPw(get());
    const tab: WorkspaceTab = {
      id: nanoid(8),
      label: label ?? `Tab ${pw.tabs.length + 1}`,
      layout: { type: "pane", paneId: pane.id },
    };
    set((s) =>
      withFocus(s, { tabs: [...pw.tabs, tab], panes: { ...pw.panes, [pane.id]: pane } }, tab.id),
    );
    return tab.id;
  },

  removeTab: (tabId) =>
    set((s) => {
      const pw = getPw(s);
      const idx = pw.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return s;

      // biome-ignore lint/style/noNonNullAssertion: index valid
      const tab = pw.tabs[idx]!;
      const paneIds = collectPaneIds(tab.layout);
      const newPanes = { ...pw.panes };
      const cwd = { ...s.paneCwd };
      const exit = { ...s.paneLastExit };
      for (const pid of paneIds) {
        delete newPanes[pid];
        // T112: scrub per-pane OSC 7/133 state so paneCwd/paneLastExit
        // don't accumulate over long sessions.
        delete cwd[pid];
        delete exit[pid];
      }

      const newTabs = pw.tabs.filter((t) => t.id !== tabId);
      let newActiveTabId = pw.activeTabId;
      if (pw.activeTabId === tabId) {
        const neighborIdx = Math.min(idx, newTabs.length - 1);
        newActiveTabId = neighborIdx >= 0 ? (newTabs[neighborIdx]?.id ?? null) : null;
      }

      return {
        ...withFocus(s, { tabs: newTabs, activeTabId: newActiveTabId, panes: newPanes }),
        paneCwd: cwd,
        paneLastExit: exit,
      };
    }),

  setActiveTab: (tabId, paneId) => set((s) => withFocus(s, {}, tabId, paneId)),

  renameTab: (tabId, label) =>
    set((s) => {
      const pw = getPw(s);
      return setPw(s, { tabs: pw.tabs.map((t) => (t.id === tabId ? { ...t, label } : t)) });
    }),

  reorderTab: (fromIndex, toIndex) =>
    set((s) => {
      if (fromIndex === toIndex) return s;
      const pw = getPw(s);
      const newTabs = [...pw.tabs];
      const [moved] = newTabs.splice(fromIndex, 1);
      if (!moved) return s;
      newTabs.splice(toIndex, 0, moved);
      return setPw(s, { tabs: newTabs });
    }),

  mergeTabIntoSplit: (sourceTabId, targetTabId, direction, sourceFirst = false) =>
    set((s) => {
      const pw = getPw(s);
      const sourceTab = pw.tabs.find((t) => t.id === sourceTabId);
      const targetTab = pw.tabs.find((t) => t.id === targetTabId);
      if (!sourceTab || !targetTab || sourceTabId === targetTabId) return s;

      const mergedLayout: LayoutNode = {
        type: "split",
        direction,
        children: sourceFirst
          ? [sourceTab.layout, targetTab.layout]
          : [targetTab.layout, sourceTab.layout],
        sizes: [50, 50],
      };

      const newTabs = pw.tabs
        .filter((t) => t.id !== sourceTabId)
        .map((t) => (t.id === targetTabId ? { ...t, layout: mergedLayout } : t));

      return withFocus(s, { tabs: newTabs }, targetTabId);
    }),

  removePane: (tabId, paneId) =>
    set((s) => {
      const pw = getPw(s);
      const tab = pw.tabs.find((t) => t.id === tabId);
      if (!tab) return s;

      const newLayout = removeNodeByPaneId(tab.layout, paneId);
      const { [paneId]: closedPane, ...restPanes } = pw.panes;
      // T112: scrub per-pane OSC 7/133 state so paneCwd/paneLastExit
      // don't leak entries over long sessions.
      const cwd = { ...s.paneCwd };
      const exit = { ...s.paneLastExit };
      delete cwd[paneId];
      delete exit[paneId];
      // T143: drop terminal store state too — otherwise useTerminalStore's
      // map only ever grows across the app session.
      if (closedPane?.agentId) {
        useTerminalStore.getState().removeTerminal(closedPane.agentId);
      }

      if (!newLayout) {
        const emptyPane = createEmptyPane();
        return {
          ...withFocus(s, {
            tabs: pw.tabs.map((t) =>
              t.id === tabId
                ? { ...t, layout: { type: "pane" as const, paneId: emptyPane.id } }
                : t,
            ),
            panes: { ...restPanes, [emptyPane.id]: emptyPane },
          }),
          paneCwd: cwd,
          paneLastExit: exit,
        };
      }

      return {
        ...withFocus(s, {
          tabs: pw.tabs.map((t) => (t.id === tabId ? { ...t, layout: newLayout } : t)),
          panes: restPanes,
        }),
        paneCwd: cwd,
        paneLastExit: exit,
      };
    }),

  splitPane: (tabId, paneId, direction, newPaneType, config) =>
    set((s) => {
      const pw = getPw(s);
      const tab = pw.tabs.find((t) => t.id === tabId);
      if (!tab) return s;

      // T95: Fall back to the focused pane, but only one of this tab
      const targetId = paneInTabOrFirst(tab, paneId || s.focusedPaneId);
      if (!targetId) return s;

      const newPane: Pane = {
        id: config?.id ?? nanoid(8),
        type: newPaneType,
        agentId: config?.agentId,
        url: config?.url,
        ...(config?.linkPreview ? { linkPreview: true } : {}),
      };

      const newLayout = splitNodeByPaneId(tab.layout, targetId, direction, newPane.id);

      return setPw(s, {
        tabs: pw.tabs.map((t) => (t.id === tabId ? { ...t, layout: newLayout } : t)),
        panes: { ...pw.panes, [newPane.id]: newPane },
      });
    }),

  /** T40b completion: drop a pane on another pane's edge to rearrange the
   *  layout. The drop indicator already existed and computed the side — only
   *  the action was missing, so the UI promised a move and did nothing. */
  movePaneBeside: (tabId, sourcePaneId, targetPaneId, side) =>
    set((s) => {
      if (sourcePaneId === targetPaneId) return s;
      const pw = getPw(s);
      const tab = pw.tabs.find((t) => t.id === tabId);
      if (!tab) return s;

      const withoutSource = removeNodeByPaneId(tab.layout, sourcePaneId);
      // Removing the source can collapse its parent split; if the target went
      // with it (it was the only sibling) there is nothing to attach to.
      if (!withoutSource || !layoutHasPane(withoutSource, targetPaneId)) return s;

      const direction = side === "left" || side === "right" ? "horizontal" : "vertical";
      const sourceFirst = side === "left" || side === "top";
      const newLayout = splitNodeByPaneId(
        withoutSource,
        targetPaneId,
        direction,
        sourcePaneId,
        sourceFirst,
      );

      return setPw(s, {
        tabs: pw.tabs.map((t) => (t.id === tabId ? { ...t, layout: newLayout } : t)),
      });
    }),

  updatePane: (paneId, updates) =>
    set((s) => {
      const pw = getPw(s);
      const existing = pw.panes[paneId];
      if (!existing) return s;
      // Never moves the focus: a spawn finishing in another pane took it (Cmd+W then closed it)
      return setPw(s, { panes: { ...pw.panes, [paneId]: { ...existing, ...updates } } });
    }),

  setPaneUrl: (paneId, url) =>
    set((s) => {
      for (const [projectId, pw] of Object.entries(s.projectWorkspaces)) {
        const pane = pw.panes[paneId];
        if (!pane) continue;
        if (pane.url === url) return s;
        const panes = { ...pw.panes, [paneId]: { ...pane, url } };
        return { projectWorkspaces: { ...s.projectWorkspaces, [projectId]: { ...pw, panes } } };
      }
      return s;
    }),

  setFilesView: (paneId, patch) =>
    set((s) => {
      for (const [projectId, pw] of Object.entries(s.projectWorkspaces)) {
        const pane = pw.panes[paneId];
        if (!pane) continue;
        const panes = { ...pw.panes, [paneId]: applyFilesView(pane, patch) };
        return { projectWorkspaces: { ...s.projectWorkspaces, [projectId]: { ...pw, panes } } };
      }
      return s;
    }),

  releaseAgent: (agentId) =>
    set((s) => {
      let projectWorkspaces = s.projectWorkspaces;
      const cwd = { ...s.paneCwd };
      const exit = { ...s.paneLastExit };
      for (const [projectId, pw] of Object.entries(s.projectWorkspaces)) {
        const next = releaseAgentPanes(pw, agentId);
        if (!next) continue;
        projectWorkspaces = { ...projectWorkspaces, [projectId]: next };
        // T112: a closed tab's panes take their OSC 7/133 state with them
        for (const pid of Object.keys(pw.panes)) {
          if (next.panes[pid]) continue;
          delete cwd[pid];
          delete exit[pid];
        }
      }
      if (projectWorkspaces === s.projectWorkspaces) return s;
      return { ...withFocus({ ...s, projectWorkspaces }, {}), paneCwd: cwd, paneLastExit: exit };
    }),

  setFocusedPane: (paneId) =>
    set((s) => {
      if (paneId === null) return { focusedPaneId: null };
      // Only a pane of the active tab: another tab's is focused through setActiveTab(tab, pane)
      const tab = activeTabOf(getPw(s));
      return tab && layoutHasPane(tab.layout, paneId) ? { focusedPaneId: paneId } : s;
    }),

  extractPaneToNewTab: (sourceTabId, paneId) =>
    set((s) => {
      const pw = getPw(s);
      const sourceTab = pw.tabs.find((t) => t.id === sourceTabId);
      if (!sourceTab) return s;
      const pane = pw.panes[paneId];
      if (!pane) return s;

      const allPaneIds = collectPaneIds(sourceTab.layout);
      if (allPaneIds.length <= 1) return s;

      const newLayout = removeNodeByPaneId(sourceTab.layout, paneId);
      if (!newLayout) return s;

      const newTab: WorkspaceTab = {
        id: nanoid(8),
        label: pane.type === "terminal" ? "Terminal" : `Tab ${pw.tabs.length + 1}`,
        layout: { type: "pane", paneId },
      };

      const sourceIdx = pw.tabs.findIndex((t) => t.id === sourceTabId);
      const newTabs = [...pw.tabs];
      newTabs[sourceIdx] = { ...sourceTab, layout: newLayout };
      newTabs.splice(sourceIdx + 1, 0, newTab);

      return withFocus(s, { tabs: newTabs }, newTab.id, paneId);
    }),

  closeTarget: (target) => {
    const tab = getPw(get()).tabs.find((t) => t.id === target.tabId);
    if (!tab) return;
    if (target.closesTab) {
      get().removeTab(target.tabId);
      return;
    }
    if (layoutHasPane(tab.layout, target.paneId)) get().removePane(target.tabId, target.paneId);
  },

  closeFocusedPane: () => {
    const target = resolveCloseTarget(getPw(get()), get().focusedPaneId);
    if (target) get().closeTarget(target);
  },

  rememberClosed: (entry) => set((s) => ({ recentlyClosed: pushClosed(s.recentlyClosed, entry) })),

  restoreClosed: (entryId) => {
    const entry = get().recentlyClosed.find((e) => e.id === entryId);
    if (!entry || entry.projectId !== get()._activeProjectId) return null;
    const restored = restoreClosedInto(getPw(get()), entry);
    set((s) => ({
      ...withFocus(s, restored.pw, restored.tabId, restored.paneId),
      recentlyClosed: s.recentlyClosed.filter((e) => e.id !== entryId),
    }));
    return { tabId: restored.tabId, paneId: restored.paneId };
  },

  splitFocusedPane: (direction) => {
    const pw = getPw(get());
    if (pw.activeTabId) {
      get().splitPane(pw.activeTabId, activePaneId(pw, get().focusedPaneId), direction, "empty");
    }
  },

  getActiveTab: () => {
    const pw = getPw(get());
    return pw.tabs.find((t) => t.id === pw.activeTabId) ?? null;
  },

  ensureDefaultTab: () => {
    const pw = getPw(get());
    if (pw.tabs.length === 0) {
      get().addTab("Workspace");
    }
  },

  equalizeSplits: (tabId) =>
    set((s) => {
      const pw = getPw(s);
      const tab = pw.tabs.find((t) => t.id === tabId);
      if (!tab || tab.layout.type !== "split") return s;

      const equalize = (node: LayoutNode): LayoutNode => {
        if (node.type === "pane") return node;
        const count = node.children.length;
        const equalSize = 100 / count;
        return {
          ...node,
          sizes: node.children.map(() => equalSize),
          children: node.children.map(equalize),
        };
      };

      const newLayout = equalize(tab.layout);
      return setPw(s, {
        tabs: pw.tabs.map((t) => (t.id === tabId ? { ...t, layout: newLayout } : t)),
      });
    }),

  setSplitSizes: (tabId, path, sizes) =>
    set((s) => {
      const pw = getPw(s);
      const tab = pw.tabs.find((t) => t.id === tabId);
      if (!tab) return s;
      const update = (node: LayoutNode, depth: number): LayoutNode => {
        if (node.type === "pane") return node;
        if (depth === path.length) {
          const same =
            node.sizes.length === sizes.length &&
            node.sizes.every((v, i) => Math.abs(v - (sizes[i] ?? 0)) < 0.1);
          return same ? node : { ...node, sizes };
        }
        const index = path[depth] ?? -1;
        const child = node.children[index];
        if (!child) return node;
        const next = update(child, depth + 1);
        return next === child
          ? node
          : { ...node, children: node.children.map((c, i) => (i === index ? next : c)) };
      };
      const layout = update(tab.layout, 0);
      if (layout === tab.layout) return s;
      return setPw(s, { tabs: pw.tabs.map((t) => (t.id === tabId ? { ...t, layout } : t)) });
    }),

  setPaneCwd: (paneId, cwd) =>
    set((s) => {
      if (s.paneCwd[paneId] === cwd) return s;
      return { paneCwd: { ...s.paneCwd, [paneId]: cwd } };
    }),

  setPaneLastExit: (paneId, code) =>
    set((s) => {
      if (s.paneLastExit[paneId] === code) return s;
      return { paneLastExit: { ...s.paneLastExit, [paneId]: code } };
    }),
});
