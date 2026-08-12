import { cn, ScrollArea } from "@exegol/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  const frames = getSpinnerSet(agentId);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.length), 100);
    return () => clearInterval(id);
  }, [frames.length]);
  return (
    <span className="inline-block w-4 text-center font-mono text-accent">{frames[frame]}</span>
  );
}

function elapsedStr(startedAt: number | null): string {
  if (!startedAt) return "";
  const s = Math.floor(Date.now() / 1000 - startedAt);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// ─── Data ───────────────────────────────────────────────────────────────

/** agents.listActive row — DB truth across ALL projects (T156). */
interface ActiveRow {
  id: string;
  projectId: string;
  cliType: string;
  status: string;
  currentStep: string | null;
  taskDescription: string;
  branchName: string | null;
  accessMode: string | null;
  startedAt: number | null;
  projectName: string;
  groupColor: string | null;
}

interface ProjectInfo {
  id: string;
  name: string;
}

/** Store agent enriched with project metadata (DB rows fill store gaps). */
type SessionAgent = AgentState & { projectName: string; groupColor: string | null };

type GroupBy = "state" | "project";

const LIVE = ["running", "spawning", "waiting_input", "paused"];

// ─── Component ──────────────────────────────────────────────────────────

export function AgentDashboard() {
  const storeAgents = useAgentStore((s) => s.agents);
  const attentionItems = useAgentStore((s) => s.attentionItems);
  const [groupBy, setGroupBy] = useState<GroupBy>("state");

  const { data: activeRows } = useQuery({
    queryKey: ["agents", "listActive"],
    queryFn: () => trpcInvoke<ActiveRow[]>("agents.listActive"),
    refetchInterval: 15_000,
  });

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => trpcInvoke<ProjectInfo[]>("projects.list"),
    staleTime: 30_000,
  });

  // Tick for elapsed time
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  const projectMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects ?? []) m.set(p.id, p.name);
    return m;
  }, [projects]);

  // Merge: store rows are freshest (push events); DB rows add agents from
  // projects never opened this session + project name/group color.
  const allAgents = useMemo((): SessionAgent[] => {
    const dbById = new Map((activeRows ?? []).map((r) => [r.id, r]));
    const merged: SessionAgent[] = Object.values(storeAgents).map((a) => {
      const db = dbById.get(a.id);
      return {
        ...a,
        projectName: db?.projectName ?? projectMap.get(a.projectId) ?? a.projectId.slice(0, 12),
        groupColor: db?.groupColor ?? null,
      };
    });
    const inStore = new Set(Object.keys(storeAgents));
    for (const r of activeRows ?? []) {
      if (inStore.has(r.id)) continue;
      merged.push({
        id: r.id,
        projectId: r.projectId,
        cliType: r.cliType as AgentState["cliType"],
        status: r.status as AgentState["status"],
        currentStep: r.currentStep,
        taskDescription: r.taskDescription,
        branchName: r.branchName,
        tokenUsage: { input: 0, output: 0, cost: 0 },
        startedAt: r.startedAt ?? undefined,
        accessMode: (r.accessMode as AgentState["accessMode"]) ?? null,
        claudeSessionId: null,
        activityLevel: "neutral",
        projectName: r.projectName,
        groupColor: r.groupColor,
      } as SessionAgent);
    }
    return merged.sort((a, b) => {
      const aActive = LIVE.includes(a.status) ? 0 : 1;
      const bActive = LIVE.includes(b.status) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return (b.startedAt ?? 0) - (a.startedAt ?? 0);
    });
  }, [storeAgents, activeRows, projectMap]);

  const navigateToAgent = useCallback((agent: SessionAgent) => {
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

  if (allAgents.length === 0) {
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

  // ── Grouping ──────────────────────────────────────────────────────────
  const isUnread = (id: string) => {
    const item = attentionItems[id];
    return !!item && !item.read;
  };

  const groups: Array<{
    key: string;
    title: string;
    dotColor?: string | null;
    agents: SessionAgent[];
  }> = [];
  if (groupBy === "state") {
    const needs = allAgents.filter((a) => isUnread(a.id));
    const working = allAgents.filter(
      (a) => !isUnread(a.id) && (a.status === "running" || a.status === "spawning"),
    );
    const idle = allAgents.filter(
      (a) => !isUnread(a.id) && ["waiting_input", "paused", "idle"].includes(a.status),
    );
    const recent = allAgents.filter((a) => !LIVE.includes(a.status) && !isUnread(a.id));
    if (needs.length) groups.push({ key: "needs", title: "Needs attention", agents: needs });
    if (working.length) groups.push({ key: "working", title: "Working", agents: working });
    if (idle.length) groups.push({ key: "idle", title: "Idle — at prompt", agents: idle });
    if (recent.length) groups.push({ key: "recent", title: "Recent", agents: recent });
  } else {
    const byProject = new Map<string, SessionAgent[]>();
    for (const agent of allAgents) {
      const list = byProject.get(agent.projectId) ?? [];
      list.push(agent);
      byProject.set(agent.projectId, list);
    }
    for (const [projectId, agents] of byProject) {
      groups.push({
        key: projectId,
        title: agents[0]?.projectName ?? projectId.slice(0, 12),
        dotColor: agents[0]?.groupColor,
        agents,
      });
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4">
        {/* Summary bar + group toggle */}
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5" />
            <span className="font-medium text-text-primary">{allAgents.length}</span> agents
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            {allAgents.filter((a) => a.status === "running").length} running
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            {allAgents.filter((a) => isUnread(a.id)).length} need attention
          </span>
          <div className="ml-auto flex items-center gap-1">
            <ToggleChip active={groupBy === "state"} onClick={() => setGroupBy("state")}>
              By state
            </ToggleChip>
            <ToggleChip active={groupBy === "project"} onClick={() => setGroupBy("project")}>
              By project
            </ToggleChip>
          </div>
        </div>

        {groups.map((group) => (
          <div key={group.key}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: group.dotColor ?? "var(--accent, #8b5cf6)" }}
              />
              {group.title}
              <span className="font-normal">({group.agents.length})</span>
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  showProject={groupBy === "state"}
                  hasUnread={isUnread(agent.id)}
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

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] transition-colors",
        active
          ? "bg-white/10 text-text-primary"
          : "text-text-muted hover:bg-white/5 hover:text-text-secondary",
      )}
    >
      {children}
    </button>
  );
}

function AgentCard({
  agent,
  showProject,
  hasUnread,
  onClick,
}: {
  agent: SessionAgent;
  showProject: boolean;
  hasUnread: boolean;
  onClick: () => void;
}) {
  const config = STATUS_CONFIG[agent.status] ?? DEFAULT_STATUS;
  const StatusIcon = config.icon;
  const isActive = ["running", "spawning", "waiting_input"].includes(agent.status);
  const canPeek = LIVE.includes(agent.status);
  const [peekOpen, setPeekOpen] = useState(false);

  return (
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
          {isActive && !hasUnread && agent.status !== "waiting_input" && (
            <Spinner agentId={agent.id} />
          )}
        </div>

        {/* Center: info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{agent.cliType}</span>
            <span className={cn("flex items-center gap-1 text-[10px]", config.color)}>
              <StatusIcon className="h-3 w-3" />
              {hasUnread ? "Needs input" : config.label}
            </span>
            {showProject && (
              <span
                className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] text-text-muted"
                title={agent.projectName}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: agent.groupColor ?? "var(--accent, #8b5cf6)" }}
                />
                <span className="max-w-[90px] truncate">{agent.projectName}</span>
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
            {agent.startedAt && (
              <span className="flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" />
                {elapsedStr(agent.startedAt)}
              </span>
            )}
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

      {peekOpen && canPeek && <PeekPanel agent={agent} />}
    </div>
  );
}

/** T156 peek-and-reply: stripped ring tail + one-line reply straight to the PTY. */
function PeekPanel({ agent }: { agent: SessionAgent }) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["agents", "peekTail", agent.id],
    queryFn: () =>
      trpcInvoke<{ tail: string | null }>("agents.peekTail", { agentId: agent.id, chars: 1500 }),
    refetchInterval: 5_000,
  });

  const send = () => {
    const text = reply.trim();
    if (!text) return;
    window.api.terminal.write(agent.id, `${text}\r`);
    useAgentStore.getState().markAttentionRead(agent.id);
    setReply("");
    setTimeout(
      () => queryClient.invalidateQueries({ queryKey: ["agents", "peekTail", agent.id] }),
      1_200,
    );
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: click shield so the card doesn't navigate
    <div className="mt-2 border-t border-border pt-2" onClick={(e) => e.stopPropagation()}>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-text-secondary">
        {isLoading ? "Loading…" : (data?.tail?.split("\n").slice(-18).join("\n") ?? "No output")}
      </pre>
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
