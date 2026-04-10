import { cn } from "@exegol/ui";
import {
  AlertTriangle,
  ArrowUpRight,
  Code2,
  Columns,
  GripVertical,
  PictureInPicture2,
  Rows,
  X,
} from "lucide-react";
import { type DragEvent, lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { deleteAgentImperative } from "../../hooks/use-delete-agent";
import { useAgent } from "../../hooks/use-trpc";
import { dispatchRefitTerminals } from "../../lib/dispatch-refit";
import { trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { collectPaneIds, selectPanes, selectTabs, useWorkspaceStore } from "../../stores/workspace";
import { EmptyState, LoadingSpinner } from "../common";
import { FileExplorer } from "../workspace/FileExplorer";
import { GitPane } from "../workspace/GitPane";
import { BrowserPane } from "./BrowserPaneContent";
import { EmptyPane } from "./EmptyPaneContent";
import { PaneContextMenu } from "./PaneContextMenu";

// Lazy: xterm + addons (~470KB) only load when a terminal pane mounts
const TerminalPanel = lazy(() =>
  import("../terminal/TerminalPanel").then((m) => ({ default: m.TerminalPanel })),
);

// ─── Pane Toolbar ───────────────────────────────────────────────────────────

function PaneToolbar({
  tabId,
  paneId,
  paneType,
  isSplitPane,
}: {
  tabId: string;
  paneId: string;
  paneType: string;
  isSplitPane: boolean;
}) {
  const splitPane = useWorkspaceStore((s) => s.splitPane);
  const removePane = useWorkspaceStore((s) => s.removePane);
  const extractPaneToNewTab = useWorkspaceStore((s) => s.extractPaneToNewTab);
  const markPaneFloating = useWorkspaceStore((s) => s.markPaneFloating);
  const panes = useWorkspaceStore(selectPanes);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const { projectId } = useProjectContext();

  const showIdeButton = paneType === "terminal" || paneType === "files";
  const showFloatButton = paneType === "terminal" || paneType === "browser";

  const handleFloat = useCallback(() => {
    const pane = panes[paneId];
    if (!pane) return;
    if (pane.type === "terminal" && pane.agentId) {
      markPaneFloating(paneId, "terminal");
      window.api.floating.open({
        paneId,
        type: "terminal",
        title: `Terminal — ${pane.agentId.slice(0, 8)}`,
        agentId: pane.agentId,
      });
    } else if (pane.type === "browser" && pane.url) {
      markPaneFloating(paneId, "browser");
      window.api.floating.open({
        paneId,
        type: "browser",
        title: "Browser",
        url: pane.url,
      });
    }
  }, [panes, paneId, markPaneFloating]);

  const handleOpenInIde = useCallback(() => {
    if (!projectId) return;
    trpcMutate("projects.openInIde", { projectId }).catch((err) => {
      console.error("[PaneToolbar] Open in IDE failed:", err);
    });
  }, [projectId]);

  const handleClosePane = useCallback(() => {
    const pane = panes[paneId];
    // Stop the agent when closing a terminal pane
    if (pane?.type === "terminal" && pane.agentId) {
      const agentId = pane.agentId;
      trpcMutate("agents.stop", { id: agentId })
        .catch(() => {})
        .then(() => trpcMutate("agents.delete", { id: agentId }).catch(() => {}));
      removeAgent(agentId);
    }
    removePane(tabId, paneId);
  }, [tabId, paneId, panes, removePane, removeAgent]);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData("application/exegol-pane", JSON.stringify({ paneId, tabId }));
      e.dataTransfer.effectAllowed = "move";
    },
    [paneId, tabId],
  );

  const handleExtractToTab = useCallback(() => {
    extractPaneToNewTab(tabId, paneId);
    dispatchRefitTerminals();
  }, [tabId, paneId, extractPaneToNewTab]);

  return (
    <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded bg-bg-secondary/80 opacity-0 transition-opacity group-hover/pane:opacity-100">
      {isSplitPane && (
        // biome-ignore lint/a11y/noStaticElementInteractions: drag handle for pane extraction
        <div
          draggable
          onDragStart={handleDragStart}
          className="flex h-5 w-5 cursor-grab items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary active:cursor-grabbing"
          title="Drag to tab bar to extract"
        >
          <GripVertical className="h-3 w-3" />
        </div>
      )}
      {showIdeButton && projectId && (
        <button
          type="button"
          onClick={handleOpenInIde}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
          title="Open in IDE"
        >
          <Code2 className="h-3 w-3" />
        </button>
      )}
      {isSplitPane && (
        <button
          type="button"
          onClick={handleExtractToTab}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
          title="Pop out to new tab"
        >
          <ArrowUpRight className="h-3 w-3" />
        </button>
      )}
      {showFloatButton && (
        <button
          type="button"
          onClick={handleFloat}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
          title="Float to separate window"
        >
          <PictureInPicture2 className="h-3 w-3" />
        </button>
      )}
      <button
        type="button"
        onClick={() => splitPane(tabId, paneId, "horizontal", "empty")}
        className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
        title="Split horizontal"
      >
        <Columns className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => splitPane(tabId, paneId, "vertical", "empty")}
        className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
        title="Split vertical"
      >
        <Rows className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={handleClosePane}
        className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-red-400/80 hover:text-white"
        title="Close pane"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

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

const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped", "crashed"]);

function RecoverableTerminalPane({ agentId, paneId }: { agentId: string; paneId: string }) {
  const { data: agent, isError } = useAgent(agentId);
  const storeAgent = useAgentStore((s) => s.agents[agentId]);
  const updatePane = useWorkspaceStore((s) => s.updatePane);

  // Agent not found — convert pane to empty (agent was deleted)
  useEffect(() => {
    if (isError) {
      updatePane(paneId, { type: "empty", agentId: undefined });
    }
  }, [isError, paneId, updatePane]);

  // Agent in terminal state with no live store entry — stale pane from previous session
  // (store only has agents that were spawned or reattached in this session)
  const isStaleFromPreviousSession = agent && TERMINAL_STATUSES.has(agent.status) && !storeAgent;

  useEffect(() => {
    if (isStaleFromPreviousSession) {
      updatePane(paneId, { type: "empty", agentId: undefined });
    }
  }, [isStaleFromPreviousSession, paneId, updatePane]);

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

function FilesPaneContent({ overridePath }: { overridePath?: string }) {
  const { project } = useProjectContext();
  const rootPath = overridePath || project?.path;
  if (!rootPath) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-text-muted">No project selected</p>
      </div>
    );
  }
  return <FileExplorer rootPath={rootPath} />;
}

