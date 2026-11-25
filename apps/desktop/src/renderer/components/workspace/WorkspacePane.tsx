import { type Agent, ENDED_STATUSES } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { AlertTriangle, PictureInPicture2 } from "lucide-react";
import { type DragEvent, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePaneProject } from "../../contexts/ProjectScope";
import { resumeSessionInto } from "../../hooks/use-resume-agent";
import { useAgent } from "../../hooks/use-trpc";
import { closeWithConfirm } from "../../lib/close-target";
import { dispatchRefitTerminals } from "../../lib/dispatch-refit";
import { canFloat, floatPane } from "../../lib/float-pane";
import { splitAndFocus, splitWithBrowser, splitWithTerminal } from "../../lib/split-terminal";
import { trpcMutate } from "../../lib/trpc-client";
import { isPaneAgentStale, useAgentStore } from "../../stores/agents";
import {
  collectPaneIds,
  type FilesViewPatch,
  getProjectState,
  type Pane,
  selectPanesOf,
  selectTabsOf,
  useWorkspaceStore,
} from "../../stores/workspace";
import { closeTargetFor } from "../../stores/workspace/helpers";
import { EmptyState, LoadingSpinner } from "../common";
import { ErrorBoundary, paneFallback } from "../ErrorBoundary";
import { ViewsPane } from "../views/ViewsPane";
import { FileExplorer } from "../workspace/FileExplorer";
import { GitPane } from "../workspace/GitPane";
import { BrowserPane } from "./BrowserPaneContent";
import { EmptyPane } from "./EmptyPaneContent";
import { PaneContextMenu } from "./PaneContextMenu";
import { PANE_DRAG_TYPE, readPaneDrag } from "./PaneDragHandle";
import { PaneToolbar } from "./PaneToolbar";

// Lazy: xterm + addons (~470KB) only load when a terminal pane mounts
const TerminalPanel = lazy(() =>
  import("../terminal/TerminalPanel").then((m) => ({ default: m.TerminalPanel })),
);

// ─── Browser Pane ───────────────────────────────────────────────────────────

// ─── Floating placeholder ─────────────────────────────────────────────────

function FloatingPlaceholder({ paneId }: { paneId: string }) {
  const unmarkPaneFloating = useWorkspaceStore((s) => s.unmarkPaneFloating);
  const handleReturn = useCallback(() => {
    // Close the floating window — the main process will fire "floating:closed"
    // which is already wired via useFloatingPaneSync to unmark the pane. We
    // also unmark defensively here in case the window was already gone.
    window.api.floating.close(paneId);
    unmarkPaneFloating(paneId);
  }, [paneId, unmarkPaneFloating]);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg-primary text-center">
      <PictureInPicture2 className="h-7 w-7 text-text-muted" />
      <div className="space-y-0.5">
        <div className="text-xs font-medium text-text-primary">Floating</div>
        <div className="text-[10px] text-text-muted">
          This pane is open in a separate always-on-top window
        </div>
      </div>
      <button
        type="button"
        onClick={handleReturn}
        className="rounded border border-border bg-bg-secondary px-3 py-1 text-[10px] text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
      >
        Return to pane
      </button>
    </div>
  );
}

// ─── Invalid / Recovery-Failed Pane ──────────────────────────────────────

function InvalidPane({ reason, paneId }: { reason: string; paneId: string }) {
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  return (
    <EmptyState
      icon={<AlertTriangle className="h-8 w-8 text-yellow-400/60" />}
      title="Recovery failed"
      description={reason}
      action={{
        label: "Reset pane",
        onClick: () => updatePane(paneId, { type: "empty", invalidReason: undefined }),
      }}
      className="h-full"
    />
  );
}

// ─── Recoverable Terminal Pane (validates agent exists) ──────────────────

