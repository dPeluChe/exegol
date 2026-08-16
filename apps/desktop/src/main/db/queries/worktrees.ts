import type { Worktree } from "@exegol/shared";
import type Database from "libsql";
import { mapWorktreeRow, nanoid } from "./helpers";

export function listWorktrees(db: Database.Database, projectId: string): Worktree[] {
  const rows = db
    .prepare("SELECT * FROM worktrees WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId);
  return (rows as Record<string, unknown>[]).map(mapWorktreeRow);
}

export interface WorktreeFleetRow {
  id: string;
  path: string;
  branchName: string;
  projectId: string;
  projectName: string;
  liveAgents: number;
}

/** T176: every worktree Exegol owns, across projects, with how many agents are
 *  still live in each — the view you need when a round ends and you want the
 *  disk back. Disk/git state is added by the caller, which can do I/O. */
export function listAllWorktreeRows(
  db: Database.Database,
  liveStatuses: readonly string[],
): WorktreeFleetRow[] {
  const rows = db
    .prepare(
      `SELECT w.id, w.path, w.branch_name, w.project_id, p.name AS project_name,
              (SELECT COUNT(*) FROM agents a
                WHERE a.worktree_id = w.id
                  AND a.status IN (${liveStatuses.map(() => "?").join(",")})) AS live_agents
       FROM worktrees w JOIN projects p ON p.id = w.project_id
       ORDER BY p.name, w.branch_name`,
    )
    .all(...liveStatuses) as Array<{
    id: string;
    path: string;
    branch_name: string;
    project_id: string;
    project_name: string;
    live_agents: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    branchName: r.branch_name,
    projectId: r.project_id,
    projectName: r.project_name,
    liveAgents: r.live_agents,
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
