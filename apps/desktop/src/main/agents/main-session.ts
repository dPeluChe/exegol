import type { MainSession } from "@exegol/shared";
import type Database from "libsql";
import { mainSessionId } from "../commander/fleet";
import { lineageStarts } from "../db/queries/agent-lineage";
import { type ActiveAgent, listActiveAgents } from "../db/queries/agents";
import { projectMainMarks } from "../db/queries/main-session";

/** Each project's main session: the person's mark while that session is live, else the one
 *  whose lineage started first. Only projects with a live agent session are listed */
export function mainSessions(
  db: Database.Database,
  agents: ActiveAgent[] = listActiveAgents(db),
): Record<string, MainSession> {
  const sessions = agents.filter((a) => a.cliType !== "shell");
  const starts = lineageStarts(
    db,
    sessions.map((a) => a.id),
  );
  const marks = projectMainMarks(db);
  const byProject = new Map<string, ActiveAgent[]>();
  for (const a of sessions) {
    const list = byProject.get(a.projectId);
    if (list) list.push(a);
    else byProject.set(a.projectId, [a]);
  }
  const out: Record<string, MainSession> = {};
  for (const [projectId, list] of byProject) {
    const mark = marks.get(projectId);
    const id = mainSessionId(
      list.map((a) => ({ id: a.id, startedAt: a.startedAt, lineageStart: starts.get(a.id) })),
      mark,
    );
    if (id) out[projectId] = { id, marked: id === mark, live: list.length };
  }
  return out;
}
