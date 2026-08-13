import { type Agent, LIVE_STATUSES } from "@exegol/shared";
import { cn, ScrollArea } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  Cpu,
  Eye,
  Map as MapIcon,
  Send,
  Square,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { submitToAgent } from "../../../lib/agent-input";
import { trpcInvoke } from "../../../lib/trpc-client";
import { type AgentState, useAgentStore } from "../../../stores/agents";
import { useAppStore } from "../../../stores/app";
import {
  collectPaneIds,
  selectPanes,
  selectTabs,
  useWorkspaceStore,
} from "../../../stores/workspace";
import { AgentIcon } from "../../common/AgentIcon";
import { FilterChip } from "../../common/FilterChip";
import { SessionAlias } from "../../common/SessionAlias";
import { TerminalInstance } from "../../terminal/TerminalInstance";

const STATUS_CONFIG: Record<
  string,
  { icon: typeof Cpu; color: string; bg: string; label: string }
> = {
  running: {
    icon: Cpu,
    color: "text-green-400",
    bg: "border-green-500/30 bg-green-500/5",
    label: "Running",
  },
  spawning: {
    icon: Clock,
    color: "text-blue-400",
    bg: "border-blue-400/30 bg-blue-400/5",
    label: "Starting",
  },
  waiting_input: {
    icon: AlertTriangle,
    color: "text-amber-400",
    bg: "border-amber-500/30 bg-amber-500/5",
    label: "Waiting",
  },
  completed: {
    icon: CheckCircle,
    color: "text-text-muted",
    bg: "border-border",
    label: "Completed",
  },
  failed: {
    icon: XCircle,
    color: "text-red-400",
    bg: "border-red-500/30 bg-red-500/5",
    label: "Failed",
  },
  crashed: {
    icon: AlertCircle,
    color: "text-red-500",
    bg: "border-red-500/30 bg-red-500/5",
    label: "Crashed",
  },
  stopped: { icon: Square, color: "text-text-muted", bg: "border-border", label: "Stopped" },
};

const DEFAULT_STATUS = {
  icon: Cpu,
  color: "text-text-muted",
  bg: "border-border",
  label: "Unknown",
};

const SPINNER_SETS = [
  ["⣾", "⣷", "⣯", "⣟", "⡿", "⢿", "⣻", "⣽"],
  ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"],
  ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "█", "▉", "▊", "▋", "▌", "▍", "▎"],
  ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
  ["♡", "♥", "♡", "♡"],
  ["✦", "✧", "✦", "⊹", "✧", "⊹"],
  ["░", "▒", "▓", "█", "▓", "▒", "░"],
];

function getSpinnerSet(id: string): string[] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return SPINNER_SETS[Math.abs(hash) % SPINNER_SETS.length] ?? ["⠋", "⠙", "⠹", "⠸"];
}

function Spinner({ agentId }: { agentId: string }) {
  const frames = useMemo(() => getSpinnerSet(agentId), [agentId]);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.length), 100);
    return () => clearInterval(id);
  }, [frames.length]);
  return (
    <span className="inline-block w-4 text-center font-mono text-accent">{frames[frame]}</span>
  );
}

