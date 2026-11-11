import type Database from "libsql";

/** The session the person marked as main, per project that has a mark */
export function projectMainMarks(db: Database.Database): Map<string, string> {
  const rows = db
    .prepare("SELECT id, main_agent_id FROM projects WHERE main_agent_id IS NOT NULL")
    .all() as { id: string; main_agent_id: string }[];
  return new Map(rows.map((r) => [r.id, r.main_agent_id]));
}

export function setProjectMainMark(
  db: Database.Database,
  projectId: string,
  agentId: string,
): void {
  db.prepare("UPDATE projects SET main_agent_id = ? WHERE id = ?").run(agentId, projectId);
}

/** Clears the mark only when it is that session's. True when one was cleared */
export function clearMainMark(db: Database.Database, agentId: string): boolean {
  const res = db
    .prepare("UPDATE projects SET main_agent_id = NULL WHERE main_agent_id = ?")
    .run(agentId);
  return Number(res.changes ?? 0) > 0;
}

/** A resume gives the session a new row: its mark follows. True when one moved */
export function moveMainMark(db: Database.Database, fromId: string, toId: string): boolean {
  const res = db
    .prepare("UPDATE projects SET main_agent_id = ? WHERE main_agent_id = ?")
    .run(toId, fromId);
  return Number(res.changes ?? 0) > 0;
}