// ─── Main WorkspacePane ─────────────────────────────────────────────────────

interface WorkspacePaneProps {
  paneId: string;
  tabId: string;
}

export function WorkspacePane({ paneId, tabId }: WorkspacePaneProps) {
  const pane = useWorkspaceStore((s) => selectPanes(s)[paneId]);
  const setFocusedPane = useWorkspaceStore((s) => s.setFocusedPane);
  const mergeTabIntoSplit = useWorkspaceStore((s) => s.mergeTabIntoSplit);
  const focusedPaneId = useWorkspaceStore((s) => s.focusedPaneId);
  const isFloating = useWorkspaceStore((s) => !!s.floatingPanes[paneId]);
  const isFocused = focusedPaneId === paneId;
  const [dropSide, setDropSide] = useState<"left" | "right" | "top" | "bottom" | null>(null);

  // Check if this pane is inside a split (has siblings) — enables drag-out
  const isSplitPane = useWorkspaceStore((s) => {
    const tab = selectTabs(s).find((t) => t.id === tabId);
    return tab ? collectPaneIds(tab.layout).length > 1 : false;
  });

  const handlePaneDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    const hasTab = e.dataTransfer.types.includes("application/exegol-tab");
    const hasPane = e.dataTransfer.types.includes("application/exegol-pane");
    if (!hasTab && !hasPane) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0.3) setDropSide("left");
    else if (x > 0.7) setDropSide("right");
    else if (y < 0.3) setDropSide("top");
    else if (y > 0.7) setDropSide("bottom");
    else setDropSide(null);
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
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event("exegol:refit-terminals"));
        });
        return;
      }
    },
    [tabId, dropSide, mergeTabIntoSplit],
  );

  // Only clear drop indicator when truly leaving the pane (not entering a child)
  const handlePaneDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropSide(null);
  }, []);

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
      className={cn(
        "group/pane relative flex h-full flex-col",
        isFocused ? "border-2 border-accent/40" : "border-2 border-transparent",
      )}
      onMouseDown={() => setFocusedPane(paneId)}
      onDragOver={handlePaneDragOver}
      onDrop={handlePaneDrop}
      onDragLeave={handlePaneDragLeave}
    >
      {/* Tab merge drop indicator */}
      {dropSide && (
        <div
          className={cn(
            "pointer-events-none absolute z-20 bg-accent/20 border-2 border-accent/50 rounded transition-all",
            dropSide === "left" && "inset-y-0 left-0 w-1/2",
            dropSide === "right" && "inset-y-0 right-0 w-1/2",
            dropSide === "top" && "inset-x-0 top-0 h-1/2",
            dropSide === "bottom" && "inset-x-0 bottom-0 h-1/2",
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
        onSplit={(dir, newType) =>
          useWorkspaceStore.getState().splitPane(tabId, paneId, dir, newType ?? "empty")
        }
        onExtractToTab={() => useWorkspaceStore.getState().extractPaneToNewTab(tabId, paneId)}
        onEqualize={() => useWorkspaceStore.getState().equalizeSplits(tabId)}
        onFloat={
          (pane.type === "terminal" && pane.agentId) || (pane.type === "browser" && pane.url)
            ? () => {
                if (pane.type === "terminal" && pane.agentId) {
                  useWorkspaceStore.getState().markPaneFloating(paneId, "terminal");
                  window.api.floating.open({
                    paneId,
                    type: "terminal",
                    title: `Terminal — ${pane.agentId.slice(0, 8)}`,
                    agentId: pane.agentId,
                  });
                } else if (pane.type === "browser" && pane.url) {
                  useWorkspaceStore.getState().markPaneFloating(paneId, "browser");
                  window.api.floating.open({
                    paneId,
                    type: "browser",
                    title: "Browser",
                    url: pane.url,
                  });
                }
              }
            : undefined
        }
        onClose={() => {
          if (pane.type === "terminal" && pane.agentId) {
            deleteAgentImperative(pane.agentId);
          } else {
            useWorkspaceStore.getState().removePane(tabId, paneId);
          }
        }}
      >
        <div className="flex-1 overflow-hidden">
          {pane.invalidReason && <InvalidPane reason={pane.invalidReason} paneId={paneId} />}
          {!pane.invalidReason && isFloating && <FloatingPlaceholder paneId={paneId} />}
          {!pane.invalidReason && !isFloating && pane.type === "terminal" && pane.agentId && (
            <RecoverableTerminalPane agentId={pane.agentId} paneId={paneId} />
          )}
          {!pane.invalidReason && !isFloating && pane.type === "browser" && (
            <BrowserPane pane={pane} paneId={paneId} />
          )}
          {!pane.invalidReason && !isFloating && pane.type === "files" && (
            <FilesPaneContent key={pane.filePath ?? "default"} overridePath={pane.filePath} />
          )}
          {!pane.invalidReason && !isFloating && pane.type === "git" && (
            <GitPane key={pane.filePath ?? "default"} overridePath={pane.filePath} />
          )}
          {!pane.invalidReason && !isFloating && pane.type === "empty" && (
            <EmptyPane paneId={paneId} />
          )}
          {!pane.invalidReason && !isFloating && pane.type === "terminal" && !pane.agentId && (
            <EmptyPane paneId={paneId} />
          )}
        </div>
      </PaneContextMenu>
    </div>
  );
}
