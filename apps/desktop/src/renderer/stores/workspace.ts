import { nanoid } from "nanoid";
import { create } from "zustand";
import { persist } from "zustand/middleware";

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

/**
 * Recovery token — portable snapshot of a pane's state for reconstruction.
 * Inspired by Tabby's getRecoveryToken() pattern.
 */
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

// ─── Store interface ────────────────────────────────────────────────────────

interface WorkspaceStore {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  focusedPaneId: string | null;
  panes: Record<string, Pane>;

  // Tab actions
  addTab: (label?: string) => string;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  renameTab: (tabId: string, label: string) => void;

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

  /** Close the focused pane. If it's the last pane, close the tab. */
  closeFocusedPane: () => void;

  // Derived
  getActiveTab: () => WorkspaceTab | null;

  /** Ensure at least one tab exists (call on mount) */
  ensureDefaultTab: () => void;

  /** Extract recovery token for a pane (for persistence/sharing). */
  getRecoveryToken: (paneId: string) => RecoveryToken | null;

  /** Mark a pane as invalid (agent deleted, file missing, etc.) → converts to empty with error. */
  invalidatePane: (paneId: string, reason: string) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function createEmptyPane(): Pane {
  return { id: nanoid(8), type: "empty" };
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

  // Renormalize sizes
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

// ─── Store ──────────────────────────────────────────────────────────────────

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      focusedPaneId: null,
      panes: {},

      addTab: (label) => {
        const pane = createEmptyPane();
        const tab: WorkspaceTab = {
          id: nanoid(8),
          label: label ?? `Tab ${get().tabs.length + 1}`,
          layout: { type: "pane", paneId: pane.id },
        };
        set((s) => ({
          tabs: [...s.tabs, tab],
          activeTabId: tab.id,
          focusedPaneId: pane.id,
          panes: { ...s.panes, [pane.id]: pane },
        }));
        return tab.id;
      },

      removeTab: (tabId) =>
        set((s) => {
          const idx = s.tabs.findIndex((t) => t.id === tabId);
          if (idx === -1) return s;

          // biome-ignore lint/style/noNonNullAssertion: layout tree guarantees non-null
          const tab = s.tabs[idx]!;
          const paneIds = collectPaneIds(tab.layout);
          const newPanes = { ...s.panes };
          for (const pid of paneIds) {
            delete newPanes[pid];
          }

          const newTabs = s.tabs.filter((t) => t.id !== tabId);
          let newActiveTabId = s.activeTabId;
          if (s.activeTabId === tabId) {
            // Pick neighbor
            const neighborIdx = Math.min(idx, newTabs.length - 1);
            newActiveTabId = neighborIdx >= 0 ? (newTabs[neighborIdx]?.id ?? null) : null;
          }

          return {
            tabs: newTabs,
            activeTabId: newActiveTabId,
            panes: newPanes,
          };
        }),

      setActiveTab: (tabId) => {
        const tab = get().tabs.find((t) => t.id === tabId);
        const firstPane = tab ? findFirstPaneId(tab.layout) : null;
        set({ activeTabId: tabId, focusedPaneId: firstPane });
      },

      renameTab: (tabId, label) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, label } : t)),
        })),

      addPane: (tabId, type, config) => {
        const pane: Pane = {
          id: nanoid(8),
          type,
          agentId: config?.agentId,
          url: config?.url,
        };
        set((s) => {
          const tab = s.tabs.find((t) => t.id === tabId);
          if (!tab) return s;

          // Find the first pane and split to add the new one
          const firstPaneId = findFirstPaneId(tab.layout);
          if (!firstPaneId) return s;

          const newLayout = splitNodeByPaneId(tab.layout, firstPaneId, "horizontal", pane.id);

          return {
            tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, layout: newLayout } : t)),
            panes: { ...s.panes, [pane.id]: pane },
          };
        });
        return pane.id;
      },

      removePane: (tabId, paneId) =>
        set((s) => {
          const tab = s.tabs.find((t) => t.id === tabId);
          if (!tab) return s;

          const newLayout = removeNodeByPaneId(tab.layout, paneId);
          const { [paneId]: _, ...restPanes } = s.panes;

          // If no panes left, replace with an empty pane
          if (!newLayout) {
            const emptyPane = createEmptyPane();
            return {
              tabs: s.tabs.map((t) =>
                t.id === tabId
                  ? {
                      ...t,
                      layout: { type: "pane" as const, paneId: emptyPane.id },
                    }
                  : t,
              ),
              panes: { ...restPanes, [emptyPane.id]: emptyPane },
            };
          }

          return {
            tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, layout: newLayout } : t)),
            panes: restPanes,
          };
        }),

      splitPane: (tabId, paneId, direction, newPaneType, config) =>
        set((s) => {
          const tab = s.tabs.find((t) => t.id === tabId);
          if (!tab) return s;

          const newPane: Pane = {
            id: nanoid(8),
            type: newPaneType,
            agentId: config?.agentId,
            url: config?.url,
          };

          const newLayout = splitNodeByPaneId(tab.layout, paneId, direction, newPane.id);

          return {
            tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, layout: newLayout } : t)),
            panes: { ...s.panes, [newPane.id]: newPane },
          };
        }),

      updatePane: (paneId, updates) =>
        set((s) => {
          const existing = s.panes[paneId];
          if (!existing) return s;
          return {
            focusedPaneId: paneId,
            panes: { ...s.panes, [paneId]: { ...existing, ...updates } },
          };
        }),

      setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),

      closeFocusedPane: () => {
        const { focusedPaneId, activeTabId, tabs } = get();
        if (!focusedPaneId || !activeTabId) return;

        const tab = tabs.find((t) => t.id === activeTabId);
        if (!tab) return;

        // If the focused pane is the only pane in the tab, close the tab
        const allPaneIds = collectPaneIds(tab.layout);
        if (allPaneIds.length <= 1) {
          get().removeTab(activeTabId);
        } else {
          get().removePane(activeTabId, focusedPaneId);
          // Focus the first remaining pane
          const updatedTab = get().tabs.find((t) => t.id === activeTabId);
          if (updatedTab) {
            const nextPaneId = findFirstPaneId(updatedTab.layout);
            set({ focusedPaneId: nextPaneId });
          }
        }
      },

      getActiveTab: () => {
        const { tabs, activeTabId } = get();
        return tabs.find((t) => t.id === activeTabId) ?? null;
      },

      ensureDefaultTab: () => {
        if (get().tabs.length === 0) {
          get().addTab("Workspace");
        }
      },

      getRecoveryToken: (paneId) => {
        const pane = get().panes[paneId];
        if (!pane) return null;
        return {
          type: pane.type,
          agentId: pane.agentId,
          filePath: pane.filePath,
          url: pane.url,
        };
      },

      invalidatePane: (paneId, reason) =>
        set((s) => {
          const existing = s.panes[paneId];
          if (!existing) return s;
          return {
            panes: {
              ...s.panes,
              [paneId]: { ...existing, type: "empty", agentId: undefined, invalidReason: reason },
            },
          };
        }),
    }),
    {
      name: "exegol-workspace",
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        panes: state.panes,
      }),
      // On rehydrate: clear invalid flags + collapse empty-only splits to single pane
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const cleaned: Record<string, Pane> = {};
        for (const [id, pane] of Object.entries(state.panes)) {
          const { invalidReason: _, ...rest } = pane;
          cleaned[id] = rest;
        }
        state.panes = cleaned;

        // Collapse tabs where ALL panes are empty → single empty pane
        state.tabs = state.tabs.map((tab) => {
          const paneIds = collectPaneIds(tab.layout);
          const allEmpty = paneIds.every((pid) => cleaned[pid]?.type === "empty");
          if (allEmpty && paneIds.length > 1) {
            // Remove extra empty panes, keep only one
            const keepId = paneIds[0] as string;
            for (const pid of paneIds) {
              if (pid !== keepId) delete cleaned[pid];
            }
            return { ...tab, layout: { type: "pane" as const, paneId: keepId } };
          }
          return tab;
        });
        state.panes = cleaned;
      },
    },
  ),
);

// ─── Utility ────────────────────────────────────────────────────────────────

function collectPaneIds(node: LayoutNode): string[] {
  if (node.type === "pane") return [node.paneId];
  return node.children.flatMap(collectPaneIds);
}

export { collectPaneIds, findFirstPaneId };
