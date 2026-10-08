import type { PlanUsage, PlanWindow, TokenUsageSummary } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownCircle,
  Bell,
  Cpu,
  Download,
  GitBranch,
  GitPullRequest,
  Loader2,
  MemoryStick,
  Settings2,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useCliUpdates } from "../../hooks/use-cli-updates";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { useNow } from "../../hooks/use-now";
import { useEnabledProviders } from "../../hooks/use-providers";
import { useProject, useSettings, useSystemMetrics } from "../../hooks/use-trpc";
import { useWidgetDefaults } from "../../hooks/use-trpc-dictation";
import { useUpdateStatus } from "../../hooks/use-update-status";
import { ACCESS_MODES } from "../../lib/access-modes";
import { sessionName } from "../../lib/agent-label";
import { formatCost, formatTokens } from "../../lib/format";
import { IS_MAC } from "../../lib/keymap";
import { ramText, resourcesTooltip } from "../../lib/resources-widget";
import { useSessionRecovery } from "../../lib/session-recovery";
import {
  type PlacedWidget,
  resolveWidgetLayout,
  type StatusBarWidgetId,
  WIDGET_SLOTS,
  type WidgetSlot,
  widgetMode,
  widgetsIn,
} from "../../lib/status-bar-widgets";
import { trpcInvoke } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { selectActivePaneId, useWorkspaceStore } from "../../stores/workspace";
import { AgentIcon } from "../common/AgentIcon";
import type { GitState } from "../workspace/SmartGitAction";
import { formatUptime, thresholdColor } from "../workspace/sections/resource-format";
import { AgentsWidget } from "./StatusBarAgents";
import { DictationWidget } from "./StatusBarDictation";
import { McpWidget } from "./StatusBarMcp";

const PLAN_POLL_MS = 60_000;

/** Time left until a window resets ("4h 12m"), or null when the source does not say */
const timeLeft = (resetsAt: number | null) =>
  resetsAt === null ? null : formatUptime(Math.max(0, (resetsAt - Date.now()) / 1000));

const WIDGETS: Record<StatusBarWidgetId, () => ReactNode> = {
  project: ProjectWidget,
  branch: BranchWidget,
  agents: AgentsWidget,
  "plan-usage": PlanUsageChips,
  tokens: TokensWidget,
  resources: ResourcesWidget,
  "cli-updates": CliUpdatesWidget,
  clock: ClockWidget,
  attention: AttentionWidget,
  "focused-agent": FocusedAgentWidget,
  "git-state": GitStateWidget,
  reconnect: ReconnectWidget,
  "app-update": AppUpdateWidget,
  mcp: McpWidget,
  dictation: DictationWidget,
};

/** Left shrinks first (its names truncate); center and right keep their content's width */
const SLOT_CLASS: Record<WidgetSlot, string> = {
  left: "min-w-0 flex-1 justify-start overflow-hidden",
  center: "shrink-0 justify-center",
  right: "flex-1 justify-end",
};

export function useWidgetLayout(): PlacedWidget[] {
  const { data: settings } = useSettings();
  const { dictation } = useWidgetDefaults();
  return useMemo(
    () => resolveWidgetLayout(settings?.statusBarWidgets, { dictation }),
    [settings?.statusBarWidgets, dictation],
  );
}

/** One title bar zone. The bar is a drag region: each widget is no-drag so its clicks and
 *  tooltips work, the zone's empty space still drags the window */
export function HeaderWidgets({
  layout,
  slot,
  className,
}: {
  layout: PlacedWidget[];
  slot: WidgetSlot;
  className?: string;
}) {
  const ids = widgetsIn(layout, "header", slot);
  if (ids.length === 0) return null;
  return (
    <div className={cn("flex items-center gap-3 text-[11px] text-text-muted", className)}>
      {ids.map((id) => {
        const Widget = WIDGETS[id];
        return (
          <div key={id} className="titlebar-no-drag flex min-w-0 items-center empty:hidden">
            <Widget />
          </div>
        );
      })}
    </div>
  );
}

