import type { Agent, AgentScoreRow, AgentStatus } from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, FileDiff, PlayCircle, RotateCcw } from "lucide-react";
import { useCallback } from "react";
import { trpcInvoke } from "../../lib/trpc-client";

const TERMINAL_STATUSES: ReadonlySet<AgentStatus> = new Set([
  "completed",
  "failed",
  "stopped",
  "crashed",
]);

interface AgentStopReasonProps {
  agent: Pick<Agent, "id" | "status" | "cliType" | "taskDescription"> & {
    resumeCommand?: string | null;
    currentStep?: string | null;
    branchName?: string | null;
  };
  onResume?: () => void;
  onSpawnNew: (taskDescription: string) => void;
  onViewDiff: (agentId: string) => void;
}

/**
 * Overlay panel shown above a stopped/crashed agent's scrollback. Surfaces
 * status, exit code, last lines, and three actions: Resume (only when the
 * CLI captured a resume command), New Agent (pre-fills the spawn modal),
 * and View Diff (jumps to the git pane scoped to this agent's worktree).
 */
export function AgentStopReason({ agent, onResume, onSpawnNew, onViewDiff }: AgentStopReasonProps) {
  const isTerminal = TERMINAL_STATUSES.has(agent.status);
  const { data: score } = useQuery({
    queryKey: ["agentScore", agent.id],
    queryFn: () => trpcInvoke<AgentScoreRow | null>("scoring.getScore", { agentId: agent.id }),
    enabled: isTerminal,
    staleTime: 30_000,
  });

  const handleSpawnNew = useCallback(() => {
    onSpawnNew(agent.taskDescription);
  }, [agent.taskDescription, onSpawnNew]);

  if (!isTerminal) return null;

  const tone = TONE_BY_STATUS[agent.status] ?? TONE_BY_STATUS.completed;
  const canResume = !!agent.resumeCommand && !!onResume;

  return (
    <div className={cn("flex flex-col gap-2 border-b px-3 py-2 text-[11px]", tone.border, tone.bg)}>
      <div className="flex items-center gap-2">
        <AlertCircle className={cn("h-3.5 w-3.5 shrink-0", tone.text)} />
        <span className={cn("font-semibold", tone.text)}>{tone.label}</span>
        <span className="text-text-muted">·</span>
        <span className="text-text-muted">{agent.cliType}</span>
        {score && (
          <>
            <span className="text-text-muted">·</span>
            <span className="text-text-muted">exit {score.exitCode}</span>
            {score.exitReason && score.exitReason !== "unknown" && (
              <>
                <span className="text-text-muted">·</span>
                <span className="text-text-muted">{score.exitReason}</span>
              </>
            )}
          </>
        )}
      </div>

      {/* The failure detail (last scraped line: "Failed to resume session from
          …") used to live only in the app log — a spawn that died immediately
          showed "Failed" and nothing readable (verify 2026-08-12). */}
      {agent.status !== "completed" && agent.currentStep && (
        <p className="rounded border border-border/60 bg-black/20 px-2 py-1 font-mono text-[10px] leading-relaxed text-text-secondary">
          {agent.currentStep}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {canResume && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 rounded-md border border-accent/30 px-2 text-[10px] text-accent hover:bg-accent/10"
            onClick={onResume}
            title={`Resume session: ${agent.resumeCommand}`}
          >
            <PlayCircle className="h-3 w-3" />
            Resume session
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 rounded-md border border-border px-2 text-[10px] text-text-secondary hover:bg-white/5"
          onClick={handleSpawnNew}
        >
          <RotateCcw className="h-3 w-3" />
          New agent with same task
        </Button>
        {/* A session that died on startup changed nothing — offering a diff
            sends the user to an empty screen. */}
        {(agent.branchName || (score?.filesChanged ?? 0) > 0) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 rounded-md border border-border px-2 text-[10px] text-text-secondary hover:bg-white/5"
            onClick={() => onViewDiff(agent.id)}
          >
            <FileDiff className="h-3 w-3" />
            View diff
          </Button>
        )}
      </div>
    </div>
  );
}

const TONE_BY_STATUS: Record<
  AgentStatus,
  { label: string; bg: string; text: string; border: string }
> = {
  completed: {
    label: "Completed",
    bg: "bg-green-500/10",
    text: "text-green-300",
    border: "border-green-500/30",
  },
  failed: {
    label: "Failed",
    bg: "bg-red-500/10",
    text: "text-red-300",
    border: "border-red-500/30",
  },
  stopped: {
    label: "Stopped",
    bg: "bg-yellow-500/10",
    text: "text-yellow-300",
    border: "border-yellow-500/30",
  },
  crashed: {
    label: "Crashed",
    bg: "bg-red-500/15",
    text: "text-red-300",
    border: "border-red-500/40",
  },
  // Non-terminal states (not rendered, but keep the map exhaustive)
  idle: { label: "Idle", bg: "", text: "", border: "" },
  spawning: { label: "Spawning", bg: "", text: "", border: "" },
  running: { label: "Running", bg: "", text: "", border: "" },
  waiting_input: { label: "Waiting input", bg: "", text: "", border: "" },
  paused: { label: "Paused", bg: "", text: "", border: "" },
};