function RecoverableTerminalPane({ agentId, paneId }: { agentId: string; paneId: string }) {
  const { data: agent, isError } = useAgent(agentId);
  const storeAgent = useAgentStore((s) => s.agents[agentId]);
  const updatePane = useWorkspaceStore((s) => s.updatePane);

  // Agent not found — convert pane to empty (agent was deleted)
  useEffect(() => {
    if (isError) {
      console.log(
        `[PaneRecovery] Agent ${agentId} errored (not in DB) — converting pane ${paneId} to empty`,
      );
      updatePane(paneId, { type: "empty", agentId: undefined });
    }
  }, [isError, paneId, agentId, updatePane]);

  // A shell the sidecar took can't get its process back, but its pane gets a terminal back in
  // its last folder: the same resume as auto-resume, which runs once per session
  const respawned = useRef(false);
  useEffect(() => {
    if (respawned.current || agent?.cliType !== "shell" || agent.status !== "crashed") return;
    respawned.current = true;
    resumeSessionInto(
      agent,
      false,
      (data) => trpcMutate<Agent>("agents.spawn", data),
      paneId,
    ).catch((err) => console.error("[PaneRecovery] Could not reopen the shell:", err));
  }, [agent, paneId]);

  // Ended and still not in the store once its own project's list landed: archived or closed
  // null: the row is gone (a closed shell is deleted); waiting on it ended in "Failed to start"
  const isStaleFromPreviousSession = useAgentStore(
    (s) => agent === null || (agent !== undefined && isPaneAgentStale(agent, s)),
  );

  useEffect(() => {
    if (!isStaleFromPreviousSession) return;
    console.log(
      `[PaneRecovery] Stale agent ${agentId} (${agent ? `status=${agent.status}, notInStore` : "deleted"}) — converting pane ${paneId} to empty`,
    );
    updatePane(paneId, { type: "empty", agentId: undefined });
  }, [isStaleFromPreviousSession, agent, agentId, paneId, updatePane]);

  // Log unexpected state: agent exists in DB but not in store (no callbacks wired)
  useEffect(() => {
    if (!agent || storeAgent || ENDED_STATUSES.has(agent.status) || agent.status === "idle") {
      return;
    }
    // Panes mount before their agent's own project list (syncFromDb) lands, so
    // warning at once reports that startup race, not a broken pane. Only complain
    // if the agent is STILL missing once that list had time to arrive; if it
    // shows up, this effect re-runs with storeAgent set and the timer is cleared.
    const timer = setTimeout(() => {
      console.warn(
        `[PaneRecovery] Agent ${agentId} is status=${agent.status} in DB but still NOT in store after sync — this pane will render but the terminal will likely be broken (no callbacks wired). Check main process [Reattach] logs.`,
      );
    }, 3_000);
    return () => clearTimeout(timer);
  }, [agent, storeAgent, agentId]);

  if (isError || isStaleFromPreviousSession) return null;

  // Agent found or still loading
  if (agent === undefined) {
    return <LoadingSpinner label="Loading agent..." className="h-full" />;
  }

  return (
    <Suspense fallback={<LoadingSpinner label="Loading terminal..." className="h-full" />}>
      <TerminalPanel agentId={agentId} paneId={paneId} />
    </Suspense>
  );
}

// ─── Files Pane ─────────────────────────────────────────────────────────

function FilesPaneContent({ pane, paneId }: PaneContentProps) {
  const { project } = usePaneProject();
  const setFilesView = useWorkspaceStore((s) => s.setFilesView);
  const onViewChange = useCallback(
    (patch: FilesViewPatch) => setFilesView(paneId, patch),
    [setFilesView, paneId],
  );
  const rootPath = pane.filePath || project?.path;
  if (!rootPath) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-text-muted">No project selected</p>
      </div>
    );
  }
  // Keyed: the expanded-folder set is seeded from the first root only. The open file, folders
  // and mode live on the pane: a project switch unmounts it and they came back empty
  return (
    <FileExplorer
      key={rootPath}
      rootPath={rootPath}
      initialFile={pane.openFile}
      projectId={project?.id}
      view={pane.files}
      onViewChange={onViewChange}
    />
  );
}