/** The footer zones picked in Settings > Bars, in their slot and order */
export function StatusBar() {
  const layout = useWidgetLayout();

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-bg-secondary pl-3 pr-1 text-[11px] text-text-muted">
      {WIDGET_SLOTS.map((slot) => (
        <div key={slot} className={cn("flex items-center gap-3", SLOT_CLASS[slot])}>
          {widgetsIn(layout, "footer", slot).map((id) => {
            const Widget = WIDGETS[id];
            return <Widget key={id} />;
          })}
        </div>
      ))}
      <button
        type="button"
        onClick={() => window.api.settings.open("statusbar")}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-white/10 hover:text-text-primary"
        title="Choose what the status bar and the title bar show"
      >
        <Settings2 className="h-3 w-3" />
      </button>
    </div>
  );
}

/** The agent in the focused pane of the active project, if any */
function useFocusedAgentId(): string | undefined {
  const projectId = useAppStore((s) => s.activeProjectId);
  return useWorkspaceStore((s) => {
    const paneId = selectActivePaneId(s);
    return projectId && paneId ? s.projectWorkspaces[projectId]?.panes[paneId]?.agentId : undefined;
  });
}

function ProjectWidget() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const { data: project } = useProject(activeProjectId);
  if (!project) return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        className="h-2 w-2 shrink-0 rounded-full bg-text-muted"
        style={project.color ? { backgroundColor: project.color } : undefined}
      />
      <span className="truncate text-text-secondary">{project.name}</span>
    </span>
  );
}

/** The focused session's worktree branch, else the repo's current one (GitPane's query key, so
 *  no polling of its own) */
function BranchWidget() {
  const projectId = useAppStore((s) => s.activeProjectId);
  const { data: project } = useProject(projectId);
  const agentId = useFocusedAgentId();
  const agentBranch = useAgentStore((s) => (agentId ? s.agents[agentId]?.branchName : null));
  const { data: repoBranch } = useQuery({
    queryKey: ["git", "branch", projectId],
    queryFn: () => trpcInvoke<string>("diff.branch", { projectId }),
    enabled: !!projectId && !agentBranch,
    staleTime: 30_000,
  });
  const branch = agentBranch ?? repoBranch ?? project?.defaultBranch;
  if (!projectId || !branch) return null;
  return (
    <span
      className="flex min-w-0 items-center gap-1"
      title={agentBranch ? "The focused session's worktree branch" : "The project's current branch"}
    >
      <GitBranch className="h-3 w-3 shrink-0" />
      <span className="truncate">{branch}</span>
    </span>
  );
}

function FocusedAgentWidget() {
  const agentId = useFocusedAgentId();
  const agent = useAgentStore((s) => (agentId ? s.agents[agentId] : undefined));
  if (!agent || agent.cliType === "shell") return null;
  const mode =
    agent.accessMode && agent.accessMode !== "write"
      ? ACCESS_MODES.find((m) => m.mode === agent.accessMode)
      : undefined;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <AgentIcon provider={agent.cliType} size={12} />
      <span className="truncate text-text-secondary">{sessionName(agent)}</span>
      {agent.model && <span className="truncate">{agent.model}</span>}
      {mode && (
        <span className="shrink-0 rounded bg-white/5 px-1" title={mode.hint}>
          {mode.label}
        </span>
      )}
      {agent.yolo && (
        <span className="shrink-0 rounded bg-error/15 px-1 text-error" title="Skips permissions">
          YOLO
        </span>
      )}
      {agent.branchName && (
        <span className="shrink-0 rounded bg-white/5 px-1" title={agent.branchName}>
          worktree
        </span>
      )}
    </span>
  );
}

/** SmartGitAction's query (same key): read when shown, refreshed by the Git pane, no polling.
 *  The path is the one the Git pane opens for this agent (agents.getWorktreePath) */
function GitStateWidget() {
  const projectId = useAppStore((s) => s.activeProjectId);
  const agentId = useFocusedAgentId();
  const hasWorktree = useAgentStore((s) => !!(agentId && s.agents[agentId]?.branchName));
  const { data: worktreePath, isFetched } = useQuery({
    queryKey: ["agents", "worktreePath", agentId],
    queryFn: () => trpcInvoke<string | null>("agents.getWorktreePath", { agentId }),
    enabled: hasWorktree,
    staleTime: 60_000,
  });
  const path = (hasWorktree && worktreePath) || undefined;
  const { data: state } = useQuery({
    queryKey: ["git", "state", path || projectId],
    queryFn: () => trpcInvoke<GitState>("diff.gitState", { projectId, pathOverride: path }),
    enabled: !!projectId && (!hasWorktree || isFetched),
    staleTime: 60_000,
  });
  if (!state) return null;
  const dirty = state.dirtyStaged + state.dirtyUnstaged;
  const pr = state.pr.state !== "none" ? state.pr.state : null;
  if (dirty === 0 && state.ahead === 0 && state.behind === 0 && !pr) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5 tabular-nums" title="Git state">
      {dirty > 0 && <span className="text-amber-400">{dirty} changed</span>}
      {state.ahead > 0 && <span>↑{state.ahead}</span>}
      {state.behind > 0 && <span>↓{state.behind}</span>}
      {pr && (
        <span className="flex items-center gap-0.5">
          <GitPullRequest className="h-3 w-3" />
          {pr}
        </span>
      )}
    </span>
  );
}

