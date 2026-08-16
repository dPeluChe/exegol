import { type FleetWorktree, LIVE_STATUSES, type Worktree } from "@exegol/shared";
import type Database from "libsql";
import { mapWorktreeRow, nanoid } from "./helpers";

export function listWorktrees(db: Database.Database, projectId: string): Worktree[] {
  const rows = db
    .prepare("SELECT * FROM worktrees WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId);
  return (rows as Record<string, unknown>[]).map(mapWorktreeRow);
}

/** T176: every worktree Exegol owns, across projects, with how many agents are
 *  still live in each — the view you need when a round ends and you want the
 *  disk back. Disk/git state is added by the caller, which can do I/O. */
export function listAllWorktreeRows(
  db: Database.Database,
): Omit<FleetWorktree, "exists" | "dirty">[] {
  const statuses = [...LIVE_STATUSES];
  const rows = db
    .prepare(
      `SELECT w.*, p.name AS project_name,
              (SELECT COUNT(*) FROM agents a
                WHERE a.worktree_id = w.id
                  AND a.status IN (${statuses.map(() => "?").join(",")})) AS live_agents
       FROM worktrees w JOIN projects p ON p.id = w.project_id
       ORDER BY p.name, w.branch_name`,
    )
    .all(...statuses) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...mapWorktreeRow(r),
    projectName: r.project_name as string,
    liveAgents: r.live_agents as number,
  }));
}

export function createWorktree(
  db: Database.Database,
  data: {
    projectId: string;
    agentId: string | null;
    path: string;
    branchName: string;
    autoCleanup?: boolean;
  },
): Worktree {
  const id = nanoid();

  db.prepare(
    `INSERT INTO worktrees (id, project_id, agent_id, path, branch_name, auto_cleanup)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, data.projectId, data.agentId, data.path, data.branchName, data.autoCleanup ? 1 : 0);

  const row = db.prepare("SELECT * FROM worktrees WHERE id = ?").get(id);
  return mapWorktreeRow(row as Record<string, unknown>);
}

export function getWorktreeByAgentId(db: Database.Database, agentId: string): Worktree | null {
  const row = db.prepare("SELECT * FROM worktrees WHERE agent_id = ? LIMIT 1").get(agentId);
  return row ? mapWorktreeRow(row as Record<string, unknown>) : null;
}

export function removeWorktree(db: Database.Database, id: string): void {
  db.prepare("UPDATE agents SET worktree_id = NULL WHERE worktree_id = ?").run(id);
  db.prepare("DELETE FROM worktrees WHERE id = ?").run(id);
}
