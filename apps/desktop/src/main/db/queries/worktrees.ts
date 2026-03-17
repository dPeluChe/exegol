import type { Worktree } from "@exegol/shared";
import type Database from "libsql";
import { mapWorktreeRow, nanoid } from "./helpers";

export function listWorktrees(db: Database.Database, projectId: string): Worktree[] {
  const rows = db
    .prepare("SELECT * FROM worktrees WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId);
  return (rows as Record<string, unknown>[]).map(mapWorktreeRow);
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

export function removeWorktree(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM worktrees WHERE id = ?").run(id);
}
