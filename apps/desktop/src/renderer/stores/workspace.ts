import { create } from "zustand";
import { persist } from "zustand/middleware";
import { projectSwitchStarted } from "../lib/project-switch-log";
import { useAppStore } from "./app";
import { createCustomLayoutsSlice } from "./workspace/custom-layouts-slice";
import { createFloatingPanesSlice } from "./workspace/floating-panes-slice";
import {
  activePaneId,
  collectPaneIds,
  findFirstPaneId,
  getPw,
  layoutHasPane,
  mountedTerminals,
  paneInTabOrFirst,
  pwOf,
  switchProject,
} from "./workspace/helpers";
import { migrateWorkspaceState, onWorkspaceRehydrate } from "./workspace/recovery";
import { createTabsPanesSlice } from "./workspace/tabs-panes-slice";
import type { Pane, ProjectWorkspace, WorkspaceStore, WorkspaceTab } from "./workspace/types";

export type {
  ClosedEntry,
  ClosedSession,
  CloseTarget,
  EditorSpot,
  FilesView,
  FilesViewPatch,
  LayoutNode,
  Pane,
  PaneType,
  WorkspaceTab,
} from "./workspace/types";

// ─── Selectors (resolve active project) ─────────────────────────────────────

/** Select current project's tabs. Use: useWorkspaceStore(selectTabs) */
export function selectTabs(s: WorkspaceStore): WorkspaceTab[] {
  return getPw(s).tabs;
}
export function selectActiveTabId(s: WorkspaceStore): string | null {
  return getPw(s).activeTabId;
}
export function selectPanes(s: WorkspaceStore): Record<string, Pane> {
  return getPw(s).panes;
}

// ─── Selectors of one project (a kept mounted layer reads its own, not the active one) ──

export const selectPanesOf =
  (projectId: string | null) =>
  (s: WorkspaceStore): Record<string, Pane> =>
    pwOf(s, projectId).panes;
export const selectTabsOf =
  (projectId: string | null) =>
  (s: WorkspaceStore): WorkspaceTab[] =>
    pwOf(s, projectId).tabs;
export const selectActiveTabIdOf =
  (projectId: string | null) =>
  (s: WorkspaceStore): string | null =>
    pwOf(s, projectId).activeTabId;

// ─── Store (composed from slices) ───────────────────────────────────────────

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (...args) => ({
      ...createTabsPanesSlice(...args),
      ...createCustomLayoutsSlice(...args),
      ...createFloatingPanesSlice(...args),
    }),
    {
      name: "exegol-workspace",
      partialize: (state) => ({
        projectWorkspaces: state.projectWorkspaces,
        customLayouts: state.customLayouts,
        recentlyClosed: state.recentlyClosed,
      }),
      // Bump version when schema changes to trigger migration
      version: 1,
      migrate: migrateWorkspaceState,
      onRehydrateStorage: () => onWorkspaceRehydrate,
    },
  ),
);

// ─── Sync activeProjectId from app store → workspace store ──────────────────

useAppStore.subscribe((state) => {
  const ws = useWorkspaceStore.getState();
  const next = state.activeProjectId;
  if (next !== ws._activeProjectId) {
    const kept = next && ws.mountedProjects.includes(next);
    projectSwitchStarted(next, kept ? mountedTerminals(pwOf(ws, next), ws.floatingPanes) : 0);
    useWorkspaceStore.setState(switchProject(ws, next));
  }
});

// ─── Utility ────────────────────────────────────────────────────────────────

/** Get current project's workspace from outside React (imperative). */
export function getProjectState(): ProjectWorkspace {
  return getPw(useWorkspaceStore.getState());
}

/**
 * Returns the focused pane ID if it belongs to the given tab's layout,
 * otherwise falls back to the first pane in the layout.
 */
export function getFocusedOrFirstPaneId(tab: WorkspaceTab): string | null {
  return paneInTabOrFirst(tab, useWorkspaceStore.getState().focusedPaneId);
}

/** The pane keyboard actions act on: always one of the active tab (activePaneId) */
export function getActivePaneId(): string | null {
  const s = useWorkspaceStore.getState();
  return activePaneId(getPw(s), s.focusedPaneId);
}

/** Selector form of getActivePaneId */
export function selectActivePaneId(s: WorkspaceStore): string | null {
  return activePaneId(getPw(s), s.focusedPaneId);
}

export { collectPaneIds, findFirstPaneId, layoutHasPane };