// ─── Pane body by type ──────────────────────────────────────────────────────

type PaneContentProps = { pane: Pane; paneId: string };

const PANE_CONTENT: Record<Pane["type"], (props: PaneContentProps) => React.ReactNode> = {
  terminal: ({ pane, paneId }) =>
    pane.agentId ? (
      <RecoverableTerminalPane agentId={pane.agentId} paneId={paneId} />
    ) : (
      <EmptyPane paneId={paneId} folder={pane.launcherFolder} />
    ),
  // Stays mounted in a kept hidden project: its page, form and scroll survive a switch. The
  // partition comes from the layer's ProjectScope, never from the active project
  browser: ({ pane, paneId }) => <BrowserPane pane={pane} paneId={paneId} />,
  files: ({ pane, paneId }) => (
    <FilesPaneContent key={pane.filePath ?? "default"} pane={pane} paneId={paneId} />
  ),
  git: ({ pane }) => <GitPane key={pane.filePath ?? "default"} overridePath={pane.filePath} />,
  views: ({ paneId }) => <ViewsPane paneId={paneId} />,
  empty: ({ pane, paneId }) => <EmptyPane paneId={paneId} folder={pane.launcherFolder} />,
};

function PaneBody({ pane, paneId, isFloating }: PaneContentProps & { isFloating: boolean }) {
  if (pane.invalidReason) return <InvalidPane reason={pane.invalidReason} paneId={paneId} />;
  if (isFloating) return <FloatingPlaceholder paneId={paneId} />;
  const Content = PANE_CONTENT[pane.type];
  return (
    <ErrorBoundary fallback={paneFallback}>
      <Content pane={pane} paneId={paneId} />
    </ErrorBoundary>
  );
}

// ─── Drop target (tab merge / pane rearrange) ───────────────────────────────

type DropSide = "left" | "right" | "top" | "bottom";

function dropSideAt(x: number, y: number): DropSide | null {
  if (x < 0.3) return "left";
  if (x > 0.7) return "right";
  if (y < 0.3) return "top";
  if (y > 0.7) return "bottom";
  return null;
}

const DROP_INDICATOR: Record<DropSide, string> = {
  left: "inset-y-0 left-0 w-1/2",
  right: "inset-y-0 right-0 w-1/2",
  top: "inset-x-0 top-0 h-1/2",
  bottom: "inset-x-0 bottom-0 h-1/2",
};

function usePaneDropTarget(tabId: string, paneId: string) {
  const mergeTabIntoSplit = useWorkspaceStore((s) => s.mergeTabIntoSplit);
  const movePaneBeside = useWorkspaceStore((s) => s.movePaneBeside);
  const [dropSide, setDropSide] = useState<DropSide | null>(null);

  const handlePaneDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    const hasTab = e.dataTransfer.types.includes("application/exegol-tab");
    const hasPane = e.dataTransfer.types.includes(PANE_DRAG_TYPE);
    if (!hasTab && !hasPane) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setDropSide(dropSideAt(x, y));
  }, []);

  const handlePaneDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDropSide(null);

      // Handle tab → pane merge (existing)
      const sourceTabId = e.dataTransfer.getData("application/exegol-tab");
      if (sourceTabId && sourceTabId !== tabId) {
        const direction = dropSide === "left" || dropSide === "right" ? "horizontal" : "vertical";
        const sourceFirst = dropSide === "left" || dropSide === "top";
        mergeTabIntoSplit(sourceTabId, tabId, direction, sourceFirst);
        dispatchRefitTerminals();
        return;
      }

      // Pane dropped on another pane: rearrange. The indicator has always been
      // drawn here, but nothing acted on it — the drop silently did nothing.
      const dragged = readPaneDrag(e);
      if (dragged && dropSide && dragged.tabId === tabId && dragged.paneId !== paneId) {
        movePaneBeside(tabId, dragged.paneId, paneId, dropSide);
        dispatchRefitTerminals();
      }
    },
    [tabId, paneId, dropSide, mergeTabIntoSplit, movePaneBeside],
  );

  // Only clear drop indicator when truly leaving the pane (not entering a child)
  const handlePaneDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropSide(null);
  }, []);

  return {
    dropSide,
    dropHandlers: {
      onDragOver: handlePaneDragOver,
      onDrop: handlePaneDrop,
      onDragLeave: handlePaneDragLeave,
    },
  };
}

