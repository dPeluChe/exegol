import { cn } from "@exegol/ui";
import {
  AlertTriangle,
  ArrowUpRight,
  Code2,
  Columns,
  Globe,
  GripVertical,
  PictureInPicture2,
  Rows,
  TerminalSquare,
  X,
} from "lucide-react";
import { nanoid } from "nanoid";
import { type DragEvent, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { useAgent } from "../../hooks/use-trpc";
import { sizeKey } from "../../lib/browser-viewports";
import { closeWithConfirm } from "../../lib/close-target";
import { dispatchRefitTerminals } from "../../lib/dispatch-refit";
import { openProjectInIde } from "../../lib/open-in-ide";
import { projectBrowserUrl } from "../../lib/project-browser-url";
import { spawnShellIntoPane } from "../../lib/spawn-shell";
import { trpcMutate } from "../../lib/trpc-client";
import { isPaneAgentStale, useAgentStore } from "../../stores/agents";
import {
  collectPaneIds,
  type FilesViewPatch,
  getProjectState,
  type Pane,
  selectPanes,
  selectTabs,
  useWorkspaceStore,
} from "../../stores/workspace";
import { closeTargetFor } from "../../stores/workspace/helpers";
import { EmptyState, LoadingSpinner } from "../common";
import { ErrorBoundary, paneFallback } from "../ErrorBoundary";
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

/** Opens a terminal (with an agent) or browser (with a URL) pane in an always-on-top window */
function floatPane(
  paneId: string,
  pane: Pane,
  projectId: string | null | undefined,
  markPaneFloating: (paneId: string, type: "terminal" | "browser") => void,
) {
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
      // The floating browser lists the project's agents from it
      projectId: projectId ?? undefined,
      viewport: pane.viewport ? sizeKey(pane.viewport) : undefined,
    });
  }
}

const canFloat = (pane: Pane) =>
  Boolean((pane.type === "terminal" && pane.agentId) || (pane.type === "browser" && pane.url));

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
  const extractPaneToNewTab = useWorkspaceStore((s) => s.extractPaneToNewTab);
  const markPaneFloating = useWorkspaceStore((s) => s.markPaneFloating);
  const panes = useWorkspaceStore(selectPanes);
  const { projectId, project } = useProjectContext();
  // A terminal offers a browser beside it and a browser a terminal
  const companion =
    paneType === "terminal" ? "browser" : paneType === "browser" ? "terminal" : null;
  const [addOpen, setAddOpen] = useState(false);

  const addCompanion = useCallback(
    async (direction: "horizontal" | "vertical") => {
      setAddOpen(false);
      const id = nanoid(8);
      if (companion === "browser") {
        const url = await projectBrowserUrl(projectId, project?.path);
        splitPane(tabId, paneId, direction, "browser", { id, url });
      } else if (companion === "terminal" && projectId) {
        splitPane(tabId, paneId, direction, "empty", { id });
        await spawnShellIntoPane(projectId, id).catch((err) =>
          console.error("[PaneToolbar] Shell spawn failed:", err),
        );
      }
      dispatchRefitTerminals();
    },
    [companion, projectId, project?.path, splitPane, tabId, paneId],
  );

  const showIdeButton = paneType === "terminal" || paneType === "files";
  const showFloatButton = paneType === "terminal" || paneType === "browser";

  const handleFloat = useCallback(() => {
    const pane = panes[paneId];
    if (!pane) return;
    floatPane(paneId, pane, projectId, markPaneFloating);
  }, [panes, paneId, markPaneFloating, projectId]);

  const handleOpenInIde = useCallback(() => {
    if (!projectId) return;
    openProjectInIde({ projectId });
  }, [projectId]);

  const handleClosePane = useCallback(
    () => closeWithConfirm(closeTargetFor(getProjectState(), tabId, paneId, false)),
    [tabId, paneId],
  );

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
    <>
      {isSplitPane && (
        // The grip sits on the pane's left edge, outlined in the accent so it reads as a handle;
        // the action bar keeps a second one for whoever looks there first
        // biome-ignore lint/a11y/noStaticElementInteractions: drag handle for pane extraction
        <div
          draggable
          onDragStart={handleDragStart}
          className="absolute top-1/2 left-0.5 z-10 flex h-10 w-4 -translate-y-1/2 cursor-grab items-center justify-center rounded border border-accent bg-bg-secondary/90 text-accent opacity-0 transition-opacity hover:bg-accent/15 active:cursor-grabbing group-hover/pane:opacity-100"
          title="Drag to another pane's edge to move it, or to the tab bar to extract it"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </div>
      )}
      <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded bg-bg-secondary/80 opacity-0 transition-opacity group-hover/pane:opacity-100">
        {isSplitPane && (
          // biome-ignore lint/a11y/noStaticElementInteractions: drag handle for pane extraction
          <div
            draggable
            onDragStart={handleDragStart}
            className="flex h-5 w-5 cursor-grab items-center justify-center rounded text-accent hover:bg-accent/15 active:cursor-grabbing"
            title="Drag to another pane's edge to move it, or to the tab bar to extract it"
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
        {companion && (
          // biome-ignore lint/a11y/noStaticElementInteractions: closes the side menu when the pointer leaves it
          <div className="relative" onMouseLeave={() => setAddOpen(false)}>
            <button
              type="button"
              onClick={() => setAddOpen((v) => !v)}
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded hover:bg-white/10 hover:text-text-primary",
                addOpen ? "bg-white/10 text-text-primary" : "text-text-muted",
              )}
              title={companion === "browser" ? "Add a browser beside" : "Add a terminal beside"}
            >
              {companion === "browser" ? (
                <Globe className="h-3 w-3" />
              ) : (
                <TerminalSquare className="h-3 w-3" />
              )}
            </button>
            {addOpen && (
              <div className="absolute right-0 top-6 z-20 w-28 rounded-md border border-border bg-bg-secondary py-1 shadow-lg">
                {(
                  [
                    ["horizontal", Columns, "To the right"],
                    ["vertical", Rows, "Below"],
                  ] as const
                ).map(([dir, Icon, label]) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => addCompanion(dir)}
                    className="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] text-text-secondary hover:bg-white/10"
                  >
                    <Icon className="h-3 w-3" />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
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
    </>
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
      console.log(
        `[PaneRecovery] Agent ${agentId} errored (not in DB) — converting pane ${paneId} to empty`,
      );
      updatePane(paneId, { type: "empty", agentId: undefined });
    }
  }, [isError, paneId, agentId, updatePane]);

  // A shell killed by a reboot can't get its process back, but its pane can
  // get a terminal back: a fresh shell in the project folder, same pane
  const respawned = useRef(false);
  useEffect(() => {
    if (respawned.current || agent?.cliType !== "shell" || agent.status !== "crashed") return;
    respawned.current = true;
    spawnShellIntoPane(agent.projectId, paneId)
      .then(() => {
        useAgentStore.getState().removeAgent(agentId);
        return trpcMutate("agents.delete", { id: agentId });
      })
      .catch((err) => console.error("[PaneRecovery] Could not reopen the shell:", err));
  }, [agent, agentId, paneId]);

  // Ended and still not in the store once its own project's list landed: archived or closed
  const isStaleFromPreviousSession = useAgentStore(
    (s) => agent !== undefined && isPaneAgentStale(agent, s),
  );

  useEffect(() => {
    if (isStaleFromPreviousSession && agent) {
      console.log(
        `[PaneRecovery] Stale agent ${agentId} (status=${agent.status}, notInStore) — converting pane ${paneId} to empty`,
      );
      updatePane(paneId, { type: "empty", agentId: undefined });
    }
  }, [isStaleFromPreviousSession, agent, agentId, paneId, updatePane]);

  // Log unexpected state: agent exists in DB but not in store (no callbacks wired)
  useEffect(() => {
    if (!agent || storeAgent || TERMINAL_STATUSES.has(agent.status) || agent.status === "idle") {
      return;
    }
    // Panes mount before the store's first syncFromDb lands, so warning
    // immediately reports the startup race rather than a broken pane — and sent
    // us reading reattach logs for a non-problem. Only complain if the agent is
    // STILL missing once the sync has had time to arrive; if it shows up, this
    // effect re-runs with storeAgent set and the timer is cleared.
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
  const { project } = useProjectContext();
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
      <EmptyPane paneId={paneId} />
    ),
  browser: ({ pane, paneId }) => <BrowserPane pane={pane} paneId={paneId} />,
  files: ({ pane, paneId }) => (
    <FilesPaneContent key={pane.filePath ?? "default"} pane={pane} paneId={paneId} />
  ),
  git: ({ pane }) => <GitPane key={pane.filePath ?? "default"} overridePath={pane.filePath} />,
  empty: ({ paneId }) => <EmptyPane paneId={paneId} />,
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

const refitNextFrame = () =>
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event("exegol:refit-terminals"));
  });

