import { type AgentAccessMode, type IsolationMode, LIVE_STATUSES } from "@exegol/shared";
import { cn } from "@exegol/ui";
import {
  AlertCircle,
  AlertTriangle,
  ExternalLink,
  FolderTree,
  GitBranch,
  Github,
  Loader2,
  MessageSquare,
  Play,
  Shield,
  ShieldAlert,
  TerminalSquare,
  X,
} from "lucide-react";
import { openInBrowser } from "../../lib/open-in-browser";
import { trpcMutate } from "../../lib/trpc-client";
import { AccessModeBadge } from "../common/AccessModeBadge";
import { type QuietAgent, QuietControls } from "../common/QuietControls";
import { SessionAlias } from "../common/SessionAlias";
import { WatchToggle } from "../common/WatchToggle";
import { CliUpdateControl } from "./CliUpdateControl";

interface TerminalToolbarProps {
  /** T160: live agent identity for the session-name chip (omit for shells). */
  agent?: QuietAgent | null;
  accessMode?: AgentAccessMode | null;
  isolationMode?: IsolationMode | null;
  branchName?: string | null;
  /** Uncommitted files in the working tree (0 hides the chip) */
  dirtyCount?: number;
  viewMode: "terminal" | "chat";
  onToggleView: () => void;
  /** T128: a localhost URL seen in the output */
  preview?: { previewUrl: string | null; openPreview: () => void; dismissPreview: () => void };
  /** The repo's web page (origin remote) */
  repoUrl?: string | null;
  /** Open a URL in a browser pane next to this terminal */
  onOpenRepo?: (url: string) => void;
  /** Files panel beside the terminal */
  filesOpen?: boolean;
  onToggleFiles?: () => void;
}

export function TerminalToolbar({
  agent,
  accessMode,
  isolationMode,
  branchName,
  dirtyCount = 0,
  viewMode,
  onToggleView,
  preview,
  repoUrl,
  onOpenRepo,
  filesOpen,
  onToggleFiles,
}: TerminalToolbarProps) {
  return (
    // Badges live on the LEFT — the pane's hover actions (float/split/close)
    // occupy the right edge and were covering them (verify session 2026-08-11).
    <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-2 py-0.5">
      {agent && agent.cliType !== "shell" && <SessionControls agent={agent} />}
      {isolationMode && <IsolationModeBadge mode={isolationMode} branchName={branchName} />}
      {branchName && (
        <span
          className="flex min-w-0 items-center gap-1 text-[9px] text-text-secondary"
          title={`Branch: ${branchName}`}
        >
          <GitBranch className="h-2.5 w-2.5 shrink-0 text-accent/80" />
          <span className="max-w-36 truncate">{branchName}</span>
        </span>
      )}
      {repoUrl && <RepoLink url={repoUrl} onOpenInPane={onOpenRepo} />}
      {onToggleFiles && (
        <button
          type="button"
          onClick={onToggleFiles}
          className={cn(
            "flex shrink-0 items-center gap-1 text-[9px] transition-colors hover:text-text-primary",
            filesOpen ? "text-accent" : "text-text-muted",
          )}
          title={
            filesOpen
              ? "Hide files"
              : "Project files beside the terminal (drag one in to type its path)"
          }
        >
          <FolderTree className="h-2.5 w-2.5" />
          Files
        </button>
      )}
      {dirtyCount > 0 && (
        <span
          className="rounded bg-yellow-500/15 px-1 py-0.5 text-[9px] tabular-nums text-yellow-400"
          title={`${dirtyCount} uncommitted file${dirtyCount === 1 ? "" : "s"}`}
        >
          ±{dirtyCount}
        </span>
      )}
      {accessMode && accessMode !== "write" && <AccessModeBadge mode={accessMode} />}
      <TerminalViewToggle viewMode={viewMode} onToggle={onToggleView} />
      {preview?.previewUrl && (
        <PreviewUrlChip
          url={preview.previewUrl}
          onOpen={preview.openPreview}
          onDismiss={preview.dismissPreview}
        />
      )}
    </div>
  );
}

// ─── T128: localhost preview chip ───────────────────────────────────────────

