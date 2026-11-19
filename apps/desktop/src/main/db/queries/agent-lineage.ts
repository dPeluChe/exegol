import type Database from "libsql";

const MAX_RESUMES = 500;

/** When each session's first row started (`started_at` is set once, at creation), following
 *  `resumed_from` back: a resume keeps it */
export function lineageStarts(db: Database.Database, ids: string[]): Map<string, number> {
  if (ids.length === 0) return new Map();
  const rows = db
    .prepare(
      `WITH RECURSIVE chain(id, at, prev, depth) AS (
         SELECT id, started_at, resumed_from, 0 FROM agents
         WHERE id IN (${ids.map(() => "?").join(",")})
         UNION ALL
         SELECT c.id, a.started_at, a.resumed_from, c.depth + 1
         FROM chain c JOIN agents a ON a.id = c.prev
         WHERE c.depth < ${MAX_RESUMES}
       )
       SELECT id, MIN(at) AS started FROM chain GROUP BY id`,
    )
    .all(...ids) as { id: string; started: number | null }[];
  return new Map(rows.flatMap((r) => (r.started === null ? [] : [[r.id, r.started]])));
}

/** A session's rows, this one and those it was resumed from: its messages hang on each */
export function lineageIds(db: Database.Database, id: string): string[] {
  const rows = db
    .prepare(
      `WITH RECURSIVE chain(id, prev, depth) AS (
         SELECT id, resumed_from, 0 FROM agents WHERE id = ?
         UNION ALL
         SELECT a.id, a.resumed_from, c.depth + 1
         FROM chain c JOIN agents a ON a.id = c.prev
         WHERE c.depth < ${MAX_RESUMES}
       )
       SELECT id FROM chain`,
    )
    .all(id) as { id: string }[];
  return rows.map((r) => r.id);
}

/** Every row that carries a name, ended ones too: a session is known to others by its name */
export function idsNamed(db: Database.Database, alias: string): string[] {
  const rows = db.prepare("SELECT id FROM agents WHERE alias = ? COLLATE NOCASE").all(alias) as {
    id: string;
  }[];
  return rows.map((r) => r.id);
}

/** Of a session that left or joined the fleet: a resume gives it a new row */
export interface SessionMove {
  resumedFrom: string | null;
  suspended: boolean;
}

/** Where each session came from and whether it is suspended, for the ones that left or joined */
export function sessionMoves(db: Database.Database, ids: string[]): Map<string, SessionMove> {
  if (ids.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT id, resumed_from, suspended_at FROM agents
       WHERE id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids) as { id: string; resumed_from: string | null; suspended_at: number | null }[];
  return new Map(
    rows.map((r) => [r.id, { resumedFrom: r.resumed_from, suspended: r.suspended_at !== null }]),
  );
}
