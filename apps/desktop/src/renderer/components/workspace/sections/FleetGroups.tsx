import { LIVE_STATUSES } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { trpcMutate } from "../../../lib/trpc-client";
import { type AgentState, isWorking, useAgentStore } from "../../../stores/agents";
import type { ProjectMeta } from "../../common/ProjectChip";
import { AgentCard } from "./AgentCard";
import { WorktreesCard } from "./WorktreesCard";

export type GroupBy = "state" | "project";

const GROUP_TITLES: Record<string, string> = {
  needs: "Needs attention",
  working: "Working",
  idle: "Idle — at prompt",
  recent: "Recent",
};

interface FleetGroup {
  key: string;
  title: string;
  color: string | null;
  agents: AgentState[];
}

function groupFleet(
  agents: AgentState[],
  unread: ReadonlySet<string>,
  groupBy: GroupBy,
  projectMeta: Map<string, ProjectMeta>,
): FleetGroup[] {
  if (groupBy === "state") {
    const buckets: Record<string, AgentState[]> = { needs: [], working: [], idle: [], recent: [] };
    for (const a of agents) {
      const key = unread.has(a.id)
        ? "needs"
        : isWorking(a)
          ? "working"
          : LIVE_STATUSES.has(a.status)
            ? "idle"
            : "recent";
      buckets[key]?.push(a);
    }
    return Object.entries(buckets)
      .filter(([, list]) => list.length > 0)
      .map(([key, list]) => ({ key, title: GROUP_TITLES[key] ?? key, color: null, agents: list }));
  }
  const byProject = new Map<string, AgentState[]>();
  for (const a of agents) byProject.set(a.projectId, [...(byProject.get(a.projectId) ?? []), a]);
  return [...byProject].map(([projectId, list]) => {
    const meta = projectMeta.get(projectId);
    return {
      key: projectId,
      title: meta?.name ?? projectId.slice(0, 12),
      color: meta?.color ?? null,
      agents: list,
    };
  });
}

export function FleetGroups({
  agents,
  unread,
  groupBy,
  projectMeta,
  onOpenAgent,
}: {
  agents: AgentState[];
  unread: ReadonlySet<string>;
  groupBy: GroupBy;
  projectMeta: Map<string, ProjectMeta>;
  onOpenAgent: (agent: AgentState) => void;
}) {
  const queryClient = useQueryClient();
  const [archiving, setArchiving] = useState(false);
  const archiveEnded = useCallback(async () => {
    setArchiving(true);
    try {
      await trpcMutate("agents.archiveEnded", {});
      // The dashboard renders from the store, so the rows must leave the VIEW
      // too — but flagged rather than removed, or every ended agent's open
      // terminal pane is treated as stale and reset to the launcher.
      const store = useAgentStore.getState();
      for (const a of Object.values(store.agents)) {
        if (!LIVE_STATUSES.has(a.status)) store.markArchived(a.id);
      }
      queryClient.invalidateQueries({ queryKey: ["recentSessions"] });
    } finally {
      setArchiving(false);
    }
  }, [queryClient]);

  /** One card at a time: "Archive all" is the bulk broom, this is the shrug at a
   *  single finished session you have already read. */
  const archiveOne = useCallback(
    async (agentId: string) => {
      await trpcMutate("agents.archive", { id: agentId });
      // Flagged, not removed: a removed row makes an open terminal pane look
      // stale and WorkspacePane converts it to empty, losing the transcript.
      useAgentStore.getState().markArchived(agentId);
      queryClient.invalidateQueries({ queryKey: ["recentSessions"] });
    },
    [queryClient],
  );

  const groups = useMemo(
    () => groupFleet(agents, unread, groupBy, projectMeta),
    [agents, unread, groupBy, projectMeta],
  );

  return (
    <>
      <WorktreesCard />

      {groups.map((group) => (
        <div key={group.key}>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            <span
              className={cn("h-1.5 w-1.5 rounded-full", !group.color && "bg-accent")}
              style={group.color ? { backgroundColor: group.color } : undefined}
            />
            {group.title}
            <span className="font-normal">({group.agents.length})</span>
            {/* Ended sessions pile up forever — a list you cannot clear is a
          list you stop reading. Archive keeps the row (scoring, oplog,
          resume handle); it only leaves the view. */}
            {group.key === "recent" && (
              <button
                type="button"
                onClick={archiveEnded}
                disabled={archiving}
                className="ml-auto flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-normal normal-case tracking-normal text-text-muted transition-colors hover:border-accent/40 hover:text-text-secondary disabled:opacity-50"
              >
                <Archive className="h-3 w-3" />
                Archive all
              </button>
            )}
          </h3>
          {group.key === "recent" ? (
            <RecentByDay
              agents={group.agents}
              renderCard={(agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  projectMeta={projectMeta.get(agent.projectId)}
                  hasUnread={unread.has(agent.id)}
                  onOpenAgent={onOpenAgent}
                  onArchiveAgent={archiveOne}
                />
              )}
            />
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  projectMeta={groupBy === "state" ? projectMeta.get(agent.projectId) : undefined}
                  hasUnread={unread.has(agent.id)}
                  onOpenAgent={onOpenAgent}
                  onArchiveAgent={LIVE_STATUSES.has(agent.status) ? undefined : archiveOne}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

/**
 * Ended sessions by the day they started, each day collapsed: dozens of crashed cards after a
 * restart pulled the eye away from the live ones. A day header says how many and how many failed.
 */
function RecentByDay({
  agents,
  renderCard,
}: {
  agents: AgentState[];
  renderCard: (agent: AgentState) => React.ReactNode;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const days = new Map<string, AgentState[]>();
  for (const a of [...agents].sort((x, y) => (y.startedAt ?? 0) - (x.startedAt ?? 0))) {
    const key = dayLabel(a.startedAt);
    days.set(key, [...(days.get(key) ?? []), a]);
  }
  return (
    <div className="space-y-1">
      {[...days.entries()].map(([day, list]) => {
        const failed = list.filter((a) => a.status === "failed" || a.status === "crashed").length;
        const isOpen = open.has(day);
        return (
          <div key={day}>
            <button
              type="button"
              onClick={() =>
                setOpen((prev) => {
                  const next = new Set(prev);
                  if (next.has(day)) next.delete(day);
                  else next.add(day);
                  return next;
                })
              }
              className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[11px] text-text-secondary hover:bg-white/5"
            >
              {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <span className="font-medium">{day}</span>
              <span className="text-text-muted">
                {list.length} session{list.length === 1 ? "" : "s"}
              </span>
              {failed > 0 && (
                <span className="text-[10px] text-red-400/80">{failed} crashed or failed</span>
              )}
            </button>
            {isOpen && (
              <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {list.map(renderCard)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function dayLabel(startedAt: number | null): string {
  if (!startedAt) return "Earlier";
  const d = new Date(startedAt * 1000);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
