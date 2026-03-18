import type { AgentCliType } from "@exegol/shared";
import { cn } from "@exegol/ui";
import {
  AlertTriangle,
  Code2,
  Columns,
  Cpu,
  FolderTree,
  Globe,
  RefreshCw,
  Rows,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { useAgent } from "../../hooks/use-trpc";
import { trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useTerminalStore } from "../../stores/terminals";
import { type Pane, useWorkspaceStore } from "../../stores/workspace";
import { EmptyState, LoadingSpinner } from "../common";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { FileExplorer } from "../workspace/FileExplorer";

// ─── Pane Toolbar ───────────────────────────────────────────────────────────

function PaneToolbar({
  tabId,
  paneId,
  paneType,
}: {
  tabId: string;
  paneId: string;
  paneType: string;
}) {
  const splitPane = useWorkspaceStore((s) => s.splitPane);
  const removePane = useWorkspaceStore((s) => s.removePane);
  const { projectId } = useProjectContext();

  const showIdeButton = paneType === "terminal" || paneType === "files";

  const handleOpenInIde = useCallback(() => {
    if (!projectId) return;
    trpcMutate("projects.openInIde", { projectId }).catch((err) => {
      console.error("[PaneToolbar] Open in IDE failed:", err);
    });
  }, [projectId]);

  return (
    <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded bg-bg-secondary/80 opacity-0 transition-opacity group-hover/pane:opacity-100">
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
        onClick={() => removePane(tabId, paneId)}
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
  const [urlInput, setUrlInput] = useState(pane.url ?? "http://localhost:3000");
  const [currentUrl, setCurrentUrl] = useState(pane.url ?? "http://localhost:3000");
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  const setFocusedPane = useWorkspaceStore((s) => s.setFocusedPane);

  const navigate = useCallback(() => {
    let url = urlInput.trim();
    if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
      url = `http://${url}`;
    }
    setCurrentUrl(url);
    updatePane(pane.id, { url });
  }, [urlInput, pane.id, updatePane]);

  const focusedPaneId = useWorkspaceStore((s) => s.focusedPaneId);
  const isFocused = focusedPaneId === paneId;

  return (
    <div role="none" className="flex h-full flex-col" onMouseDown={() => setFocusedPane(paneId)}>
      {/* URL bar */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-bg-secondary px-2">
        <Globe className="h-3 w-3 shrink-0 text-text-muted" />
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
        {/* Transparent overlay to capture clicks when pane is not focused */}
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

interface CliOption {
  type: AgentCliType;
  name: string;
  short: string;
  color: string;
}

const CLI_OPTIONS: CliOption[] = [
  { type: "claude-code", name: "Claude Code", short: "C", color: "#D97706" },
  { type: "codex", name: "Codex", short: "Co", color: "#10B981" },
  { type: "gemini", name: "Gemini", short: "G", color: "#3B82F6" },
  { type: "aider", name: "Aider", short: "A", color: "#8B5CF6" },
  { type: "opencode", name: "OpenCode", short: "OC", color: "#EC4899" },
  { type: "goose", name: "Goose", short: "Go", color: "#F97316" },
  { type: "amp", name: "Amp", short: "Am", color: "#06B6D4" },
  { type: "kiro", name: "Kiro", short: "K", color: "#84CC16" },
];

function EmptyPane({ paneId }: { paneId: string }) {
  const { projectId } = useProjectContext();
  const [launching, setLaunching] = useState<string | null>(null);
  const addAgent = useAgentStore((s) => s.addAgent);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const updatePane = useWorkspaceStore((s) => s.updatePane);

  const handleLaunchAgent = useCallback(
    async (cli: CliOption) => {
      if (!projectId) return;
      setLaunching(cli.type);
      try {
        // biome-ignore lint/suspicious/noExplicitAny: tRPC dynamic shape
        const agent = await trpcMutate<any>("agents.spawn", {
          projectId,
          cliType: cli.type,
          taskDescription: cli.name,
        });

        addAgent({
          id: agent.id,
          projectId,
          cliType: agent.cliType,
          status: agent.status,
          currentStep: agent.currentStep,
          taskDescription: agent.taskDescription,
          branchName: null,
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

  const handleBrowser = useCallback(() => {
    updatePane(paneId, { type: "browser", url: "http://localhost:3000" });
  }, [paneId, updatePane]);

  const handleFiles = useCallback(() => {
    updatePane(paneId, { type: "files" });
  }, [paneId, updatePane]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-bg-secondary">
        <Cpu className="h-7 w-7 text-text-muted" />
      </div>
      <div className="text-center">
        <h2 className="text-sm font-semibold text-text-primary">Launch an Agent</h2>
        <p className="mt-1 max-w-xs text-[11px] text-text-muted">
          Select an agent or open a browser pane.
        </p>
      </div>

      {/* Agent grid */}
      <div className="grid w-full max-w-sm grid-cols-4 gap-2 px-4">
        {CLI_OPTIONS.map((cli) => (
          <button
            key={cli.type}
            type="button"
            disabled={launching === cli.type}
            onClick={() => handleLaunchAgent(cli)}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-lg border border-border bg-bg-secondary p-2.5 transition-all hover:border-accent/50 hover:bg-white/[0.03]",
              launching === cli.type && "opacity-50",
            )}
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold text-white"
              style={{ background: cli.color }}
            >
              {cli.short}
            </span>
            <span className="text-[9px] font-medium text-text-secondary">{cli.name}</span>
          </button>
        ))}
      </div>

      {/* Extra pane options */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleBrowser}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-[11px] text-text-secondary transition-all hover:border-accent/50 hover:bg-white/[0.03]"
        >
          <Globe className="h-3.5 w-3.5" />
          Browser
        </button>
        <button
          type="button"
          onClick={handleFiles}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-[11px] text-text-secondary transition-all hover:border-accent/50 hover:bg-white/[0.03]"
        >
          <FolderTree className="h-3.5 w-3.5" />
          Files
        </button>
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
  const invalidatePane = useWorkspaceStore((s) => s.invalidatePane);

  // Agent fetch failed — move side-effect out of render body
  useEffect(() => {
    if (isError) {
      invalidatePane(paneId, `Agent "${agentId}" no longer exists.`);
    }
  }, [isError, paneId, agentId, invalidatePane]);

  if (isError) return null;

  // Agent found or still loading
  if (agent === undefined) {
    return <LoadingSpinner label="Loading agent..." className="h-full" />;
  }

  return <TerminalPanel agentId={agentId} />;
}

// ─── Files Pane ─────────────────────────────────────────────────────────

function FilesPaneContent() {
  const { project } = useProjectContext();
  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-text-muted">No project selected</p>
      </div>
    );
  }
  return <FileExplorer rootPath={project.path} />;
}

// ─── Main WorkspacePane ─────────────────────────────────────────────────────

interface WorkspacePaneProps {
  paneId: string;
  tabId: string;
}

export function WorkspacePane({ paneId, tabId }: WorkspacePaneProps) {
  const pane = useWorkspaceStore((s) => s.panes[paneId]);
  const setFocusedPane = useWorkspaceStore((s) => s.setFocusedPane);
  const focusedPaneId = useWorkspaceStore((s) => s.focusedPaneId);
  const isFocused = focusedPaneId === paneId;

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
    >
      <PaneToolbar tabId={tabId} paneId={paneId} paneType={pane.type} />
      <div className="flex-1 overflow-hidden">
        {pane.invalidReason && <InvalidPane reason={pane.invalidReason} paneId={paneId} />}
        {!pane.invalidReason && pane.type === "terminal" && pane.agentId && (
          <RecoverableTerminalPane agentId={pane.agentId} paneId={paneId} />
        )}
        {!pane.invalidReason && pane.type === "browser" && (
          <BrowserPane pane={pane} paneId={paneId} />
        )}
        {!pane.invalidReason && pane.type === "files" && <FilesPaneContent />}
        {!pane.invalidReason && pane.type === "empty" && <EmptyPane paneId={paneId} />}
        {!pane.invalidReason && pane.type === "terminal" && !pane.agentId && (
          <EmptyPane paneId={paneId} />
        )}
      </div>
    </div>
  );
}