function PreviewUrlChip({
  url,
  onOpen,
  onDismiss,
}: {
  url: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="ml-auto flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5">
      <button
        type="button"
        onClick={onOpen}
        className="flex items-center gap-1 text-[10px] font-medium text-accent hover:underline"
        title={`Open ${url} in a browser pane`}
      >
        <ExternalLink className="h-3 w-3" />
        Open preview
      </button>
      <span className="max-w-40 truncate text-[9px] text-text-muted">{url}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="flex h-3.5 w-3.5 items-center justify-center rounded text-text-muted hover:text-text-secondary"
        title="Dismiss"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

// ─── T105: Isolation status badge ───────────────────────────────────────────

const ISOLATION_LABEL: Record<
  IsolationMode,
  { label: string; className: string; icon: typeof Shield; tooltip: string }
> = {
  isolated: {
    label: "Worktree",
    className: "bg-green-500/20 text-green-400",
    icon: Shield,
    tooltip: "Running in a dedicated git worktree — changes are isolated from project root.",
  },
  pipeline: {
    label: "Pipeline WT",
    className: "bg-green-500/20 text-green-300",
    icon: GitBranch,
    tooltip: "Running in the pipeline's shared worktree.",
  },
  "project-root": {
    label: "Repo root",
    className: "bg-yellow-500/20 text-yellow-400",
    icon: AlertTriangle,
    tooltip:
      "Running directly in the repo's main checkout — edits touch your working tree (no worktree isolation).",
  },
  fallback: {
    label: "Fallback",
    className: "bg-red-500/20 text-red-400",
    icon: ShieldAlert,
    tooltip: "Worktree creation failed — agent silently fell back to project root. Check logs.",
  },
};

function IsolationModeBadge({
  mode,
  branchName,
}: {
  mode: IsolationMode;
  branchName?: string | null;
}) {
  // Defensive: a future migration or manual DB edit could put a value here
  // that the renderer doesn't know about. Fall back to "project-root" tone
  // rather than crashing the whole terminal pane.
  const config = ISOLATION_LABEL[mode] ?? ISOLATION_LABEL["project-root"];
  const Icon = config.icon;
  const tooltip = branchName ? `${config.tooltip} (branch: ${branchName})` : config.tooltip;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide",
        config.className,
      )}
      title={tooltip}
    >
      <Icon className="h-2.5 w-2.5" />
      {config.label}
    </span>
  );
}

// ─── Repo web page: a pane beside the terminal, or the system browser ───────

function RepoLink({ url, onOpenInPane }: { url: string; onOpenInPane?: (url: string) => void }) {
  const btn =
    "flex items-center gap-1 text-[9px] text-text-muted transition-colors hover:text-text-primary";
  return (
    <span className="flex shrink-0 items-center gap-1">
      {onOpenInPane && (
        <button
          type="button"
          onClick={() => onOpenInPane(url)}
          className={btn}
          title={`Open ${url} in a browser pane (its login is kept)`}
        >
          <Github className="h-3 w-3" />
        </button>
      )}
      {/* The system browser: that is where the user is signed in */}
      <button
        type="button"
        onClick={() => openInBrowser(url)}
        className={btn}
        title={`Open ${url} in your browser`}
      >
        <ExternalLink className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

// ─── Terminal/Chat view toggle button ───────────────────────────────────────

export function TerminalViewToggle({
  viewMode,
  onToggle,
  className,
}: {
  viewMode: "terminal" | "chat";
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-muted transition-colors hover:bg-white/10 hover:text-text-secondary",
        className,
      )}
      title={viewMode === "terminal" ? "Switch to chat view" : "Switch to terminal view"}
    >
      {viewMode === "terminal" ? (
        <>
          <MessageSquare className="h-3 w-3" /> Chat
        </>
      ) : (
        <>
          <TerminalSquare className="h-3 w-3" /> Terminal
        </>
      )}
    </button>
  );
}

// ─── Loading overlay shown until first PTY data arrives ─────────────────────

export function LiveStartOverlay({
  cliType,
  timedOut,
  onDismiss,
  onOpenTerminal,
}: {
  cliType?: string;
  timedOut: boolean;
  onDismiss: () => void;
  /** T155 (verify session): convert the dead pane into a plain shell so the
   *  user can act (check the CLI, rerun by hand) without leaving the window. */
  onOpenTerminal?: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-bg-primary transition-opacity">
      {timedOut ? (
        <>
          <AlertCircle className="h-5 w-5 text-text-muted" />
          <span className="text-[11px] text-text-muted">Failed to start</span>
          <div className="flex items-center gap-2">
            {onOpenTerminal && (
              <button
                type="button"
                onClick={onOpenTerminal}
                className="rounded border border-border px-3 py-1 text-[11px] text-text-secondary hover:bg-white/10 hover:text-text-primary"
              >
                Open Terminal
              </button>
            )}
            <button
              type="button"
              onClick={onDismiss}
              className="rounded px-3 py-1 text-[11px] text-error hover:bg-error/10"
            >
              Dismiss
            </button>
          </div>
        </>
      ) : (
        <>
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
          <span className="text-[11px] text-text-muted">Starting {cliType ?? "agent"}...</span>
        </>
      )}
    </div>
  );
}

/** The session's own controls: its name, Watch, Mute/Suspend while live, and Continue once a
 *  CLI typed in the terminal exited back to the shell prompt */
function SessionControls({ agent }: { agent: QuietAgent }) {
  return (
    <>
      <SessionAlias agent={agent} textClassName="text-[10px]" />
      <WatchToggle agentId={agent.id} className="py-0 text-[9px]" />
      {LIVE_STATUSES.has(agent.status) && (
        <>
          <QuietControls agent={agent} className="py-0 text-[9px]" />
          <CliUpdateControl agentId={agent.id} />
        </>
      )}
      {agent.launchedInShell && agent.status === "idle" && (
        <button
          type="button"
          onClick={() =>
            trpcMutate("agents.continueInShell", { id: agent.id }).catch((err) =>
              console.error("[Terminal] Continue in shell failed:", err),
            )
          }
          className="flex shrink-0 items-center gap-1 text-[9px] text-accent hover:text-text-primary"
          title="Its CLI exited to the shell prompt: start it again here, continuing the last conversation"
        >
          <Play className="h-2.5 w-2.5" />
          Continue
        </button>
      )}
    </>
  );
}
