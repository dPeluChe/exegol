import type { AgentCliType, AgentStatus } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Plus, X } from "lucide-react";
import { type AgentState, useAgentStore } from "../../stores/agents";
import { useTerminalStore } from "../../stores/terminals";

const CLI_SHORT_LABELS: Record<AgentCliType, string> = {
  "claude-code": "Claude",
  codex: "Codex",
  gemini: "Gemini",
  aider: "Aider",
  opencode: "OC",
  goose: "Goose",
  amp: "Amp",
  kiro: "Kiro",
  custom: "Custom",
};

const STATUS_DOT_COLORS: Record<AgentStatus, string> = {
  idle: "#71717a",
  spawning: "#3b82f6",
  running: "#22c55e",
  waiting_input: "#eab308",
  paused: "#71717a",
  completed: "#22c55e",
  failed: "#ef4444",
  stopped: "#71717a",
};

interface TerminalTabsProps {
  onSpawnClick: () => void;
}

export function TerminalTabs({ onSpawnClick }: TerminalTabsProps) {
  const agents = Object.values(useAgentStore((s) => s.agents));
  const focusedAgentId = useAgentStore((s) => s.focusedAgentId);
  const setFocusedAgent = useAgentStore((s) => s.setFocusedAgent);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const removeTerminal = useTerminalStore((s) => s.removeTerminal);

  const handleClose = (e: React.MouseEvent, agent: AgentState) => {
    e.stopPropagation();
    removeTerminal(agent.id);
    removeAgent(agent.id);
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-bg-secondary px-1">
      {agents.map((agent) => {
        const isFocused = focusedAgentId === agent.id;
        const dotColor = STATUS_DOT_COLORS[agent.status] ?? "#71717a";
        const isActive =
          agent.status === "running" ||
          agent.status === "spawning" ||
          agent.status === "waiting_input";

        return (
          <button
            type="button"
            key={agent.id}
            onClick={() => setFocusedAgent(agent.id)}
            className={cn(
              "group flex h-7 max-w-[200px] items-center gap-1.5 rounded px-2 text-[11px] transition-colors",
              "hover:bg-white/5",
              isFocused ? "bg-white/10 text-text-primary" : "text-text-secondary",
            )}
          >
            {/* Status dot */}
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                isActive && "animate-status-pulse",
              )}
              style={{ background: dotColor }}
            />

            {/* CLI label + task */}
            <span className="truncate">
              <span className="font-medium">{CLI_SHORT_LABELS[agent.cliType]}</span>{" "}
              <span className="text-text-muted">
                {agent.taskDescription.length > 30
                  ? `${agent.taskDescription.slice(0, 30)}...`
                  : agent.taskDescription}
              </span>
            </span>

            {/* Close button */}
            <button
              type="button"
              onClick={(e) => handleClose(e, agent)}
              className={cn(
                "ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded",
                "opacity-0 transition-opacity group-hover:opacity-100",
                "hover:bg-white/10",
              )}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </button>
        );
      })}

      {/* New agent button */}
      <button
        type="button"
        onClick={onSpawnClick}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/5"
        title="Launch new agent"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
