import { type Agent, inboxPendingState, LIVE_STATUSES } from "@exegol/shared";
import { ScrollArea } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { Cpu, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useFleetSync } from "../../../hooks/use-fleet-sync";
import { useInboxThreads } from "../../../hooks/use-inbox";
import { useMountEffect } from "../../../hooks/use-mount-effect";
import { IS_MAC } from "../../../lib/keymap";
import { trpcInvoke } from "../../../lib/trpc-client";
import { type AgentState, jumpToAgent, useAgentStore } from "../../../stores/agents";
import { type DashboardMode, useAppStore } from "../../../stores/app";
import { useWatchStore } from "../../../stores/watch";
import { FilterChip } from "../../common/FilterChip";
import type { ProjectMeta } from "../../common/ProjectChip";
import { type SegmentedTab, SegmentedTabs } from "../../common/SegmentedTabs";
import { ColabsSection } from "./ColabsSection";
import { CommanderSection } from "./CommanderSection";
import { CompanySection } from "./CompanySection";
import { FleetGroups, type GroupBy } from "./FleetGroups";
import { WatchingSection } from "./WatchingSection";
import { WorktreesCard } from "./WorktreesCard";

// ─── Data ───────────────────────────────────────────────────────────────

/** agents.listActive row (db/queries/agents.ts#listActiveAgents). */
type ActiveAgent = Agent & { projectName: string; groupColor: string | null };

interface ProjectInfo {
  id: string;
  name: string;
  color?: string | null;
}

// ─── Component ──────────────────────────────────────────────────────────

// The dashboard spans every project, so starting an agent means picking one
function startAgentIn(projectId: string) {
  useAppStore.getState().setActiveProject(projectId);
  window.dispatchEvent(new CustomEvent("exegol:spawn-agent"));
}

function NoAgents({ projects }: { projects: ProjectInfo[] | undefined }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-bg-primary p-8">
      <Cpu className="h-10 w-10 text-text-muted/30" />
      <div className="text-center">
        <p className="text-sm font-medium text-text-primary">No agents running</p>
        <p className="mt-1 text-xs text-text-muted">
          The dashboard shows agents from every project. Start one:
        </p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-1.5">
        {(projects ?? []).map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => startAgentIn(p.id)}
            className="flex items-center gap-2 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-left text-xs text-text-primary transition-colors hover:border-accent/40 hover:bg-accent/10"
          >
            <Plus className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="shrink-0 text-[10px] text-text-muted">Start agent</span>
          </button>
        ))}
        {projects?.length === 0 && (
          <p className="text-center text-[11px] text-text-muted">
            Add a project from the sidebar first.
          </p>
        )}
      </div>
      {/* Orphaned worktrees are cleaned from here: hiding it with no agents left them stranded */}
      <div className="w-full max-w-2xl">
        <WorktreesCard />
      </div>
    </div>
  );
}