function usePaneDropTarget(tabId: string, paneId: string) {
  const mergeTabIntoSplit = useWorkspaceStore((s) => s.mergeTabIntoSplit);
  const movePaneBeside = useWorkspaceStore((s) => s.movePaneBeside);
  const [dropSide, setDropSide] = useState<DropSide | null>(null);

  const handlePaneDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    const hasTab = e.dataTransfer.types.includes("application/exegol-tab");
    const hasPane = e.dataTransfer.types.includes("application/exegol-pane");
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
        refitNextFrame();
        return;
      }

      // Pane dropped on another pane: rearrange. The indicator has always been
      // drawn here, but nothing acted on it — the drop silently did nothing.
      const panePayload = e.dataTransfer.getData("application/exegol-pane");
      if (panePayload && dropSide) {
        try {
          const { paneId: sourcePaneId, tabId: sourceTabId2 } = JSON.parse(panePayload) as {
            paneId: string;
            tabId: string;
          };
          if (sourceTabId2 === tabId && sourcePaneId !== paneId) {
            movePaneBeside(tabId, sourcePaneId, paneId, dropSide);
            refitNextFrame();
          }
        } catch {
          /* malformed payload — ignore */
        }
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
  const { projectId: paneProjectId } = useProjectContext();
  const pane = useWorkspaceStore((s) => selectPanes(s)[paneId]);
  const setFocusedPane = useWorkspaceStore((s) => s.setFocusedPane);
  const focusedPaneId = useWorkspaceStore((s) => s.focusedPaneId);
  const isFloating = useWorkspaceStore((s) => !!s.floatingPanes[paneId]);
  const isFocused = focusedPaneId === paneId;
  const { dropSide, dropHandlers } = usePaneDropTarget(tabId, paneId);

  // Check if this pane is inside a split (has siblings) — enables drag-out
  const isSplitPane = useWorkspaceStore((s) => {
    const tab = selectTabs(s).find((t) => t.id === tabId);
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
        onSplit={(dir, newType) =>
          useWorkspaceStore.getState().splitPane(tabId, paneId, dir, newType ?? "empty")
        }
        onExtractToTab={() => useWorkspaceStore.getState().extractPaneToNewTab(tabId, paneId)}
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
        onClose={() => closeWithConfirm(closeTargetFor(getProjectState(), tabId, paneId, false))}
      >
        <div className="flex-1 overflow-hidden">
          <PaneBody pane={pane} paneId={paneId} isFloating={isFloating} />
        </div>
      </PaneContextMenu>
    </div>
  );
}