function AttentionWidget() {
  const count = useAgentStore((s) => s.unreadAttentionCount);
  if (count === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 text-amber-400" title="Unread alerts">
      <Bell className="h-3 w-3" />
      {count}
    </span>
  );
}

function ReconnectWidget() {
  const recovery = useSessionRecovery();
  if (!recovery || recovery.done) return null;
  const left = recovery.planned
    ? recovery.planned.length - recovery.ready.length - recovery.crashed.length
    : null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Loader2 className="h-3 w-3 animate-spin" />
      {left === null
        ? "Reconnecting sessions..."
        : `Reconnecting ${left} session${left === 1 ? "" : "s"}...`}
    </span>
  );
}

/** What the title bar's update button shows */
function AppUpdateWidget() {
  const update = useUpdateStatus();
  if (update.status === "ready") {
    return (
      <span className="flex shrink-0 items-center gap-1 text-success">
        <ArrowDownCircle className="h-3 w-3" />
        Exegol {update.info.version} ready
      </span>
    );
  }
  if (update.status !== "available" && update.status !== "downloading") return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Loader2 className="h-3 w-3 animate-spin" />
      Downloading Exegol {update.info.version}
    </span>
  );
}

function TokensWidget() {
  const { data } = useQuery({
    queryKey: ["tokenUsage", "today"],
    queryFn: () => {
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const since = Math.floor(midnight.getTime() / 1000);
      return trpcInvoke<TokenUsageSummary>("tokenUsage.summary", { since });
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  if (!data) return null;
  return (
    <span
      className="shrink-0 tabular-nums"
      title="Tokens and estimated cost since midnight, all projects"
    >
      {formatTokens(data.totalInputTokens + data.totalOutputTokens)} tok ·{" "}
      {formatCost(data.totalCostUsd)}
    </span>
  );
}

/** Push first, the query until the first push lands */
function ResourcesWidget() {
  const [pushed, setPushed] = useState<SystemMetricsEvent | null>(null);
  useMountEffect(() => window.api.onMetrics(setPushed));
  const { data: queried } = useSystemMetrics();
  const { data: settings } = useSettings();
  const metrics = pushed ?? queried;
  if (!metrics) return null;
  const mode = widgetMode(resolveWidgetLayout(settings?.statusBarWidgets), "resources");
  return (
    <span
      className="flex shrink-0 items-center gap-1 tabular-nums"
      title={resourcesTooltip(metrics, IS_MAC)}
    >
      <Cpu className="h-3 w-3" />
      CPU
      <span className={thresholdColor(metrics.cpu.usage)}>{Math.round(metrics.cpu.usage)}%</span>
      <span>·</span>
      <MemoryStick className="h-3 w-3" />
      RAM
      <span className={thresholdColor(metrics.memory.usagePercent)}>
        {ramText(metrics.memory, mode)}
      </span>
    </span>
  );
}

function CliUpdatesWidget() {
  const updates = useCliUpdates();
  const pending = [...updates.values()].filter((u) => u.updateAvailable);
  if (pending.length === 0) return null;
  return (
    <span
      className="flex shrink-0 items-center gap-1 text-accent"
      title={pending.map((u) => `${u.cliType}: ${u.installed} to ${u.latest}`).join("\n")}
    >
      <Download className="h-3 w-3" />
      {pending.length} CLI update{pending.length === 1 ? "" : "s"}
    </span>
  );
}

function ClockWidget() {
  const now = useNow();
  return (
    <span className="shrink-0 tabular-nums">
      {new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
    </span>
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
  if (usage.length === 0 && !(hasClaude && !claudeOn)) return null;

  return (
    <div className="flex shrink-0 items-center gap-3">
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
