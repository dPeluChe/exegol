import type { Project, ProjectCreate } from "@exegol/shared";
import type Database from "libsql";
import { mapProjectRow, nanoid } from "./helpers";

export function listProjects(db: Database.Database): Project[] {
  const rows = db
    .prepare("SELECT * FROM projects ORDER BY sort_order ASC, last_opened_at DESC")
    .all();
  return (rows as Record<string, unknown>[]).map(mapProjectRow);
}

export function getProject(db: Database.Database, id: string): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return row ? mapProjectRow(row as Record<string, unknown>) : null;
}

export function createProject(db: Database.Database, data: ProjectCreate): Project {
  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(
    `INSERT INTO projects (id, name, path, git_remote, default_branch, default_ide, created_at, last_opened_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, data.name, data.path, data.gitRemote, data.defaultBranch, data.defaultIde, now, now);

  // biome-ignore lint/style/noNonNullAssertion: row was just inserted
  return getProject(db, id)!;
}

export function updateProjectLastOpened(db: Database.Database, id: string): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE projects SET last_opened_at = ? WHERE id = ?").run(now, id);
}

export function renameProject(db: Database.Database, id: string, name: string): void {
  db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(name, id);
}

export function updateProjectSortOrder(db: Database.Database, id: string, sortOrder: number): void {
  db.prepare("UPDATE projects SET sort_order = ? WHERE id = ?").run(sortOrder, id);
}

/** T146: move a project into a group (or ungroup with groupId = null). */
export function updateProjectGroup(
  db: Database.Database,
  id: string,
  groupId: string | null,
): void {
  db.prepare("UPDATE projects SET group_id = ? WHERE id = ?").run(groupId, id);
}

export function deleteProject(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}
