import type { AgentAccessMode, IsolationMode } from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  GitBranch,
  Loader2,
  MessageSquare,
  Shield,
  ShieldAlert,
  TerminalSquare,
  X,
} from "lucide-react";

interface TerminalToolbarProps {
  accessMode?: AgentAccessMode | null;
  isolationMode?: IsolationMode | null;
  branchName?: string | null;
  viewMode: "terminal" | "chat";
  onToggleView: () => void;
  previewUrl?: string | null;
  onOpenPreview?: () => void;
  onDismissPreview?: () => void;
}

export function TerminalToolbar({
  accessMode,
  isolationMode,
  branchName,
  viewMode,
  onToggleView,
  previewUrl,
  onOpenPreview,
  onDismissPreview,
}: TerminalToolbarProps) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-b border-border/40 px-2 py-0.5">
      {previewUrl && onOpenPreview && onDismissPreview && (
        <PreviewUrlChip url={previewUrl} onOpen={onOpenPreview} onDismiss={onDismissPreview} />
      )}
      {isolationMode && <IsolationModeBadge mode={isolationMode} branchName={branchName} />}
      {accessMode && accessMode !== "write" && <AccessModeBadge mode={accessMode} />}
      <TerminalViewToggle viewMode={viewMode} onToggle={onToggleView} />
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
    <div className="mr-auto flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5">
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
    label: "Isolated",
    className: "bg-green-500/20 text-green-400",
    icon: Shield,
    tooltip: "Running in a dedicated git worktree — changes are isolated from project root.",
  },
  pipeline: {
    label: "Pipeline",
    className: "bg-green-500/20 text-green-300",
    icon: GitBranch,
    tooltip: "Running in a shared pipeline worktree.",
  },
  "project-root": {
    label: "Root",
    className: "bg-yellow-500/20 text-yellow-400",
    icon: AlertTriangle,
    tooltip: "Running directly in project root — changes affect the main checkout.",
  },
  fallback: {
    label: "Fallback",
    className: "bg-red-500/20 text-red-400",
    icon: ShieldAlert,
    tooltip: "Worktree creation failed — agent silently fell back to project root. Check logs.",
  },
};

export function IsolationModeBadge({
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

// ─── T58: Access mode badge ──────────────────────────────────────────────────

const ACCESS_MODE_LABEL: Partial<Record<AgentAccessMode, { label: string; className: string }>> = {
  read: { label: "read-only", className: "bg-blue-500/20 text-blue-400" },
  plan: { label: "plan-only", className: "bg-purple-500/20 text-purple-400" },
};

export function AccessModeBadge({ mode }: { mode: AgentAccessMode }) {
  const config = ACCESS_MODE_LABEL[mode];
  if (!config) return null;
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide",
        config.className,
      )}
      title={`Agent running in ${config.label} mode`}
    >
      {config.label}
    </span>
  );
}

// ─── Loading overlay shown until first PTY data arrives ─────────────────────

export function LiveStartOverlay({
  cliType,
  timedOut,
  onDismiss,
}: {
  cliType?: string;
  timedOut: boolean;
  onDismiss: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-bg-primary transition-opacity">
      {timedOut ? (
        <>
          <AlertCircle className="h-5 w-5 text-text-muted" />
          <span className="text-[11px] text-text-muted">Failed to start</span>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded px-3 py-1 text-[11px] text-error hover:bg-error/10"
          >
            Dismiss
          </button>
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

// ─── Handoff "token limit approaching" banner shown on live agents ──────────

export function LiveHandoffBanner({
  onContinue,
  loading,
}: {
  onContinue: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 bg-orange-500/10 px-3 py-1.5 text-[11px]">
      <AlertCircle className="h-3.5 w-3.5 text-orange-400" />
      <span className="text-orange-200/80">Token limit approaching — handoff ready</span>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-6 gap-1 px-2 text-[11px] text-accent"
        onClick={onContinue}
        disabled={loading}
      >
        <ArrowRight className="h-3 w-3" />
        {loading ? "Spawning..." : "Continue with new agent"}
      </Button>
    </div>
  );
}
