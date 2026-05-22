import type { AgentAccessMode } from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { AlertCircle, ArrowRight, Loader2, MessageSquare, TerminalSquare } from "lucide-react";

interface TerminalToolbarProps {
  accessMode?: AgentAccessMode | null;
  viewMode: "terminal" | "chat";
  onToggleView: () => void;
}

export function TerminalToolbar({ accessMode, viewMode, onToggleView }: TerminalToolbarProps) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-b border-border/40 px-2 py-0.5">
      {accessMode && accessMode !== "write" && <AccessModeBadge mode={accessMode} />}
      <TerminalViewToggle viewMode={viewMode} onToggle={onToggleView} />
    </div>
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
