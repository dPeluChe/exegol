import type Database from "libsql";

export interface SavedSitePermission {
  origin: string;
  permission: string;
  decision: "allow" | "block";
  updatedAt: number;
}

interface Row {
  origin: string;
  permission: string;
  decision: "allow" | "block";
  updated_at: number;
}

export function listBrowserPermissions(
  db: Database.Database,
  projectId: string,
): SavedSitePermission[] {
  const rows = db
    .prepare(
      `SELECT origin, permission, decision, updated_at FROM browser_permissions
       WHERE project_id = ? ORDER BY origin, permission`,
    )
    .all(projectId) as Row[];
  return rows.map((r) => ({
    origin: r.origin,
    permission: r.permission,
    decision: r.decision,
    updatedAt: r.updated_at,
  }));
}

export function saveBrowserPermission(
  db: Database.Database,
  projectId: string,
  origin: string,
  permission: string,
  decision: "allow" | "block",
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
