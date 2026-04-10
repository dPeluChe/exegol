import { nanoid } from "nanoid";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type CustomLayoutPreset,
  computeCustomPresetTransformation,
  computePresetTransformation,
  getLayoutPreset,
  type LayoutPresetId,
  templateFromLayout,
} from "../lib/layout-presets";
import { useAppStore } from "./app";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PaneType = "terminal" | "browser" | "files" | "git" | "empty";

export interface Pane {
  id: string;
  type: PaneType;
  agentId?: string;
  url?: string;
  filePath?: string;
  /** Set when recovery validation fails (agent deleted, file missing, etc.) */
  invalidReason?: string;
}

export interface RecoveryToken {
  type: PaneType;
  agentId?: string;
  filePath?: string;
  url?: string;
  metadata?: {
    tabLabel?: string;
    cliType?: string;
    taskDescription?: string;
  };
}

export type LayoutNode =
  | { type: "pane"; paneId: string }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      children: LayoutNode[];
      sizes: number[];
    };

export interface WorkspaceTab {
  id: string;
  label: string;
  layout: LayoutNode;
}

/** Per-project workspace state */
interface ProjectWorkspace {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  panes: Record<string, Pane>;
}

// ─── Store interface ────────────────────────────────────────────────────────

interface WorkspaceStore {
  /** All workspace state keyed by projectId */
  projectWorkspaces: Record<string, ProjectWorkspace>;
  /** Mirror of app store's activeProjectId — kept in sync so selectors re-evaluate on project switch */
  _activeProjectId: string | null;
  /** Focused pane (global — only one pane focused at a time) */
  focusedPaneId: string | null;
  /** User-saved layout templates — global, not per-project */
  customLayouts: CustomLayoutPreset[];

  // Tab actions
  addTab: (label?: string) => string;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  renameTab: (tabId: string, label: string) => void;
  reorderTab: (fromIndex: number, toIndex: number) => void;
  mergeTabIntoSplit: (
    sourceTabId: string,
    targetTabId: string,
    direction: "horizontal" | "vertical",
    sourceFirst?: boolean,
  ) => void;

  // Pane actions
  addPane: (tabId: string, type: PaneType, config?: { agentId?: string; url?: string }) => string;
  removePane: (tabId: string, paneId: string) => void;
  splitPane: (
    tabId: string,
    paneId: string,
    direction: "horizontal" | "vertical",
    newPaneType: PaneType,
    config?: { agentId?: string; url?: string },
  ) => void;
  updatePane: (paneId: string, updates: Partial<Pane>) => void;
  setFocusedPane: (paneId: string | null) => void;

  extractPaneToNewTab: (sourceTabId: string, paneId: string) => void;
  closeFocusedPane: () => void;