function elapsedStr(startedAt: number): string {
  const s = Math.floor(Date.now() / 1000 - startedAt);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** Leaf timer: only this span re-renders as time passes, not the whole grid. */
function Elapsed({ startedAt }: { startedAt: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="flex items-center gap-0.5">
      <Clock className="h-2.5 w-2.5" />
      {elapsedStr(startedAt)}
    </span>
  );
}

// ─── Data ───────────────────────────────────────────────────────────────

/** agents.listActive row (db/queries/agents.ts#listActiveAgents). */
type ActiveAgent = Agent & { projectName: string; groupColor: string | null };

interface ProjectInfo {
  id: string;
  name: string;
}

interface ProjectMeta {
  name: string;
  color: string | null;
}

type GroupBy = "state" | "project";

const isWorking = (a: AgentState) => a.status === "running" || a.status === "spawning";

// ─── Component ──────────────────────────────────────────────────────────

export function AgentDashboard() {
  const storeAgents = useAgentStore((s) => s.agents);
  const attentionItems = useAgentStore((s) => s.attentionItems);
  const [groupBy, setGroupBy] = useState<GroupBy>("state");

  // DB truth for the whole fleet — hydrated INTO the store so every consumer
  // (attention, badges) sees cross-project agents, not just this dashboard.
  const { data: activeRows } = useQuery({
    queryKey: ["agents", "listActive"],
    queryFn: () => trpcInvoke<ActiveAgent[]>("agents.listActive"),
    refetchInterval: 60_000,
  });
  useEffect(() => {
    if (activeRows?.length) useAgentStore.getState().syncFromDb("__fleet__", activeRows);
  }, [activeRows]);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => trpcInvoke<ProjectInfo[]>("projects.list"),
    staleTime: 30_000,
  });

  // Project name/color per projectId — listActive rows carry it; projects.list
  // fills in for Recent agents whose project has no live rows.
  const projectMeta = useMemo(() => {
    const m = new Map<string, ProjectMeta>();
    for (const p of projects ?? []) m.set(p.id, { name: p.name, color: null });
    for (const r of activeRows ?? []) {
      m.set(r.projectId, { name: r.projectName, color: r.groupColor });
    }
    return m;
  }, [projects, activeRows]);

  const { groups, total, runningCount, unreadCount } = useMemo(() => {
    const all = Object.values(storeAgents).sort((a, b) => {
      const aActive = LIVE_STATUSES.has(a.status) ? 0 : 1;
      const bActive = LIVE_STATUSES.has(b.status) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return (b.startedAt ?? 0) - (a.startedAt ?? 0);
    });
    const unread = (id: string) => {
      const item = attentionItems[id];
      return !!item && !item.read;
    };

    let running = 0;
    let unreadTotal = 0;
    const buckets: Record<string, AgentState[]> = { needs: [], working: [], idle: [], recent: [] };
    const byProject = new Map<string, AgentState[]>();

    for (const a of all) {
      if (a.status === "running") running++;
      const isUnread = unread(a.id);
      if (isUnread) unreadTotal++;
      if (groupBy === "state") {
        const key = isUnread
          ? "needs"
          : isWorking(a)
            ? "working"
            : LIVE_STATUSES.has(a.status)
              ? "idle"
              : "recent";
        buckets[key]?.push(a);
      } else {
        const list = byProject.get(a.projectId) ?? [];
        list.push(a);
        byProject.set(a.projectId, list);
      }
    }

    const result: Array<{
      key: string;
      title: string;
      color: string | null;
      agents: AgentState[];
      unread: Set<string>;
    }> = [];
    const unreadSet = new Set(all.filter((a) => unread(a.id)).map((a) => a.id));
    if (groupBy === "state") {
      const titles: Record<string, string> = {
        needs: "Needs attention",
        working: "Working",
        idle: "Idle — at prompt",
        recent: "Recent",
      };
      for (const key of ["needs", "working", "idle", "recent"]) {
        const agents = buckets[key] ?? [];
        if (agents.length) {
          result.push({ key, title: titles[key] ?? key, color: null, agents, unread: unreadSet });
        }
      }
    } else {
      for (const [projectId, agents] of byProject) {
        const meta = projectMeta.get(projectId);
        result.push({
          key: projectId,
          title: meta?.name ?? projectId.slice(0, 12),
          color: meta?.color ?? null,
          agents,
          unread: unreadSet,
        });
      }
    }
    return { groups: result, total: all.length, runningCount: running, unreadCount: unreadTotal };
  }, [storeAgents, attentionItems, groupBy, projectMeta]);

  const navigateToAgent = useCallback((agent: AgentState) => {
    const app = useAppStore.getState();
    const store = useAgentStore.getState();
    store.markAttentionRead(agent.id);

    const focusPane = () => {
      const ws = useWorkspaceStore.getState();
      const tabs = selectTabs(ws);
      const panes = selectPanes(ws);
      for (const tab of tabs) {
        for (const paneId of collectPaneIds(tab.layout)) {
          const pane = panes[paneId];
          if (pane?.type === "terminal" && pane.agentId === agent.id) {
            ws.setActiveTab(tab.id);
            ws.setFocusedPane(paneId);
            store.setFocusedAgent(agent.id);
            // Switch workspace back to Agents tab
            window.dispatchEvent(
              new CustomEvent("exegol:switch-section", { detail: { section: "agents" } }),
            );
            return;
          }
        }
      }
    };

    if (app.activeProjectId !== agent.projectId) {
      app.setActiveProject(agent.projectId);
      requestAnimationFrame(focusPane);
    } else {
      focusPane();
      window.dispatchEvent(
        new CustomEvent("exegol:switch-section", { detail: { section: "agents" } }),
      );
    }
  }, []);

  if (total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg-primary p-8">
        <Cpu className="h-10 w-10 text-text-muted/30" />
        <div className="text-center">
          <p className="text-sm font-medium text-text-primary">No agents yet</p>
          <p className="mt-1 text-xs text-text-muted">
            Spawn an agent from the launcher to see it here
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4">
        {/* Summary bar + group toggle */}
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5" />
            <span className="font-medium text-text-primary">{total}</span> agents
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            {runningCount} running
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            {unreadCount} need attention
          </span>
          <div className="ml-auto flex items-center gap-1">
            <FilterChip active={groupBy === "state"} onClick={() => setGroupBy("state")}>
              By state
            </FilterChip>
            <FilterChip active={groupBy === "project"} onClick={() => setGroupBy("project")}>
              By project
            </FilterChip>
          </div>
        </div>

        {groups.map((group) => (
          <div key={group.key}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              <span
                className={cn("h-1.5 w-1.5 rounded-full", !group.color && "bg-accent")}
                style={group.color ? { backgroundColor: group.color } : undefined}
              />
              {group.title}
              <span className="font-normal">({group.agents.length})</span>
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  projectMeta={groupBy === "state" ? projectMeta.get(agent.projectId) : undefined}
                  hasUnread={group.unread.has(agent.id)}
                  onClick={() => navigateToAgent(agent)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function AgentCard({
  agent,
  projectMeta,
  hasUnread,
  onClick,
}: {
  agent: AgentState;
  /** Set only in by-state grouping — shows which project the card belongs to. */
  projectMeta?: ProjectMeta;
  hasUnread: boolean;
  onClick: () => void;
}) {
  const config = STATUS_CONFIG[agent.status] ?? DEFAULT_STATUS;
  const StatusIcon = config.icon;
  const canPeek = LIVE_STATUSES.has(agent.status);
  const [peekOpen, setPeekOpen] = useState(false);

  return (
    // biome-ignore lint/a11y/useSemanticElements: nested interactive children (peek button/input) prevent <button>
    <div
      className={cn(
        "group flex flex-col rounded-xl border p-3 transition-all",
        config.bg,
        "cursor-pointer hover:shadow-lg hover:shadow-black/10",
      )}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !peekOpen) onClick();
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start gap-3">
        {/* Left: icon + spinner */}
        <div className="flex flex-col items-center gap-1.5 pt-0.5">
          <AgentIcon provider={agent.cliType} size={28} />
          {!hasUnread && isWorking(agent) && <Spinner agentId={agent.id} />}
        </div>

        {/* Center: info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <SessionAlias agent={agent} />
            {agent.alias && (
              <span className="shrink-0 text-[10px] text-text-muted">{agent.cliType}</span>
            )}
            <span className={cn("flex items-center gap-1 text-[10px]", config.color)}>
              <StatusIcon className="h-3 w-3" />
              {hasUnread ? "Needs input" : config.label}
            </span>
            {projectMeta && (
              <span
                className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] text-text-muted"
                title={projectMeta.name}
              >
                <span
                  className={cn("h-1.5 w-1.5 rounded-full", !projectMeta.color && "bg-accent")}
                  style={projectMeta.color ? { backgroundColor: projectMeta.color } : undefined}
                />
                <span className="max-w-[90px] truncate">{projectMeta.name}</span>
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-text-muted">{agent.taskDescription}</p>
          {agent.currentStep && (
            <p className="mt-0.5 truncate text-[10px] text-text-muted/70 italic">
              {agent.currentStep}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
            {agent.startedAt && <Elapsed startedAt={agent.startedAt} />}
            {(agent.tokenUsage.input > 0 || agent.tokenUsage.output > 0) && (
              <span className="flex items-center gap-0.5">
                <Coins className="h-2.5 w-2.5" />
                {((agent.tokenUsage.input + agent.tokenUsage.output) / 1000).toFixed(1)}k
                {agent.tokenUsage.cost > 0 && (
                  <span className="ml-0.5 text-text-muted/60">
                    ${agent.tokenUsage.cost.toFixed(3)}
                  </span>
                )}
              </span>
            )}
            {agent.accessMode === "read" && (
              <span className="flex items-center gap-0.5 text-sky-400/80">
                <Eye className="h-2.5 w-2.5" />
                read-only
              </span>
            )}
            {agent.accessMode === "plan" && (
              <span className="flex items-center gap-0.5 text-amber-400/80">
                <MapIcon className="h-2.5 w-2.5" />
                plan
              </span>
            )}
            {agent.branchName && (
              <span className="truncate rounded bg-white/5 px-1 py-0.5 font-mono text-[9px]">
                {agent.branchName}
              </span>
            )}
            {canPeek && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPeekOpen((v) => !v);
                }}
                className="ml-auto flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-text-muted hover:bg-white/10 hover:text-text-primary"
                title="Peek at the terminal and reply inline"
              >
                {peekOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Peek
              </button>
            )}
          </div>
        </div>
      </div>

      {peekOpen && <PeekPanel agent={agent} />}
    </div>
  );
}

/** T156 peek-and-reply: live read-only terminal + one-line reply to the PTY.
 *  liveFeed streams real output (colors, TUIs) without stdin or PTY resize —
 *  the pane in the Agents tab keeps sole ownership of the terminal size. */
function PeekPanel({ agent }: { agent: AgentState }) {
  const [reply, setReply] = useState("");

  const send = () => {
    const text = reply.trim();
    if (!text) return;
    submitToAgent(agent.id, text);
    setReply("");
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: click shield so the card doesn't navigate
    // biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation-only handler, not an action
    <div className="mt-2 border-t border-border pt-2" onClick={(e) => e.stopPropagation()}>
      <div className="h-52 overflow-hidden rounded-md border border-border bg-black/40 p-1">
        <TerminalInstance
          key={`peek-${agent.id}`}
          agentId={agent.id}
          cliType={agent.cliType}
          readOnly
          liveFeed
        />
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Reply without leaving the dashboard…"
          className="h-7 flex-1 rounded-md border border-border bg-bg-primary px-2 text-[11px] text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={!reply.trim()}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-white/5 hover:text-text-primary disabled:opacity-40"
        >
          <Send className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
