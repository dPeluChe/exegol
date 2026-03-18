import type { OplogEntry, OplogOperation } from "@exegol/shared";
import type Database from "libsql";
import { nanoid } from "./helpers";

export type { OplogEntry, OplogOperation };

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OplogEntryCreate {
  agentId: string;
  projectId: string;
  operation: OplogOperation;
  refBefore?: string | null;
  refAfter?: string | null;
  description: string;
}

// ─── Row mapper ─────────────────────────────────────────────────────────────

function mapOplogRow(row: Record<string, unknown>): OplogEntry {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    projectId: row.project_id as string,
    operation: row.operation as OplogOperation,
    refBefore: (row.ref_before as string) ?? null,
    refAfter: (row.ref_after as string) ?? null,
    description: row.description as string,
    createdAt: row.created_at as number,
  };
}

// ─── Queries ────────────────────────────────────────────────────────────────

export function createOplogEntry(db: Database.Database, data: OplogEntryCreate): OplogEntry {
  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(
    `INSERT INTO oplog (id, agent_id, project_id, operation, ref_before, ref_after, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.agentId,
    data.projectId,
    data.operation,
    data.refBefore ?? null,
    data.refAfter ?? null,
    data.description,
    now,
  );

  // biome-ignore lint/style/noNonNullAssertion: row was just inserted
  return getOplogEntry(db, id)!;
}

export function getOplogEntry(db: Database.Database, id: string): OplogEntry | null {
  const row = db.prepare("SELECT * FROM oplog WHERE id = ?").get(id);
  return row ? mapOplogRow(row as Record<string, unknown>) : null;
}

export function listProjectOplog(
  db: Database.Database,
  projectId: string,
  limit = 100,
): OplogEntry[] {
  const rows = db
    .prepare("SELECT * FROM oplog WHERE project_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(projectId, limit) as Record<string, unknown>[];
  return rows.map(mapOplogRow);
}

export function listAgentOplog(db: Database.Database, agentId: string): OplogEntry[] {
  const rows = db
    .prepare("SELECT * FROM oplog WHERE agent_id = ? ORDER BY created_at DESC")
    .all(agentId) as Record<string, unknown>[];
  return rows.map(mapOplogRow);
}
