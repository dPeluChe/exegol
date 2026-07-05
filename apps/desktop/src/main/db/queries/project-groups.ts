import type { ProjectGroup, ProjectGroupCreate } from "@exegol/shared";
import type Database from "libsql";
import { mapProjectGroupRow, nanoid } from "./helpers";

export function listProjectGroups(db: Database.Database): ProjectGroup[] {
  const rows = db.prepare("SELECT * FROM project_groups ORDER BY sort_order ASC").all();
  return (rows as Record<string, unknown>[]).map(mapProjectGroupRow);
}

export function getProjectGroup(db: Database.Database, id: string): ProjectGroup | null {
  const row = db.prepare("SELECT * FROM project_groups WHERE id = ?").get(id);
  return row ? mapProjectGroupRow(row as Record<string, unknown>) : null;
}

export function createProjectGroup(db: Database.Database, data: ProjectGroupCreate): ProjectGroup {
  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);
  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM project_groups")
    .get() as { max_order: number };

  db.prepare(
    `INSERT INTO project_groups (id, name, color, icon, background, sort_order, collapsed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(id, data.name, data.color, data.icon, data.background, maxOrder.max_order + 1, now);

  // biome-ignore lint/style/noNonNullAssertion: row was just inserted
  return getProjectGroup(db, id)!;
}

export function renameProjectGroup(db: Database.Database, id: string, name: string): void {
  db.prepare("UPDATE project_groups SET name = ? WHERE id = ?").run(name, id);
}

export function updateProjectGroupAppearance(
  db: Database.Database,
  id: string,
  appearance: { color: string | null; icon: string | null; background: string | null },
): void {
  db.prepare("UPDATE project_groups SET color = ?, icon = ?, background = ? WHERE id = ?").run(
    appearance.color,
    appearance.icon,
    appearance.background,
    id,
  );
}

export function setProjectGroupCollapsed(
  db: Database.Database,
  id: string,
  collapsed: boolean,
): void {
  db.prepare("UPDATE project_groups SET collapsed = ? WHERE id = ?").run(collapsed ? 1 : 0, id);
}

export function reorderProjectGroups(db: Database.Database, orderedIds: string[]): void {
  const stmt = db.prepare("UPDATE project_groups SET sort_order = ? WHERE id = ?");
  const tx = db.transaction((ids: string[]) => {
    for (const [index, id] of ids.entries()) stmt.run(index, id);
  });
  tx(orderedIds);
}

/** Disband: delete the group, member projects fall back to root (group_id = NULL via ON DELETE SET NULL). */
export function deleteProjectGroup(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM project_groups WHERE id = ?").run(id);
}