// ─── Main WorkspacePane ─────────────────────────────────────────────────────

interface WorkspacePaneProps {
  paneId: string;
  tabId: string;
}

export function WorkspacePane({ paneId, tabId }: WorkspacePaneProps) {
  const { projectId: paneProjectId } = usePaneProject();
  const pane = useWorkspaceStore((s) => selectPanesOf(paneProjectId)(s)[paneId]);
  const setFocusedPane = useWorkspaceStore((s) => s.setFocusedPane);
  const focusedPaneId = useWorkspaceStore((s) => s.focusedPaneId);
  const isFloating = useWorkspaceStore((s) => !!s.floatingPanes[paneId]);
  const isFocused = focusedPaneId === paneId;
  const { dropSide, dropHandlers } = usePaneDropTarget(tabId, paneId);

  // Check if this pane is inside a split (has siblings) — enables drag-out
  const isSplitPane = useWorkspaceStore((s) => {
    const tab = selectTabsOf(paneProjectId)(s).find((t) => t.id === tabId);
    return tab ? collectPaneIds(tab.layout).length > 1 : false;
  });

  if (!pane) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-xs text-text-muted">Pane not found</span>
      </div>
    );
  }

  return (
    <div
      role="none"
      data-pane-id={paneId}
      className={cn(
        "group/pane relative flex h-full flex-col",
        isFocused ? "border-2 border-accent/40" : "border-2 border-transparent",
      )}
      onMouseDown={() => {
        setFocusedPane(paneId);
        // T155.3: activating an agent's pane clears its attention state
        if (pane.agentId) useAgentStore.getState().setFocusedAgent(pane.agentId);
      }}
      {...dropHandlers}
    >
      {/* Tab merge drop indicator */}
      {dropSide && (
        <div
          className={cn(
            "pointer-events-none absolute z-20 bg-accent/20 border-2 border-accent/50 rounded transition-all",
            DROP_INDICATOR[dropSide],
          )}
        />
      )}
      <PaneToolbar tabId={tabId} paneId={paneId} paneType={pane.type} isSplitPane={isSplitPane} />
      <PaneContextMenu
        tabId={tabId}
        paneId={paneId}
        paneType={pane.type}
        agentId={pane.agentId}
        isSplitPane={isSplitPane}
        onSplit={(dir, newType) => {
          if (newType !== "browser") {
            splitAndFocus(tabId, paneId, dir, newType ?? "empty");
            return;
          }
          splitWithBrowser(tabId, paneId, dir);
        }}
        onSplitTerminal={() => void splitWithTerminal(tabId, paneId)}
        onEqualize={() => useWorkspaceStore.getState().equalizeSplits(tabId)}
        onFloat={
          canFloat(pane)
            ? () =>
                floatPane(
                  paneId,
                  pane,
                  paneProjectId,
                  useWorkspaceStore.getState().markPaneFloating,
                )
            : undefined
        }
        onScreenshot={
          pane.type === "browser"
            ? () =>
                window.dispatchEvent(
                  new CustomEvent("exegol:screenshot-pane", { detail: { paneId } }),
                )
            : undefined
        }
        onClose={() => closeWithConfirm(closeTargetFor(getProjectState(), tabId, paneId, false))}
      >
        <div className="flex-1 overflow-hidden">
          <PaneBody pane={pane} paneId={paneId} isFloating={isFloating} />
        </div>
      </PaneContextMenu>
    </div>
  );
}
