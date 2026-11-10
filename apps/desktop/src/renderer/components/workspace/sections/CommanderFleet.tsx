import { ScrollArea } from "@exegol/ui";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { sessionName } from "../../../lib/agent-label";
import { type DeskState, deskState } from "../../../lib/company";
import { isLiveSession } from "../../../lib/sidebar-views";
import { type AgentState, jumpToAgent, useAgentStore } from "../../../stores/agents";
import { AgentIcon } from "../../common/AgentIcon";
import type { ProjectMeta } from "../../common/ProjectChip";
import { DESK_STATE, StateLine } from "./DeskState";

const LISTED: [DeskState, string][] = [
  ["needs", "Need you"],
  ["stuck", "Stuck"],
  ["unread", "Unread"],
  ["working", "Working"],
];

type Groups = Record<DeskState, AgentState[]>;

/** What the Commander watches, beside its chat: the sessions that ask for the person first */
export function CommanderFleet({
  commanderProjectId,
  projectMeta,
}: {
  commanderProjectId: string;
  projectMeta: ReadonlyMap<string, ProjectMeta>;
}) {
  const sessions = useAgentStore(
    useShallow((s) =>
      Object.values(s.agents).filter(
        (a) => a.projectId !== commanderProjectId && a.cliType !== "shell" && isLiveSession(a),
      ),
    ),
  );
  const attention = useAgentStore((s) => s.attentionItems);
  const unseen = useAgentStore((s) => s.unseenTurns);
  const groups = useMemo(() => {
    const out: Groups = { needs: [], stuck: [], unread: [], working: [], idle: [], suspended: [] };
    for (const a of sessions) out[deskState(a, attention[a.id], a.id in unseen)].push(a);
    for (const list of Object.values(out))
      list.sort((x, y) => (y.activitySince ?? 0) - (x.activitySince ?? 0));
    return out;
  }, [sessions, attention, unseen]);
  const projects = new Set(sessions.map((a) => a.projectId)).size;
  const quiet = groups.idle.length;
  return (
    <aside className="hidden min-h-0 w-80 shrink-0 flex-col rounded-lg border border-border bg-bg-secondary lg:flex xl:w-2/5 2xl:w-1/2">
      <div className="border-b border-border px-3 py-2">
        <div className="text-xs font-medium text-text-primary">Fleet</div>
        <div className="text-[10px] text-text-muted">
          {sessions.length} sessions in {projects} projects
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid grid-cols-1 content-start gap-3 p-2 xl:grid-cols-2 2xl:grid-cols-3">
          {LISTED.map(([state, label]) => {
            const list = groups[state];
            if (list.length === 0) return null;
            return (
              <section key={state} className="flex flex-col gap-1">
                <h3 className={`px-1 text-[10px] font-medium ${DESK_STATE[state].color}`}>
                  {label} · {list.length}
                </h3>
                {list.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => jumpToAgent(a.id, a.projectId)}
                    title="Open in its layout"
                    className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-bg-tertiary"
                  >
                    <AgentIcon provider={a.cliType} size={16} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[11px] text-text-primary">
                        {projectMeta.get(a.projectId)?.name ?? "Project"}
                      </span>
                      <span className="truncate text-[10px] text-text-muted">
                        {sessionName(a)} ·{" "}
                        <StateLine state={state} activitySince={a.activitySince} />
                      </span>
                    </span>
                  </button>
                ))}
              </section>
            );
          })}
          {sessions.length === quiet && (
            <p className="col-span-full px-1 text-[11px] text-text-muted">
              Nothing needs you right now.
            </p>
          )}
          {quiet > 0 && (
            <p className="col-span-full px-1 text-[10px] text-text-muted">
              {quiet} waiting at their prompt
            </p>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
