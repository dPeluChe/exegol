import type { AgentCliType, AgentProvider } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Code2,
  Columns,
  Cpu,
  FolderTree,
  GitBranch,
  Globe,
  GripVertical,
  RefreshCw,
  Rows,
  Terminal,
  X,
} from "lucide-react";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { useAgent } from "../../hooks/use-trpc";
import {
  type PortInfo,
  usePreferredPort,
  useProjectPorts,
  useProjectScripts,
  useSetPreferredPort,
} from "../../hooks/use-trpc-scheduler";
import { dispatchRefitTerminals } from "../../lib/dispatch-refit";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useTerminalStore } from "../../stores/terminals";
import { collectPaneIds, type Pane, useWorkspaceStore } from "../../stores/workspace";
import { AgentIcon, EmptyState, LoadingSpinner } from "../common";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { FileExplorer } from "../workspace/FileExplorer";
import { GitPane } from "../workspace/GitPane";

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
  const panes = useWorkspaceStore((s) => s.panes);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const { projectId } = useProjectContext();

  const showIdeButton = paneType === "terminal" || paneType === "files";

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

function BrowserPane({ pane, paneId }: { pane: Pane; paneId: string }) {
  const { projectId, project } = useProjectContext();
  const { data: ports } = useProjectPorts(project?.path ?? null);
  const { data: preferredPort } = usePreferredPort(projectId);
  const setPreferred = useSetPreferredPort();
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  const setFocusedPane = useWorkspaceStore((s) => s.setFocusedPane);

  // Deduplicate ports, prefer runtime over config
  const uniquePorts = useMemo(() => {
    if (!ports) return [];
    const map = new Map<number, PortInfo>();
    for (const p of ports) {
      const existing = map.get(p.port);
      if (!existing || (p.source === "runtime" && existing.source === "config")) {
        map.set(p.port, p);
      }
    }
    return Array.from(map.values());
  }, [ports]);

  const initUrl = pane.url ?? "http://localhost:3000";
  const [urlInput, setUrlInput] = useState(initUrl);
  const [currentUrl, setCurrentUrl] = useState(initUrl);
  const [didAutoSync, setDidAutoSync] = useState(!!pane.url);

  // Auto-sync to preferred or first detected port on initial load (once)
  useEffect(() => {
    if (didAutoSync) return;
    const port =
      preferredPort ??
      uniquePorts.find((p) => p.source === "runtime")?.port ??
      uniquePorts[0]?.port;
    if (port) {
      const url = `http://localhost:${port}`;
      setUrlInput(url);
      setCurrentUrl(url);
      updatePane(pane.id, { url });
      setDidAutoSync(true);
    }
  }, [didAutoSync, preferredPort, uniquePorts, pane.id, updatePane]);

  const navigate = useCallback(() => {
    let url = urlInput.trim();
    if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
      url = `http://${url}`;
    }
    setCurrentUrl(url);
    updatePane(pane.id, { url });
  }, [urlInput, pane.id, updatePane]);

  const navigateToPort = useCallback(
    (port: number) => {
      const url = `http://localhost:${port}`;
      setUrlInput(url);
      setCurrentUrl(url);
      updatePane(pane.id, { url });
    },
    [pane.id, updatePane],
  );

  const focusedPaneId = useWorkspaceStore((s) => s.focusedPaneId);
  const isFocused = focusedPaneId === paneId;

  return (
    <div role="none" className="flex h-full flex-col" onMouseDown={() => setFocusedPane(paneId)}>
      {/* URL bar */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-bg-secondary px-2">
        <Globe className="h-3 w-3 shrink-0 text-text-muted" />
        {uniquePorts.length > 0 && (
          <div className="flex shrink-0 items-center gap-0.5">
            {uniquePorts.map((p) => (
              <button
                key={p.port}
                type="button"
                onClick={() => navigateToPort(p.port)}
                className={cn(
                  "flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] transition-colors",
                  currentUrl.includes(`:${p.port}`)
                    ? "bg-accent/20 text-accent"
                    : "text-text-muted hover:bg-white/10 hover:text-text-primary",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    p.source === "runtime" ? "bg-green-500" : "bg-zinc-500",
                  )}
                />
                {p.port}
                {projectId && (
                  <button
                    type="button"
                    className={cn(
                      "ml-0.5 cursor-pointer text-[8px]",
                      preferredPort === p.port ? "text-amber-400" : "text-text-muted/40",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreferred.mutate({ projectId, port: p.port });
                    }}
                    title={preferredPort === p.port ? "Preferred port" : "Set as preferred"}
                  >
                    &#9733;
                  </button>
                )}
              </button>
            ))}
          </div>
        )}
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onFocus={() => setFocusedPane(paneId)}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate();
          }}
          className="flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted"
          placeholder="http://localhost:3000"
        />
        <button
          type="button"
          onClick={navigate}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
          title="Refresh / Go"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
      {/* Webview with focus capture overlay when not active */}
      <div className="relative flex-1">
        <webview
          src={currentUrl}
          className="h-full w-full"
          /* @ts-expect-error Electron webview attributes */
          allowpopups="true"
        />
        {!isFocused && (
          <div
            role="none"
            className="absolute inset-0 z-10"
            onMouseDown={() => setFocusedPane(paneId)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Empty Pane (Agent Grid) ────────────────────────────────────────────────

function EmptyPane({ paneId }: { paneId: string }) {
  const { projectId, project } = useProjectContext();
  const { data: scripts } = useProjectScripts(project?.path ?? null);
  const [launching, setLaunching] = useState<string | null>(null);
  const addAgent = useAgentStore((s) => s.addAgent);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<"full" | "compact" | "mini">("full");
  const { data: providers } = useQuery({
    queryKey: ["enabledProviders"],
    queryFn: () => trpcInvoke<AgentProvider[]>("agents.listEnabledProviders"),
    staleTime: 30_000,
  });
  const cliOptions = providers ?? [];

  // Observe pane size for responsive layout
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const w = entry.contentRect.width;
      const h = entry.contentRect.height;
      if (w < 300 || h < 250) setSize("mini");
      else if (w < 500 || h < 400) setSize("compact");
      else setSize("full");
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleLaunchAgent = useCallback(
    async (cli: AgentProvider) => {
      if (!projectId) return;
      setLaunching(cli.id);
      try {
        // biome-ignore lint/suspicious/noExplicitAny: tRPC dynamic shape
        const agent = await trpcMutate<any>("agents.spawn", {
          projectId,
          cliType: cli.id as AgentCliType,
          taskDescription: cli.name,
        });

        addAgent({
          id: agent.id,
          projectId,
          cliType: agent.cliType,
          status: agent.status,
          currentStep: agent.currentStep,
          taskDescription: agent.taskDescription,
          branchName: agent.branchName ?? null,
          tokenUsage: { input: 0, output: 0, cost: 0 },
          startedAt: agent.startedAt,
        });
        createTerminal(agent.id);

        // Convert this empty pane to a terminal pane
        updatePane(paneId, { type: "terminal", agentId: agent.id });
      } catch (err) {
        console.error("[EmptyPane] Spawn failed:", err);
      } finally {
        setLaunching(null);
      }
    },
    [projectId, paneId, addAgent, createTerminal, updatePane],
  );

  const handleBrowser = useCallback(async () => {
    let url = "http://localhost:3000";
    try {
      // Preferred port > first runtime port > first config port > 3000
      if (projectId) {
        const preferred = await trpcInvoke<number | null>("resources.preferredPort", { projectId });
        if (preferred) {
          url = `http://localhost:${preferred}`;
        } else if (project?.path) {
          const ports = await trpcInvoke<PortInfo[]>("resources.ports", {
            projectPath: project.path,
          });
          const runtime = ports?.find((p) => p.source === "runtime");
          const first = runtime ?? ports?.[0];
          if (first) url = `http://localhost:${first.port}`;
        }
      }
    } catch {
      /* fallback to default */
    }
    updatePane(paneId, { type: "browser", url });
  }, [paneId, projectId, project?.path, updatePane]);

  const handleFiles = useCallback(() => {
    updatePane(paneId, { type: "files" });
  }, [paneId, updatePane]);

  const handleGit = useCallback(() => {
    updatePane(paneId, { type: "git" });
  }, [paneId, updatePane]);

  const handleShell = useCallback(async () => {
    if (!projectId) return;
    setLaunching("shell");
    try {
      // biome-ignore lint/suspicious/noExplicitAny: tRPC dynamic shape
      const agent = await trpcMutate<any>("agents.spawn", {
        projectId,
        cliType: "shell",
        taskDescription: "Terminal",
      });
      addAgent({
        id: agent.id,
        projectId,
        cliType: agent.cliType,
        status: agent.status,
        currentStep: agent.currentStep,
        taskDescription: agent.taskDescription,
        branchName: agent.branchName ?? null,
        tokenUsage: { input: 0, output: 0, cost: 0 },
        startedAt: agent.startedAt,
      });
      createTerminal(agent.id);
      updatePane(paneId, { type: "terminal", agentId: agent.id });
    } catch (err) {
      console.error("[EmptyPane] Shell spawn failed:", err);
    } finally {
      setLaunching(null);
    }
  }, [projectId, paneId, addAgent, createTerminal, updatePane]);

  const handleRunScript = useCallback(
    async (command: string, label: string) => {
      if (!projectId) return;
      setLaunching(`script-${label}`);
      try {
        // biome-ignore lint/suspicious/noExplicitAny: tRPC dynamic shape
        const agent = await trpcMutate<any>("agents.spawn", {
          projectId,
          cliType: "shell",
          taskDescription: label,
        });
        addAgent({
          id: agent.id,
          projectId,
          cliType: agent.cliType,
          status: agent.status,
          currentStep: agent.currentStep,
          taskDescription: agent.taskDescription,
          branchName: agent.branchName ?? null,
          tokenUsage: { input: 0, output: 0, cost: 0 },
          startedAt: agent.startedAt,
        });
        createTerminal(agent.id);
        updatePane(paneId, { type: "terminal", agentId: agent.id });
        // Inject command into shell (queued until PTY is ready)
        window.api.terminal.write(agent.id, `${command}\n`);
      } catch (err) {
        console.error("[EmptyPane] Script launch failed:", err);
      } finally {
        setLaunching(null);
      }
    },
    [projectId, paneId, addAgent, createTerminal, updatePane],
  );

  const isMini = size === "mini";
  const isCompact = size === "compact" || isMini;
  const iconSize = isMini ? 18 : isCompact ? 22 : 28;
  const gridCols = isMini ? "grid-cols-4" : isCompact ? "grid-cols-4" : "grid-cols-4";

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col items-center justify-center overflow-y-auto p-3"
    >
      {/* Header — hidden in mini */}
      {!isMini && (
        <div className="mb-3 flex shrink-0 flex-col items-center gap-2">
          <div
            className={cn(
              "flex items-center justify-center rounded-2xl bg-bg-secondary",
              isCompact ? "h-9 w-9" : "h-12 w-12",
            )}
          >
            <Cpu className={cn("text-text-muted", isCompact ? "h-4 w-4" : "h-6 w-6")} />
          </div>
          <div className="text-center">
            <h2
              className={cn("font-semibold text-text-primary", isCompact ? "text-xs" : "text-sm")}
            >
              Launch an Agent
            </h2>
            {!isCompact && (
              <p className="mt-0.5 text-[11px] text-text-muted">Select an agent or open a pane.</p>
            )}
          </div>
        </div>
      )}

      {/* Agent grid — responsive columns and sizes */}
      <div className={cn("grid w-full gap-1.5", gridCols, isMini ? "max-w-xs" : "max-w-sm")}>
        {cliOptions.map((cli) => (
          <button
            key={cli.id}
            type="button"
            disabled={launching === cli.id}
            onClick={() => handleLaunchAgent(cli)}
            className={cn(
              "flex flex-col items-center rounded-lg border border-border bg-bg-secondary transition-all hover:border-accent/50 hover:bg-white/[0.03]",
              isMini ? "gap-0.5 p-1.5" : isCompact ? "gap-1 p-2" : "gap-1.5 p-2.5",
              launching === cli.id && "opacity-50",
            )}
          >
            <AgentIcon
              provider={cli.id}
              size={iconSize}
              fallback={cli.icon}
              fallbackColor={cli.color}
            />
            {!isMini && (
              <span
                className={cn(
                  "font-medium text-text-secondary",
                  isCompact ? "text-[8px]" : "text-[9px]",
                )}
              >
                {cli.name}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Dev scripts quick-launch */}
      {scripts && scripts.length > 0 && (
        <div className={cn("flex w-full flex-col items-center", isMini ? "mt-1.5" : "mt-3")}>
          {!isMini && <span className="mb-1 text-[9px] text-text-muted">Dev Scripts</span>}
          <div className="flex flex-wrap justify-center gap-1">
            {scripts.map((s) => (
              <button
                key={s.command}
                type="button"
                disabled={launching === `script-${s.name}`}
                onClick={() => handleRunScript(s.command, s.name)}
                className={cn(
                  "flex items-center gap-1 rounded-lg border border-border bg-bg-secondary text-text-secondary transition-all hover:border-accent/50 hover:bg-white/[0.03]",
                  isMini ? "px-2 py-1 text-[9px]" : "px-3 py-1.5 text-[11px]",
                  launching === `script-${s.name}` && "opacity-50",
                )}
              >
                <Terminal className={cn(isMini ? "h-3 w-3" : "h-3.5 w-3.5")} />
                {s.name}
                {!isMini && s.framework && (
                  <span className="text-[9px] text-text-muted">({s.framework})</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pane options — compact in small sizes */}
      <div className={cn("flex shrink-0 items-center", isMini ? "mt-1.5 gap-1" : "mt-3 gap-2")}>
        {[
          { handler: handleShell, icon: Terminal, label: "Terminal" },
          { handler: handleBrowser, icon: Globe, label: "Browser" },
          { handler: handleFiles, icon: FolderTree, label: "Files" },
          { handler: handleGit, icon: GitBranch, label: "Git" },
        ].map(({ handler, icon: PaneIcon, label }) => (
          <button
            key={label}
            type="button"
            onClick={handler}
            className={cn(
              "flex items-center gap-1 rounded-lg border border-border bg-bg-secondary text-text-secondary transition-all hover:border-accent/50 hover:bg-white/[0.03]",
              isMini ? "px-2 py-1 text-[9px]" : "px-3 py-1.5 text-[11px]",
            )}
          >
            <PaneIcon className={cn(isMini ? "h-3 w-3" : "h-3.5 w-3.5")} />
            {!isMini && label}
          </button>
        ))}
      </div>
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
  const updatePane = useWorkspaceStore((s) => s.updatePane);

  // Agent not found — convert pane to empty (agent was deleted)
  useEffect(() => {
    if (isError) {
      updatePane(paneId, { type: "empty", agentId: undefined });
    }
  }, [isError, paneId, updatePane]);

  if (isError) return null;

  // Agent found or still loading
  if (agent === undefined) {
    return <LoadingSpinner label="Loading agent..." className="h-full" />;
  }

  return <TerminalPanel agentId={agentId} paneId={paneId} />;
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
  const pane = useWorkspaceStore((s) => s.panes[paneId]);
  const setFocusedPane = useWorkspaceStore((s) => s.setFocusedPane);
  const mergeTabIntoSplit = useWorkspaceStore((s) => s.mergeTabIntoSplit);
  const focusedPaneId = useWorkspaceStore((s) => s.focusedPaneId);
  const isFocused = focusedPaneId === paneId;
  const [dropSide, setDropSide] = useState<"left" | "right" | "top" | "bottom" | null>(null);

  // Check if this pane is inside a split (has siblings) — enables drag-out
  const isSplitPane = useWorkspaceStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId);
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
      <div className="flex-1 overflow-hidden">
        {pane.invalidReason && <InvalidPane reason={pane.invalidReason} paneId={paneId} />}
        {!pane.invalidReason && pane.type === "terminal" && pane.agentId && (
          <RecoverableTerminalPane agentId={pane.agentId} paneId={paneId} />
        )}
        {!pane.invalidReason && pane.type === "browser" && (
          <BrowserPane pane={pane} paneId={paneId} />
        )}
        {!pane.invalidReason && pane.type === "files" && (
          <FilesPaneContent key={pane.filePath ?? "default"} overridePath={pane.filePath} />
        )}
        {!pane.invalidReason && pane.type === "git" && (
          <GitPane key={pane.filePath ?? "default"} overridePath={pane.filePath} />
        )}
        {!pane.invalidReason && pane.type === "empty" && <EmptyPane paneId={paneId} />}
        {!pane.invalidReason && pane.type === "terminal" && !pane.agentId && (
          <EmptyPane paneId={paneId} />
        )}
      </div>
    </div>
  );
}
