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
