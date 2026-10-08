import type { StateCreator } from "zustand";
import type { PageSize } from "../../lib/browser-viewports";
import type {
  CustomLayoutPreset,
  CustomLayoutSlot,
  LayoutPresetId,
  SlotAgent,
} from "../../lib/layout-presets";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PaneType = "terminal" | "browser" | "files" | "git" | "empty";

export interface Pane {
  id: string;
  type: PaneType;
  agentId?: string;
  url?: string;
  filePath?: string;
  /** Files pane: the file it shows (the tree roots at filePath or the project) */
  openFile?: string;
  /** Files pane: what to restore when it mounts again (a project switch unmounts it) */
  files?: FilesView;
  /** Browser pane: the size the page is shown at (device toolbar); absent fits the pane */
  viewport?: PageSize;
  /** Browser pane: the tab's one pane that URLs clicked in its terminals open in */
  linkPreview?: boolean;
  /** Set when recovery validation fails (agent deleted, file missing, etc.) */
  invalidReason?: string;
}

export interface EditorSpot {
  path: string;
  line: number;
  column: number;
  scrollTop: number;
}

export interface FilesView {
  /** Tree folders left open */
  expanded?: string[];
  /** Code or the rendered view (Preview, Tree); absent: the file type's default */
  mode?: "code" | "rendered";
  /** Where the editor was in `path` */
  cursor?: EditorSpot;
  /** HTML preview runs the page's scripts (off by default) */
  runScripts?: boolean;
}

/** A files pane's view change; `openFile` null closes the file */
export type FilesViewPatch = Partial<FilesView> & { openFile?: string | null };

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
  /** The pane focused when the user left this tab: going back to it restores it */
  lastFocusedPaneId?: string | null;
}

/** What a close removes: `paneIds` from tab `tabId`, the whole tab when `closesTab` */
export interface CloseTarget {
  tabId: string;
  paneId: string;
  paneIds: string[];
  closesTab: boolean;
}

/** Where a closed pane sat in its tab */
export interface PaneSlot {
  tabId: string;
  siblingPaneId: string;
  direction: "horizontal" | "vertical";
  before: boolean;
}

/** A live session a close stopped, enough to resume it (or a shell, to start one in its cwd) */
export interface ClosedSession {
  paneId: string;
  agentId: string;
  cliType: string;
  name: string;
  taskDescription: string;
  branchName: string | null;
  accessMode: string | null;
  cwd?: string;
}

/** A closed tab or pane, kept for Reopen (Cmd+Shift+T) */
export interface ClosedEntry {
  id: string;
  projectId: string;
  closedAt: number;
  kind: "tab" | "pane";
  label: string;
  /** A closed tab: its layout and where it was in the tab bar */
  tab?: { id: string; layout: LayoutNode; index: number };
  /** A closed pane: the pane it sat beside */
  slot?: PaneSlot | null;
  panes: Pane[];
  sessions: ClosedSession[];
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
  /** Activate a tab, the focus on `paneId` when given (else its last focused pane) */
  setActiveTab: (tabId: string, paneId?: string) => void;
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
  movePaneBeside: (
    tabId: string,
    sourcePaneId: string,
    targetPaneId: string,
    side: "left" | "right" | "top" | "bottom",
  ) => void;
  splitPane: (
    tabId: string,
    paneId: string | null,
    direction: "horizontal" | "vertical",
    newPaneType: PaneType,
    /** `id`: the caller needs the new pane (to spawn a shell into it) */
    config?: { agentId?: string; url?: string; id?: string; linkPreview?: boolean },
  ) => void;
  updatePane: (paneId: string, updates: Partial<Pane>) => void;
  /** The page a browser pane is on: any project's pane, without taking focus (a redirect in a
   *  background pane moved the cursor), and nothing when it did not change */
  setPaneUrl: (paneId: string, url: string) => void;
  /** A files pane's view, in whichever project holds it: also saved while it unmounts */
  setFilesView: (paneId: string, patch: FilesViewPatch) => void;
  /** A session ended or was removed: its panes in any project let go of it (releaseAgentPanes) */
  releaseAgent: (agentId: string) => void;
  setFocusedPane: (paneId: string | null) => void;

  extractPaneToNewTab: (sourceTabId: string, paneId: string) => void;
  /** Close exactly this tab or pane (resolveCloseTarget / closeTargetFor) */
  closeTarget: (target: CloseTarget) => void;
  closeFocusedPane: () => void;
  /** Closed tabs and panes, newest first (MAX_RECENTLY_CLOSED), persisted */
  recentlyClosed: ClosedEntry[];
  rememberClosed: (entry: ClosedEntry) => void;
  /** Put a closed entry back in the active project and drop it from the list */
  restoreClosed: (entryId: string) => { tabId: string; paneId: string } | null;
  splitFocusedPane: (direction: "horizontal" | "vertical") => void;

  // Derived
  getActiveTab: () => WorkspaceTab | null;
  ensureDefaultTab: () => void;
  /** Reset all split sizes in the active tab to equal proportions */
  equalizeSplits: (tabId: string) => void;
  /** Sizes of the split at `path` (child indexes from the tab's root), after a drag */
  setSplitSizes: (tabId: string, path: number[], sizes: number[]) => void;
  /**
   * Replace the tab layout with a built-in preset, reusing existing panes.
   * Returns the IDs of any new panes that were created as terminal slots,
   * so the caller can spawn shell agents for them.
   */
  applyLayoutPreset: (tabId: string, presetId: LayoutPresetId) => { terminalsToSpawn: string[] };
  /** Apply a user-saved custom layout template to a tab */
  /** Returns the terminal panes to fill: a shell or an agent per slot (lib/spawn-shell) */
  applyCustomLayout: (
    tabId: string,
    customId: string,
  ) => { spawns: { paneId: string; slot: CustomLayoutSlot }[] };
  /** Save the current tab layout as a named custom preset */
  saveCustomLayout: (
    tabId: string,
    name: string,
    opts?: { projectId?: string; agentOf?: (agentId: string) => SlotAgent | undefined },
  ) => string | null;
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