export function AgentDashboard() {
  const storeAgents = useAgentStore((s) => s.agents);
  const attentionItems = useAgentStore((s) => s.attentionItems);
  const [groupBy, setGroupBy] = useState<GroupBy>("state");
  // Pinned sessions open it on Watching, until a tab is picked
  const watchingCount = useWatchStore((s) => s.watched.length);
  const picked = useAppStore((s) => s.dashboardMode);
  const mode: DashboardMode = picked ?? (watchingCount > 0 ? "watching" : "company");
  const setMode = useAppStore((s) => s.setDashboardMode);
  const inbox = useInboxThreads("active");

  // Closing the dashboard is what "left" means; Company reads the last stamp as it mounts
  useMountEffect(() => {
    const stamp = () => useAppStore.getState().setCompanySeenAt(Date.now());
    window.addEventListener("pagehide", stamp);
    return () => {
      window.removeEventListener("pagehide", stamp);
      stamp();
    };
  });

  // The fleet is hydrated into the store app-wide (useFleetSync); same query, same cache
  const activeRows = useFleetSync<ActiveAgent>();

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => trpcInvoke<ProjectInfo[]>("projects.list"),
    staleTime: 30_000,
  });

  // Project name/color per projectId — listActive rows carry it; projects.list
  // fills in for Recent agents whose project has no live rows.
  const projectMeta = useMemo(() => {
    const m = new Map<string, ProjectMeta>();
    for (const p of projects ?? []) m.set(p.id, { name: p.name, color: p.color ?? null });
    // The project's own color wins over its group's
    for (const r of activeRows ?? []) {
      m.set(r.projectId, { name: r.projectName, color: m.get(r.projectId)?.color ?? r.groupColor });
    }
    return m;
  }, [projects, activeRows]);

  const all = useMemo(
    () =>
      Object.values(storeAgents)
        .filter((a) => !a.archived)
        .sort((a, b) => {
          const aActive = LIVE_STATUSES.has(a.status) ? 0 : 1;
          const bActive = LIVE_STATUSES.has(b.status) ? 0 : 1;
          if (aActive !== bActive) return aActive - bActive;
          return (b.startedAt ?? 0) - (a.startedAt ?? 0);
        }),
    [storeAgents],
  );
  const unread = useMemo(
    () =>
      new Set(
        all.filter((a) => attentionItems[a.id] && !attentionItems[a.id]?.read).map((a) => a.id),
      ),
    [all, attentionItems],
  );
  const runningCount = all.filter((a) => a.status === "running").length;

  const navigateToAgent = useCallback((agent: AgentState) => {
    jumpToAgent(agent.id, agent.projectId);
  }, []);

  const companyLike = mode === "company" || mode === "combined";
  const modeTabs: SegmentedTab<DashboardMode>[] = [
    { id: "commander", label: "Commander" },
    { id: "company", label: "Company" },
    { id: "combined", label: "Combined" },
    {
      id: "colabs",
      label: "Colabs",
      count: inbox.length,
      alert: inbox.some((t) => inboxPendingState(t) === "needs_you"),
    },
    { id: "watching", label: "Watching" },
    { id: "all", label: "All sessions" },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 p-4 pb-3 text-xs text-text-muted">
        <div className="shrink-0">
          <SegmentedTabs tabs={modeTabs} active={mode} onChange={setMode} label="Dashboard view" />
        </div>
        <span className="flex items-center gap-1.5">
          <Cpu className="h-3.5 w-3.5" />
          <span className="font-medium text-text-primary">{all.length}</span> agents
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          {runningCount} running
        </span>
        {!companyLike && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            {unread.size} need attention
          </span>
        )}
        {companyLike && (
          <span className="ml-auto">
            P next that needs you, {IS_MAC ? "Option" : "Alt"}+Up/Down moves between sessions, Enter
            opens it in its layout
          </span>
        )}
        {mode === "all" && (
          <div className="ml-auto flex items-center gap-1">
            <FilterChip active={groupBy === "state"} onClick={() => setGroupBy("state")}>
              By state
            </FilterChip>
            <FilterChip active={groupBy === "project"} onClick={() => setGroupBy("project")}>
              By project
            </FilterChip>
          </div>
        )}
      </div>
      {mode === "commander" ? (
        <CommanderSection projectMeta={projectMeta} />
      ) : mode === "combined" ? (
        <CompanySection projectMeta={projectMeta} commander />
      ) : all.length === 0 && mode !== "colabs" ? (
        <NoAgents projects={projects} />
      ) : mode === "company" ? (
        <CompanySection projectMeta={projectMeta} />
      ) : mode === "colabs" ? (
        <ColabsSection projectMeta={projectMeta} />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 p-4 pt-0">
            {mode === "all" ? (
              <FleetGroups
                agents={all}
                unread={unread}
                groupBy={groupBy}
                projectMeta={projectMeta}
                onOpenAgent={navigateToAgent}
              />
            ) : watchingCount > 0 ? (
              <WatchingSection projectMeta={projectMeta} onOpenAgent={navigateToAgent} />
            ) : (
              <p className="py-8 text-center text-xs text-text-muted">
                No pinned sessions. Use Watch on a session to keep its terminal here.
              </p>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
