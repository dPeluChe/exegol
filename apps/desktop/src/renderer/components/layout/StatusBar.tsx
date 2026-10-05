import type { PlanUsage, PlanWindow } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { Bell, GitBranch } from "lucide-react";
import { useMemo, useState } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { useEnabledProviders } from "../../hooks/use-providers";
import { useProject, useProjects } from "../../hooks/use-trpc";
import { sessionName } from "../../lib/agent-label";
import { isLongWait, longestWorking, turnTime } from "../../lib/busy-time";
import { trpcInvoke } from "../../lib/trpc-client";
import { type AgentState, isLiveAgent, useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { AgentIcon } from "../common/AgentIcon";
import { formatUptime, thresholdColor } from "../workspace/sections/resource-format";

const PLAN_POLL_MS = 60_000;
const CLOCK_MS = 30_000;

/** Time left until a window resets ("4h 12m"), or null when the source does not say */
const timeLeft = (resetsAt: number | null) =>
  resetsAt === null ? null : formatUptime(Math.max(0, (resetsAt - Date.now()) / 1000));

export function StatusBar() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const { data: project } = useProject(activeProjectId);
  const attentionCount = useAgentStore((s) => s.unreadAttentionCount);

  return (
    <div className="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-border bg-bg-secondary px-3 text-[11px] text-text-muted">
      <div className="flex min-w-0 items-center gap-3">
        {project ? (
          <>
            <span className="truncate text-text-secondary">{project.name}</span>
            <span className="flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {project.defaultBranch}
            </span>
          </>
        ) : (
          <span>No project</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <LiveAgentsByCli />
        {attentionCount > 0 && (
          <div className="flex items-center gap-1 text-amber-400">
            <Bell className="h-3 w-3" />
            <span>
              {attentionCount} need{attentionCount !== 1 ? "" : "s"} attention
            </span>
          </div>
        )}
      </div>

      <PlanUsageChips />
    </div>
  );
}

/** Live sessions per CLI: its icon, how many are open, how many are working and for how long;
 *  hovering lists them with their project and how long each has worked or waited */
function LiveAgentsByCli() {
  const [now, setNow] = useState(Date.now);
  useMountEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  });
  const agents = useAgentStore((s) => s.agents);
  const { data: projects = [] } = useProjects();
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const byCli = useMemo(() => {
    const groups = new Map<string, AgentState[]>();
    for (const a of Object.values(agents)) {
      if (!isLiveAgent(a)) continue;
      groups.set(a.cliType, [...(groups.get(a.cliType) ?? []), a]);
    }
    return [...groups].sort((x, y) => y[1].length - x[1].length);
  }, [agents]);

  if (byCli.length === 0) return <span>No agents running</span>;
  return (
    <div className="flex items-center gap-2.5">
      {byCli.map(([cliType, list]) => {
        const working = list.filter((a) => a.activityLevel === "busy").length;
        const longest = longestWorking(list, now);
        const longWait = list.some((a) => isLongWait(a, now));
        const title = list
          .map((a) => {
            const t = turnTime(a, now);
            const state = t ? `${t.state} ${formatUptime(t.seconds)}` : a.status;
            return `${sessionName(a)} · ${projectName.get(a.projectId) ?? "?"} · ${state}`;
          })
          .join("\n");
        return (
          <span key={cliType} className="flex items-center gap-1 tabular-nums" title={title}>
            <AgentIcon provider={cliType} size={12} />
            <span className={longWait ? "text-amber-400" : "text-text-secondary"}>
              {list.length}
            </span>
            {working > 0 && (
              <span className="text-success">
                · {working} working{longest !== null && ` ${formatUptime(longest)}`}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** Each CLI's plan windows as its own login reports them: 5h and weekly use, time to reset.
 *  Claude's needs Claude Code's login (keychain), so it is read only once the user asks */
function PlanUsageChips() {
  const providers = useEnabledProviders();
  const claudeOn = useAppStore((s) => s.claudePlanUsage);
  const hasClaude = providers.some((p) => p.id === "claude-code");
  const cliTypes = providers
    .map((p) => p.id)
    .filter((id) => id !== "shell" && (id !== "claude-code" || claudeOn));
  const { data: usage = [] } = useQuery({
    queryKey: ["planUsage", cliTypes],
    queryFn: () => trpcInvoke<PlanUsage[]>("doctor.planUsage", { cliTypes }),
    enabled: cliTypes.length > 0,
    refetchInterval: PLAN_POLL_MS,
    staleTime: PLAN_POLL_MS / 2,
  });
  const nameOf = (cliType: string) => providers.find((p) => p.id === cliType)?.name ?? cliType;

  return (
    <div className="flex items-center gap-3">
      {hasClaude && !claudeOn && (
        <button
          type="button"
          onClick={() => useAppStore.getState().setClaudePlanUsage(true)}
          className="flex items-center gap-1 hover:text-text-secondary"
          title="Show Claude's plan usage (5-hour and weekly windows, time to reset). Reads Claude Code's own login on this machine to ask Anthropic; it is never changed or sent anywhere else"
        >
          <AgentIcon provider="claude-code" size={12} />
          Show plan usage
        </button>
      )}
      {usage.map((u) => (
        <span
          key={u.cliType}
          className={cn("flex items-center gap-1.5", u.stale && "opacity-60")}
          title={planTitle(nameOf(u.cliType), u)}
        >
          <AgentIcon provider={u.cliType} size={12} />
          <WindowChip label="5h" window={u.session} withReset />
          <WindowChip label="wk" window={u.weekly} />
        </span>
      ))}
    </div>
  );
}

function WindowChip({
  label,
  window: w,
  withReset = false,
}: {
  label: string;
  window: PlanWindow | null;
  withReset?: boolean;
}) {
  if (!w) return null;
  const until = withReset ? timeLeft(w.resetsAt) : null;
  return (
    <span className="tabular-nums">
      {label} <span className={thresholdColor(w.usedPercent)}>{Math.round(w.usedPercent)}%</span>
      {until && <span> · {until}</span>}
    </span>
  );
}

function planTitle(name: string, u: PlanUsage): string {
  const line = (label: string, w: PlanWindow | null) => {
    if (!w) return null;
    const at = w.resetsAt ? new Date(w.resetsAt).toLocaleString() : "unknown";
    return `${label}: ${Math.round(w.usedPercent)}% used, resets ${at} (in ${timeLeft(w.resetsAt)})`;
  };
  const read = `As of ${new Date(u.fetchedAt).toLocaleTimeString()}${u.stale ? " (last good reading)" : ""}`;
  return [name, line("5-hour window", u.session), line("Weekly", u.weekly), read]
    .filter(Boolean)
    .join("\n");
}
