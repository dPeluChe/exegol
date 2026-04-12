import { cn } from "@exegol/ui";
import { Bell, Coins, Cpu, GitBranch } from "lucide-react";
import { useProject, useTokenUsageSummary } from "../../hooks/use-trpc";
import { formatCost, formatTokens } from "../../lib/format";
import { useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";

export function StatusBar() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const { data: project } = useProject(activeProjectId);
  const { data: tokenSummary } = useTokenUsageSummary();
  const runningCount = useAgentStore(
    (s) =>
      Object.values(s.agents).filter((a) => a.status === "running" || a.status === "spawning")
        .length,
  );
  const attentionCount = useAgentStore((s) => s.getAttentionCount());

  const platform = window.api?.app?.getPlatform?.() ?? "unknown";

  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-bg-secondary px-3 text-[11px] text-text-muted">
      {/* Left: project + branch */}
      <div className="flex items-center gap-3">
        {project ? (
          <>
            <span className="text-text-secondary">{project.name}</span>
            <span className="flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {project.defaultBranch}
            </span>
          </>
        ) : (
          <span>No project</span>
        )}
      </div>

      {/* Center: running agents + attention */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <Cpu className="h-3 w-3" />
          <span>
            {runningCount} agent{runningCount !== 1 ? "s" : ""} running
          </span>
        </div>
        {attentionCount > 0 && (
          <div className={cn("flex items-center gap-1", attentionCount > 0 && "text-amber-400")}>
            <Bell className="h-3 w-3" />
            <span>
              {attentionCount} need{attentionCount !== 1 ? "" : "s"} attention
            </span>
          </div>
        )}
      </div>

      {/* Right: token usage + platform */}
      <div className="flex items-center gap-3">
        {tokenSummary && (
          <span className="flex items-center gap-1">
            <Coins className="h-3 w-3" />
            {formatTokens(tokenSummary.totalInputTokens + tokenSummary.totalOutputTokens)} tokens
            {" / "}
            {formatCost(tokenSummary.totalCostUsd)}
          </span>
        )}
        <span>{platform}</span>
      </div>
    </div>
  );
}
