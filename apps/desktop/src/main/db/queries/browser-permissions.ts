import type { SavedSitePermission, SiteDecision } from "@exegol/shared";
import type Database from "libsql";

export function listBrowserPermissions(
  db: Database.Database,
  projectId: string,
): SavedSitePermission[] {
  return db
    .prepare(
      `SELECT origin, permission, decision, updated_at AS updatedAt FROM browser_permissions
       WHERE project_id = ? ORDER BY origin, permission`,
    )
    .all(projectId) as SavedSitePermission[];
}

export function saveBrowserPermission(
  db: Database.Database,
  projectId: string,
  origin: string,
  permission: string,
  decision: SiteDecision,
): void {
  db.prepare(
    `INSERT INTO browser_permissions (project_id, origin, permission, decision, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id, origin, permission)
     DO UPDATE SET decision = excluded.decision, updated_at = excluded.updated_at`,
  ).run(projectId, origin, permission, decision, Math.floor(Date.now() / 1000));
}

export function deleteBrowserPermission(
  db: Database.Database,
  projectId: string,
  origin: string,
  permission: string,
): boolean {
  const r = db
    .prepare(
      "DELETE FROM browser_permissions WHERE project_id = ? AND origin = ? AND permission = ?",
    )
    .run(projectId, origin, permission);
  return r.changes > 0;
}