  // Derived
  getActiveTab: () => WorkspaceTab | null;
  ensureDefaultTab: () => void;
  getRecoveryToken: (paneId: string) => RecoveryToken | null;
  invalidatePane: (paneId: string, reason: string) => void;
  /** Reset all split sizes in the active tab to equal proportions */
  equalizeSplits: (tabId: string) => void;
  /**
   * Replace the tab layout with a built-in preset, reusing existing panes.
   * Returns the IDs of any new panes that were created as terminal slots,
   * so the caller can spawn shell agents for them.
   */
  applyLayoutPreset: (tabId: string, presetId: LayoutPresetId) => { terminalsToSpawn: string[] };
  /** Apply a user-saved custom layout template to a tab */
  applyCustomLayout: (tabId: string, customId: string) => void;
  /** Save the current tab layout as a named custom preset */
  saveCustomLayout: (tabId: string, name: string) => string | null;
  /** Delete a user-saved custom preset */
  deleteCustomLayout: (customId: string) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function createEmptyPane(): Pane {
  return { id: nanoid(8), type: "empty" };
}

const EMPTY_PW: ProjectWorkspace = { tabs: [], activeTabId: null, panes: {} };

function getPw(state: WorkspaceStore): ProjectWorkspace {
  const pid = state._activeProjectId;
  if (!pid) return EMPTY_PW;
  return state.projectWorkspaces[pid] ?? EMPTY_PW;
}

function setPw(state: WorkspaceStore, updates: Partial<ProjectWorkspace>): Partial<WorkspaceStore> {
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

function removeNodeByPaneId(node: LayoutNode, paneId: string): LayoutNode | null {
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

function findFirstPaneId(node: LayoutNode): string | null {
  if (node.type === "pane") return node.paneId;
  for (const child of node.children) {
    const found = findFirstPaneId(child);
    if (found) return found;
  }
  return null;
}

function splitNodeByPaneId(
  node: LayoutNode,
  paneId: string,
  direction: "horizontal" | "vertical",
  newPaneId: string,
): LayoutNode {
  if (node.type === "pane") {
    if (node.paneId === paneId) {
      return {
        type: "split",
        direction,
        children: [node, { type: "pane", paneId: newPaneId }],
        sizes: [50, 50],
      };
    }
    return node;
  }

  const newChildren = node.children.map((child) =>
    splitNodeByPaneId(child, paneId, direction, newPaneId),
  );
  const changed = newChildren.some((c, i) => c !== node.children[i]);
  return changed ? { ...node, children: newChildren } : node;
}

function collectPaneIds(node: LayoutNode): string[] {
  if (node.type === "pane") return [node.paneId];
  return node.children.flatMap(collectPaneIds);
}

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

// ─── Store ──────────────────────────────────────────────────────────────────

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      projectWorkspaces: {},
      _activeProjectId: useAppStore.getState().activeProjectId,
      focusedPaneId: null,
      customLayouts: [],

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
          for (const pid of paneIds) {
            delete newPanes[pid];
          }

          const newTabs = pw.tabs.filter((t) => t.id !== tabId);
          let newActiveTabId = pw.activeTabId;
          if (pw.activeTabId === tabId) {
            const neighborIdx = Math.min(idx, newTabs.length - 1);
            newActiveTabId = neighborIdx >= 0 ? (newTabs[neighborIdx]?.id ?? null) : null;
          }

          return setPw(s, { tabs: newTabs, activeTabId: newActiveTabId, panes: newPanes });
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

      addPane: (tabId, type, config) => {
        const pane: Pane = {
          id: nanoid(8),
          type,
          agentId: config?.agentId,
          url: config?.url,
        };
        set((s) => {
          const pw = getPw(s);
          const tab = pw.tabs.find((t) => t.id === tabId);
          if (!tab) return s;

          const firstPaneId = findFirstPaneId(tab.layout);
          if (!firstPaneId) return s;

          const newLayout = splitNodeByPaneId(tab.layout, firstPaneId, "horizontal", pane.id);

          return setPw(s, {
            tabs: pw.tabs.map((t) => (t.id === tabId ? { ...t, layout: newLayout } : t)),
            panes: { ...pw.panes, [pane.id]: pane },
          });
        });
        return pane.id;
      },

      removePane: (tabId, paneId) =>
        set((s) => {
          const pw = getPw(s);
          const tab = pw.tabs.find((t) => t.id === tabId);
          if (!tab) return s;

          const newLayout = removeNodeByPaneId(tab.layout, paneId);
          const { [paneId]: _, ...restPanes } = pw.panes;

          if (!newLayout) {
            const emptyPane = createEmptyPane();
            return setPw(s, {
              tabs: pw.tabs.map((t) =>
                t.id === tabId
                  ? { ...t, layout: { type: "pane" as const, paneId: emptyPane.id } }
                  : t,
              ),
              panes: { ...restPanes, [emptyPane.id]: emptyPane },
            });
          }

          return setPw(s, {
            tabs: pw.tabs.map((t) => (t.id === tabId ? { ...t, layout: newLayout } : t)),
            panes: restPanes,
          });
        }),

      splitPane: (tabId, paneId, direction, newPaneType, config) =>
        set((s) => {
          const pw = getPw(s);
          const tab = pw.tabs.find((t) => t.id === tabId);
          if (!tab) return s;

          const newPane: Pane = {
            id: nanoid(8),
            type: newPaneType,
            agentId: config?.agentId,
            url: config?.url,
          };

          const newLayout = splitNodeByPaneId(tab.layout, paneId, direction, newPane.id);

          return setPw(s, {
            tabs: pw.tabs.map((t) => (t.id === tabId ? { ...t, layout: newLayout } : t)),
            panes: { ...pw.panes, [newPane.id]: newPane },
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

      getRecoveryToken: (paneId) => {
        const pw = getPw(get());
        const pane = pw.panes[paneId];
        if (!pane) return null;
        return {
          type: pane.type,
          agentId: pane.agentId,
          filePath: pane.filePath,
          url: pane.url,
        };
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

      applyLayoutPreset: (tabId, presetId) => {
        const state = get();
        const pw = getPw(state);
        const tab = pw.tabs.find((t) => t.id === tabId);
        const preset = getLayoutPreset(presetId);
        if (!tab || !preset) return { terminalsToSpawn: [] };

        const existingIds = collectPaneIds(tab.layout);
        const { layout, newPanes, terminalsToSpawn } = computePresetTransformation(
          preset,
          existingIds,
        );

        const panesRecord: Record<string, Pane> = { ...pw.panes };
        for (const p of newPanes) panesRecord[p.id] = p;

        set((s) =>
          setPw(s, {
            tabs: pw.tabs.map((t) => (t.id === tabId ? { ...t, layout } : t)),
            panes: panesRecord,
          }),
        );
        return { terminalsToSpawn };
      },

      applyCustomLayout: (tabId, customId) =>
        set((s) => {
          const pw = getPw(s);
          const tab = pw.tabs.find((t) => t.id === tabId);
          const custom = s.customLayouts.find((c) => c.id === customId);
          if (!tab || !custom) return s;

          const existingIds = collectPaneIds(tab.layout);
          const { layout, newPanes } = computeCustomPresetTransformation(custom, existingIds);

          const panesRecord: Record<string, Pane> = { ...pw.panes };
          for (const p of newPanes) panesRecord[p.id] = p;

          return setPw(s, {
            tabs: pw.tabs.map((t) => (t.id === tabId ? { ...t, layout } : t)),
            panes: panesRecord,
          });
        }),

      saveCustomLayout: (tabId, name) => {
        const state = get();
        const pw = getPw(state);
        const tab = pw.tabs.find((t) => t.id === tabId);
        if (!tab) return null;
        const trimmed = name.trim();
        if (!trimmed) return null;

        const { template, slots } = templateFromLayout(tab.layout);
        const custom: CustomLayoutPreset = {
          id: nanoid(8),
          name: trimmed,
          template,
          slots,
          createdAt: Date.now(),
        };
        set((s) => ({ customLayouts: [...s.customLayouts, custom] }));
        return custom.id;
      },

      deleteCustomLayout: (customId) =>
        set((s) => ({
          customLayouts: s.customLayouts.filter((c) => c.id !== customId),
        })),

      invalidatePane: (paneId, reason) =>
        set((s) => {
          const pw = getPw(s);
          const existing = pw.panes[paneId];
          if (!existing) return s;
          return setPw(s, {
            panes: {
              ...pw.panes,
              [paneId]: { ...existing, type: "empty", agentId: undefined, invalidReason: reason },
            },
          });
        }),
    }),
    {
      name: "exegol-workspace",
      partialize: (state) => ({
        projectWorkspaces: state.projectWorkspaces,
        customLayouts: state.customLayouts,
      }),
      // Bump version when schema changes to trigger migration
      version: 1,
      migrate: (persisted: unknown, version: number) => {
        if (version === 0) {
          // v0 → v1: migrate flat {tabs, panes, activeTabId} to projectWorkspaces
          const old = persisted as Record<string, unknown>;
          if (old.tabs && !old.projectWorkspaces) {
            // Can't determine which project these belong to, so discard old state
            return { projectWorkspaces: {} };
          }
        }
        return persisted as Record<string, unknown>;
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Sync _activeProjectId from app store after rehydration
        state._activeProjectId = useAppStore.getState().activeProjectId;

        for (const pw of Object.values(state.projectWorkspaces)) {
          const cleaned: Record<string, Pane> = {};
          for (const [id, pane] of Object.entries(pw.panes)) {
            const { invalidReason: _, ...rest } = pane;
            cleaned[id] = rest;
          }
          pw.panes = cleaned;

          pw.tabs = pw.tabs.map((tab) => {
            const paneIds = collectPaneIds(tab.layout);
            const allEmpty = paneIds.every((pid) => cleaned[pid]?.type === "empty");
            if (allEmpty && paneIds.length > 1) {
              const keepId = paneIds[0] as string;
              for (const pid of paneIds) {
                if (pid !== keepId) delete cleaned[pid];
              }
              return { ...tab, layout: { type: "pane" as const, paneId: keepId } };
            }
            return tab;
          });
          pw.panes = cleaned;
        }
      },
    },
  ),
);

// ─── Sync activeProjectId from app store → workspace store ──────────────────

useAppStore.subscribe((state) => {
  const current = useWorkspaceStore.getState()._activeProjectId;
  if (state.activeProjectId !== current) {
    useWorkspaceStore.setState({ _activeProjectId: state.activeProjectId });
  }
});

// ─── Utility ────────────────────────────────────────────────────────────────

/** Get current project's workspace from outside React (imperative). */
export function getProjectState(): ProjectWorkspace {
  return getPw(useWorkspaceStore.getState());
}

export { collectPaneIds, findFirstPaneId };
