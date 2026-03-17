import type { AgentCliType, AgentStatus } from "@exegol/shared";
import { Badge, cn } from "@exegol/ui";
import { Coins, GitBranch } from "lucide-react";
import { type AgentState, useAgentStore } from "../../stores/agents";

const CLI_COLORS: Record<AgentCliType, string> = {
  "claude-code": "#d97706",
  codex: "#22c55e",
  gemini: "#3b82f6",
  aider: "#8b5cf6",
  opencode: "#06b6d4",
  goose: "#f97316",
  amp: "#ec4899",
  kiro: "#14b8a6",
  custom: "#6b7280",
};

const STATUS_CONFIG: Record<
  AgentStatus,
  { label: string; className: string; dotColor: string; pulse: boolean }
> = {
  idle: {
    label: "Idle",
    className: "border-zinc-600 text-zinc-400",
    dotColor: "#71717a",
    pulse: false,
  },
  spawning: {
    label: "Spawning",
    className: "border-blue-600/50 text-blue-400",
    dotColor: "#3b82f6",
    pulse: true,
  },
  running: {
    label: "Running",
    className: "border-green-600/50 text-green-400",
    dotColor: "#22c55e",
    pulse: true,
  },
  waiting_input: {
    label: "Waiting",
    className: "border-yellow-600/50 text-yellow-400",
    dotColor: "#eab308",
    pulse: true,
  },
  paused: {
    label: "Paused",
    className: "border-zinc-600 text-zinc-400",
    dotColor: "#71717a",
    pulse: false,
  },
  completed: {
    label: "Done",
    className: "border-green-600/50 text-green-400",
    dotColor: "#22c55e",
    pulse: false,
  },
  failed: {
    label: "Failed",
    className: "border-red-600/50 text-red-400",
    dotColor: "#ef4444",
    pulse: false,
  },
  stopped: {
    label: "Stopped",
    className: "border-zinc-600 text-zinc-400",
    dotColor: "#71717a",
    pulse: false,
  },
};

interface AgentCardProps {
  agent: AgentState;
}

export function AgentCard({ agent }: AgentCardProps) {
  const focusedAgentId = useAgentStore((s) => s.focusedAgentId);
  const setFocusedAgent = useAgentStore((s) => s.setFocusedAgent);

  const isFocused = focusedAgentId === agent.id;
  const statusConfig = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.idle;
  const cliColor = CLI_COLORS[agent.cliType] ?? CLI_COLORS.custom;

  const totalTokens = agent.tokenUsage.input + agent.tokenUsage.output;
  const costStr =
    agent.tokenUsage.cost < 0.01
      ? totalTokens > 0
        ? "<$0.01"
        : "--"
      : `$${agent.tokenUsage.cost.toFixed(2)}`;

  return (
    <button
      type="button"
      onClick={() => setFocusedAgent(agent.id)}
      className={cn(
        "flex w-full flex-col gap-1 rounded-md p-2 text-left transition-colors",
        "hover:bg-white/5",
        isFocused && "bg-white/10 ring-1 ring-[var(--accent)]",
      )}
    >
      {/* Header: CLI dot + description + status */}
      <div className="flex items-start gap-2">
        {/* CLI type indicator */}
        <div
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: cliColor }}
          title={agent.cliType}
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-text-primary">{agent.taskDescription}</p>
        </div>

        {/* Status badge */}
        <Badge
          variant="outline"
          className={cn("shrink-0 px-1.5 py-0 text-[10px]", statusConfig.className)}
        >
          <span
            className={cn(
              "mr-1 inline-block h-1.5 w-1.5 rounded-full",
              statusConfig.pulse && "animate-status-pulse",
            )}
            style={{ background: statusConfig.dotColor }}
          />
          {statusConfig.label}
        </Badge>
      </div>

      {/* Current step */}
      {agent.currentStep && (
        <p className="truncate pl-[18px] text-[10px] text-text-muted">{agent.currentStep}</p>
      )}

      {/* Footer: branch + tokens */}
      <div className="flex items-center gap-2 pl-[18px]">
        {agent.branchName && (
          <span className="flex items-center gap-0.5 text-[10px] text-text-muted">
            <GitBranch className="h-2.5 w-2.5" />
            <span className="max-w-[80px] truncate">{agent.branchName}</span>
          </span>
        )}
        {totalTokens > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-text-muted">
            <Coins className="h-2.5 w-2.5" />
            {costStr}
          </span>
        )}
      </div>
    </button>
  );
}
