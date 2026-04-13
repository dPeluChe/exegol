/**
 * Full-screen agent dashboard — Monitor sub-tab.
 *
 * Shows ALL agents across ALL projects in a card grid. Each card has:
 * - Provider icon + animated spinner (for running agents)
 * - Project name, task description, elapsed time
 * - Status badge with color
 * - Click to navigate to the agent's terminal pane
 *
 * Unlike the sidebar's AttentionSection (which is compact), this view
 * gives each agent enough room to be scanned at a glance.
 */

import type { Agent } from "@exegol/shared";
import { cn, ScrollArea } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, CheckCircle, Clock, Cpu, Square, XCircle } from "lucide-react";
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

// ─── Status config ──────────────────────────────────────────────────────

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

// ─── Spinner ────────────────────────────────────────────────────────────

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
  return SPINNER_SETS[Math.abs(hash) % SPINNER_SETS.length] ?? SPINNER_SETS[0]!;
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

// ─── Time ───────────────────────────────────────────────────────────────

function elapsedStr(startedAt: number | null): string {
  if (!startedAt) return "";
  const s = Math.floor(Date.now() / 1000 - startedAt);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// ─── Component ──────────────────────────────────────────────────────────

interface ProjectInfo {
  id: string;
  name: string;
}

export function AgentDashboard() {
  const storeAgents = useAgentStore((s) => s.agents);

  // Also fetch DB agents (includes completed/crashed that may not be in the live store)
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

  // Merge store agents (live) — these are the ones we care about
  const allAgents = useMemo(() => {
    const agents = Object.values(storeAgents);
    // Sort: running first, then by startedAt desc
    return agents.sort((a, b) => {
      const aActive = ["running", "spawning", "waiting_input"].includes(a.status) ? 0 : 1;
      const bActive = ["running", "spawning", "waiting_input"].includes(b.status) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return (b.startedAt ?? 0) - (a.startedAt ?? 0);
    });
  }, [storeAgents]);

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

  // Group by project
  const grouped = new Map<string, AgentState[]>();
  for (const agent of allAgents) {
    const list = grouped.get(agent.projectId) ?? [];
    list.push(agent);
    grouped.set(agent.projectId, list);
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4">
        {/* Summary bar */}
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
            {allAgents.filter((a) => a.status === "waiting_input").length} waiting
          </span>
        </div>

        {/* Project groups */}
        {Array.from(grouped.entries()).map(([projectId, agents]) => (
          <div key={projectId}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {projectMap.get(projectId) ?? projectId.slice(0, 12)}
              <span className="font-normal">({agents.length})</span>
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} onClick={() => navigateToAgent(agent)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

// ─── Agent Card ─────────────────────────────────────────────────────────

function AgentCard({ agent, onClick }: { agent: AgentState; onClick: () => void }) {
  const config = STATUS_CONFIG[agent.status] ?? DEFAULT_STATUS;
  const StatusIcon = config.icon;
  const isActive = ["running", "spawning", "waiting_input"].includes(agent.status);

  return (
    // biome-ignore lint/a11y/useSemanticElements: card with nested interactive elements
    <div
      className={cn(
        "group flex items-start gap-3 rounded-xl border p-3 transition-all",
        config.bg,
        "cursor-pointer hover:shadow-lg hover:shadow-black/10",
      )}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick();
      }}
      role="button"
      tabIndex={0}
    >
      {/* Left: icon + spinner */}
      <div className="flex flex-col items-center gap-1.5 pt-0.5">
        <AgentIcon provider={agent.cliType} size={28} />
        {isActive && <Spinner agentId={agent.id} />}
      </div>

      {/* Center: info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">{agent.cliType}</span>
          <span className={cn("flex items-center gap-1 text-[10px]", config.color)}>
            <StatusIcon className="h-3 w-3" />
            {config.label}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-text-muted">{agent.taskDescription}</p>
        {agent.currentStep && (
          <p className="mt-0.5 truncate text-[10px] text-text-muted/70 italic">
            {agent.currentStep}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-text-muted">
          {agent.startedAt && (
            <span className="flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {elapsedStr(agent.startedAt)}
            </span>
          )}
          {agent.branchName && (
            <span className="truncate rounded bg-white/5 px-1 py-0.5 font-mono text-[9px]">
              {agent.branchName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
