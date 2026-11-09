import type Database from "libsql";

export interface CommanderLogEntry {
  id: number;
  at: number;
  action: string;
  target: string | null;
  outcome: "done" | "refused";
  summary: string | null;
  ref: string | null;
}

type NewCommanderLogEntry = Omit<CommanderLogEntry, "id" | "at"> & { sessionId: string };

export function insertCommanderLog(db: Database.Database, entry: NewCommanderLogEntry): void {
  db.prepare(
    `INSERT INTO commander_log (at, session_id, action, target, outcome, summary, ref)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    Date.now(),
    entry.sessionId,
    entry.action,
    entry.target,
    entry.outcome,
    entry.summary,
    entry.ref,
  );
}

/** Newest first */
export function listCommanderLog(db: Database.Database, limit: number): CommanderLogEntry[] {
  return db
    .prepare(
      `SELECT id, at, action, target, outcome, summary, ref FROM commander_log
       ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as CommanderLogEntry[];
}
