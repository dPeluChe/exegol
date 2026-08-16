/**
 * T172 — path claims: cooperative file reservation between agents.
 *
 * git offers no protection when two agents edit one working tree; the first
 * coordinated round only avoided a collision because a human-facing coordinator
 * grepped the assignments by hand before handing them out (2026-08-13). A claim
 * makes that check mechanical.
 *
 * Deliberately NOT globs: a claim is a concrete file or a directory, and a
 * directory covers everything beneath it. Overlap is then prefix comparison —
 * predictable to an agent reading an error, and it can't silently under-match
 * the way glob-vs-glob reasoning does. Paths are stored absolute, so agents in
 * separate worktrees never conflict (they genuinely can't collide).
 */

import { LIVE_STATUSES } from "@exegol/shared";
import type Database from "libsql";
import { nanoid } from "./helpers";

export interface PathClaim {
  id: string;
  agentId: string;
  projectId: string;
  path: string;
  note: string | null;
}

export interface ClaimConflict {
  path: string;
  heldBy: string;
  heldByName: string | null;
  note: string | null;
}

function mapRow(row: Record<string, unknown>): PathClaim {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    projectId: row.project_id as string,
    path: row.path as string,
    note: (row.note as string) ?? null,
  };
}

/** Same file, or one contains the other — a directory claim covers its tree. */
function pathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * All-or-nothing: if ANY requested path overlaps another live agent's claim,
 * nothing is granted. A partial grant would read as success and send the agent
 * straight into the conflict it asked us to prevent.
 *
 * Re-claiming a path you already hold is a no-op success, so an agent can call
 * this defensively without tracking what it already owns.
 */
export function claimPaths(
  db: Database.Database,
  input: { agentId: string; projectId: string; paths: string[]; note?: string | null },
): { granted: string[]; conflicts: ClaimConflict[] } {
  // One query answers both halves: who else holds what, and what I already hold.
  const all = listProjectClaims(db, input.projectId);
  const existing = all.filter((c) => c.agentId !== input.agentId);
  const conflicts: ClaimConflict[] = [];
  for (const path of input.paths) {
    for (const claim of existing) {
      if (!pathsOverlap(path, claim.path)) continue;
      conflicts.push({
        path,
        heldBy: claim.agentId,
        heldByName: claim.heldByName,
        note: claim.note,
      });
      break;
    }
  }
  if (conflicts.length > 0) return { granted: [], conflicts };

  const mine = new Set(all.filter((c) => c.agentId === input.agentId).map((c) => c.path));
  const insert = db.prepare(
    "INSERT INTO path_claims (id, agent_id, project_id, path, note) VALUES (?, ?, ?, ?, ?)",
  );
  const toInsert = input.paths.filter((p) => !mine.has(p));
  db.transaction(() => {
    for (const path of toInsert) {
      insert.run(nanoid(), input.agentId, input.projectId, path, input.note ?? null);
    }
  })();
  return { granted: input.paths, conflicts: [] };
}

/** Release specific paths, or every claim this agent holds when `paths` is omitted. */
export function releasePaths(
  db: Database.Database,
  agentId: string,
  paths?: string[],
): { released: number } {
  if (!paths?.length) {
    const info = db.prepare("DELETE FROM path_claims WHERE agent_id = ?").run(agentId);
    return { released: Number(info.changes ?? 0) };
  }
  const info = db
    .prepare(
      `DELETE FROM path_claims WHERE agent_id = ? AND path IN (${paths.map(() => "?").join(",")})`,
    )
    .run(agentId, ...paths);
  return { released: Number(info.changes ?? 0) };
}

/** Every live claim in a project — what a coordinator needs before assigning. */
export function listProjectClaims(
  db: Database.Database,
  projectId: string,
): Array<PathClaim & { heldByName: string | null }> {
  const statuses = [...LIVE_STATUSES];
  const rows = db
    .prepare(
      `SELECT c.*, a.alias FROM path_claims c
       JOIN agents a ON a.id = c.agent_id
       WHERE c.project_id = ? AND a.status IN (${statuses.map(() => "?").join(",")})
       ORDER BY c.path`,
    )
    .all(projectId, ...statuses) as Record<string, unknown>[];
  return rows.map((r) => ({ ...mapRow(r), heldByName: (r.alias as string) ?? null }));
}

/**
 * May this agent write this path? The single place that answers it, so the
 * PreToolUse guard and any future auditor share one rule instead of each
 * re-deriving prefix overlap from the claim rows.
 */
export function findBlockingClaim(
  db: Database.Database,
  input: { agentId: string; projectId: string; path: string },
): { heldBy: string; note: string | null } | null {
  const conflict = listProjectClaims(db, input.projectId).find(
    (c) => c.agentId !== input.agentId && pathsOverlap(input.path, c.path),
  );
  if (!conflict) return null;
  return { heldBy: conflict.heldByName ?? conflict.agentId, note: conflict.note };
}
