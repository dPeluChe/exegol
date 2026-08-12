import type { StateCreator } from "zustand";
import type { CustomLayoutPreset, LayoutPresetId } from "../../lib/layout-presets";

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
export interface ProjectWorkspace {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  panes: Record<string, Pane>;
}

// ─── Store interface ────────────────────────────────────────────────────────

export interface WorkspaceStore {
  /** All workspace state keyed by projectId */
  projectWorkspaces: Record<string, ProjectWorkspace>;
  /** Mirror of app store's activeProjectId — kept in sync so selectors re-evaluate on project switch */
  _activeProjectId: string | null;
  /** Focused pane (global — only one pane focused at a time) */
  focusedPaneId: string | null;
  /** User-saved layout templates — global, not per-project */
  customLayouts: CustomLayoutPreset[];
  /**
   * Panes currently displayed in a floating (always-on-top) window.
   * In-memory only — resets on reload. Keyed by paneId.
   */
  floatingPanes: Record<string, { type: "terminal" | "browser"; openedAt: number }>;
  /** Per-pane current working directory reported via OSC 7 (T112). In-memory only. */
  paneCwd: Record<string, string>;
  /** Per-pane last command exit code reported via OSC 133;D (T112). In-memory only. */
  paneLastExit: Record<string, number | null>;

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
  removePane: (tabId: string, paneId: string) => void;
  splitPane: (
    tabId: string,
    paneId: string | null,
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
  /** Mark a pane as currently shown in a floating window */
  markPaneFloating: (paneId: string, type: "terminal" | "browser") => void;
  /** Remove the floating marker (used when the floating window closes) */
  unmarkPaneFloating: (paneId: string) => void;
  /** Update the cwd reported via OSC 7 for a pane (T112) */
  setPaneCwd: (paneId: string, cwd: string) => void;
  /** Update the last command exit code reported via OSC 133;D for a pane (T112) */
  setPaneLastExit: (paneId: string, code: number | null) => void;
}

/** Slice creator typed against the full composed store (persist middleware applied). */
export type WorkspaceSliceCreator<TSlice> = StateCreator<
  WorkspaceStore,
  [["zustand/persist", unknown]],
  [],
  TSlice
>;
