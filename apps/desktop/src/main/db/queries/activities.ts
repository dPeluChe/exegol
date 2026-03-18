import type { Activity, ActivityType } from "@exegol/shared";
import type Database from "libsql";
import { nanoid } from "./helpers";

// ─── Row mapper ─────────────────────────────────────────────────────────────

function mapActivityRow(row: Record<string, unknown>): Activity {
  return {
    id: row.id as string,
    type: row.type as ActivityType,
    entityType: row.entity_type as string,
    entityId: (row.entity_id as string) ?? null,
    projectId: (row.project_id as string) ?? null,
    description: row.description as string,
    createdAt: row.created_at as number,
  };
}

// ─── Queries ────────────────────────────────────────────────────────────────

export function insertActivity(
  db: Database.Database,
  data: {
    type: ActivityType;
    entityType: string;
    entityId?: string;
    projectId?: string;
    description: string;
  },
): Activity {
  const id = nanoid();
  db.prepare(
    `INSERT INTO activities (id, type, entity_type, entity_id, project_id, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.type,
    data.entityType,
    data.entityId ?? null,
    data.projectId ?? null,
    data.description,
  );

  const row = db.prepare("SELECT * FROM activities WHERE id = ?").get(id);
  return mapActivityRow(row as Record<string, unknown>);
}

export function listActivities(
  db: Database.Database,
  opts: {
    projectId?: string;
    type?: string;
    limit?: number;
    since?: number;
  } = {},
): Activity[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.projectId) {
    conditions.push("project_id = ?");
    params.push(opts.projectId);
  }

  if (opts.type) {
    conditions.push("type = ?");
    params.push(opts.type);
  }

  if (opts.since) {
    conditions.push("created_at >= ?");
    params.push(opts.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 100;

  const rows = db
    .prepare(`SELECT * FROM activities ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as Record<string, unknown>[];

  return rows.map(mapActivityRow);
}
