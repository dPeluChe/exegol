import { cn } from "@exegol/ui";
import { useProjects } from "../../hooks/use-trpc";
import { sessionName } from "../../lib/agent-label";
import { SEMANTIC_BADGE } from "../../lib/semantic-colors";
import type { AgentState } from "../../stores/agents";
import { ProjectChip, type ProjectMeta } from "./ProjectChip";

type Session = Pick<AgentState, "id" | "projectId" | "alias" | "taskDescription" | "cliType">;

const OTHER_PROJECT = "another project";

const byProject = <T extends Pick<Session, "projectId">>(list: T[]) => {
  const groups = new Map<string, T[]>();
  for (const s of list) groups.set(s.projectId, [...(groups.get(s.projectId) ?? []), s]);
  return groups;
};

/** Sessions grouped by project in first-seen order; past `max` they go to `hidden` */
export function groupSessions<T extends Pick<Session, "projectId">>(sessions: T[], max: number) {
  const ordered = [...byProject(sessions).values()].flat();
  return { groups: [...byProject(ordered.slice(0, max))], hidden: ordered.slice(max) };
}

/** Sessions as wrapped chips under their project, "+N more" for the rest */
export function SessionChips({ sessions, max = 16 }: { sessions: Session[]; max?: number }) {
  const { data: projects = [] } = useProjects();
  const metaOf = (id: string): ProjectMeta => {
    const p = projects.find((x) => x.id === id);
    return { name: p?.name ?? OTHER_PROJECT, color: p?.color ?? null };
  };
  const { groups, hidden } = groupSessions(sessions, max);
  const chip = "max-w-[140px] truncate rounded px-1.5 py-0.5 text-[10px]";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {groups.map(([projectId, list]) => (
        <div key={projectId} className="flex min-w-0 flex-wrap items-center gap-1">
          <ProjectChip project={metaOf(projectId)} className="text-[9px]" />
          {list.map((s) => (
            <span
              key={s.id}
              className={cn(chip, "bg-bg-tertiary text-text-secondary")}
              title={sessionName(s)}
            >
              {sessionName(s)}
            </span>
          ))}
        </div>
      ))}
      {hidden.length > 0 && (
        <span
          className={cn(chip, SEMANTIC_BADGE.muted)}
          title={hidden.map((s) => `${sessionName(s)} · ${metaOf(s.projectId).name}`).join("\n")}
        >
          +{hidden.length} more
        </span>
      )}
    </div>
  );
}
