import type { Agent, AgentScoreRow, AgentStatus } from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, FileDiff, PlayCircle, RotateCcw } from "lucide-react";
import { useCallback, useMemo } from "react";
import { trpcInvoke } from "../../lib/trpc-client";

// Compiled once: ANSI/OSC/CSI strip + residual single-byte controls.
// Built with `new RegExp` so the source doesn't contain literal control
// bytes (which `noControlCharactersInRegex` would reject in a regex literal).
// biome-ignore lint/complexity/useRegexLiterals: literal form would trip noControlCharactersInRegex
const STOP_OSC_RE = new RegExp("\\u001b\\][\\s\\S]*?(?:\\u0007|\\u001b\\\\)", "g");
// biome-ignore lint/complexity/useRegexLiterals: literal form would trip noControlCharactersInRegex
const STOP_CSI_RE = new RegExp("\\u001b\\[[0-9;?]*[ -\\/]*[@-~]", "g");
// biome-ignore lint/complexity/useRegexLiterals: literal form would trip noControlCharactersInRegex
const STOP_CTRL_RE = new RegExp("[\\u0000-\\u0008\\u000b-\\u001f\\u007f]", "g");

const TERMINAL_STATUSES: ReadonlySet<AgentStatus> = new Set([
  "completed",
  "failed",
  "stopped",
  "crashed",
]);

interface AgentStopReasonProps {
  agent: Pick<Agent, "id" | "status" | "cliType" | "taskDescription"> & {
    resumeCommand?: string | null;
  };
  scrollback?: string | null;
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
export function AgentStopReason({
  agent,
  scrollback,
  onResume,
  onSpawnNew,
  onViewDiff,
}: AgentStopReasonProps) {
  const isTerminal = TERMINAL_STATUSES.has(agent.status);
  const { data: score } = useQuery({
    queryKey: ["agentScore", agent.id],
    queryFn: () => trpcInvoke<AgentScoreRow | null>("scoring.getScore", { agentId: agent.id }),
    enabled: isTerminal,
    staleTime: 30_000,
  });

  const lastLines = useMemo(() => extractLastLines(scrollback, 12), [scrollback]);

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

      {lastLines.length > 0 && (
        <pre
          className="max-h-24 overflow-hidden rounded bg-bg-primary/70 p-2 font-mono text-[9px] leading-tight text-text-muted"
          title="Last lines of agent output"
        >
          {lastLines.join("\n")}
        </pre>
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
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 rounded-md border border-border px-2 text-[10px] text-text-secondary hover:bg-white/5"
          onClick={() => onViewDiff(agent.id)}
        >
          <FileDiff className="h-3 w-3" />
          View diff
        </Button>
      </div>
    </div>
  );
}

function extractLastLines(content: string | null | undefined, count: number): string[] {
  if (!content) return [];
  const cleaned = content
    .replace(STOP_OSC_RE, "")
    .replace(STOP_CSI_RE, "")
    .replace(STOP_CTRL_RE, "");
  return cleaned
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(-count);
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
