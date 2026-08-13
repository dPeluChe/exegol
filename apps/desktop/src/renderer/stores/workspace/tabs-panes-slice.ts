import { nanoid } from "nanoid";
import { useAppStore } from "../app";
import { useTerminalStore } from "../terminals";
import {
  collectPaneIds,
  createEmptyPane,
  findFirstPaneId,
  getPw,
  removeNodeByPaneId,
  setPw,
  splitNodeByPaneId,
} from "./helpers";
import type {
  LayoutNode,
  Pane,
  WorkspaceSliceCreator,
  WorkspaceStore,
  WorkspaceTab,
} from "./types";

export type TabsPanesSlice = Pick<
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
  | "setFocusedPane"
  | "extractPaneToNewTab"
  | "closeFocusedPane"
  | "getActiveTab"
  | "ensureDefaultTab"
  | "equalizeSplits"
  | "setPaneCwd"
  | "setPaneLastExit"
>;

export const createTabsPanesSlice: WorkspaceSliceCreator<TabsPanesSlice> = (set, get) => ({
  projectWorkspaces: {},
  _activeProjectId: useAppStore.getState().activeProjectId,
  focusedPaneId: null,
  paneCwd: {},
  paneLastExit: {},

  addTab: (label) => {
    const pane = createEmptyPane();
    const pw = getPw(get());
    const tab: WorkspaceTab = {
      id: nanoid(8),
      label: label ?? `Tab ${pw.tabs.length + 1}`,
      layout: { type: "pane", paneId: pane.id },
    };
    set((s) => ({
      ...setPw(s, {
        tabs: [...pw.tabs, tab],
        activeTabId: tab.id,
        panes: { ...pw.panes, [pane.id]: pane },
      }),
      focusedPaneId: pane.id,
    }));
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
        ...setPw(s, { tabs: newTabs, activeTabId: newActiveTabId, panes: newPanes }),
        paneCwd: cwd,
        paneLastExit: exit,
      };
    }),

  setActiveTab: (tabId) => {
    const pw = getPw(get());
    const tab = pw.tabs.find((t) => t.id === tabId);
    const firstPane = tab ? findFirstPaneId(tab.layout) : null;
    set((s) => ({
      ...setPw(s, { activeTabId: tabId }),
      focusedPaneId: firstPane,
    }));
  },

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

      return setPw(s, { tabs: newTabs, activeTabId: targetTabId });
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
          ...setPw(s, {
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
        ...setPw(s, {
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

      // T95: Fall back to focusedPaneId, then first pane in layout
      const targetId = paneId || s.focusedPaneId || findFirstPaneId(tab.layout);
      if (!targetId) return s;

      const newPane: Pane = {
        id: nanoid(8),
        type: newPaneType,
        agentId: config?.agentId,
        url: config?.url,
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
      if (!withoutSource || !collectPaneIds(withoutSource).includes(targetPaneId)) return s;

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
      return {
        ...setPw(s, {
          panes: { ...pw.panes, [paneId]: { ...existing, ...updates } },
        }),
        focusedPaneId: paneId,
      };
    }),

  setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),

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

      return {
        ...setPw(s, { tabs: newTabs, activeTabId: newTab.id }),
        focusedPaneId: paneId,
      };
    }),

  closeFocusedPane: () => {
    const pw = getPw(get());
    const { focusedPaneId } = get();
    if (!focusedPaneId || !pw.activeTabId) return;

    const tab = pw.tabs.find((t) => t.id === pw.activeTabId);
    if (!tab) return;

    const allPaneIds = collectPaneIds(tab.layout);
    if (allPaneIds.length <= 1) {
      get().removeTab(pw.activeTabId);
    } else {
      get().removePane(pw.activeTabId, focusedPaneId);
      const updatedPw = getPw(get());
      const updatedTab = updatedPw.tabs.find((t) => t.id === pw.activeTabId);
      if (updatedTab) {
        const nextPaneId = findFirstPaneId(updatedTab.layout);
        set({ focusedPaneId: nextPaneId });
      }
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
