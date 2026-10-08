import {
  DICTATION_TARGET_KINDS,
  type DictationHistoryItem,
  type DictationTargetKind,
} from "@exegol/shared";
import type Database from "libsql";
import { nanoid } from "../db/queries/helpers";

const DAY_MS = 86_400_000;

function mapRow(row: Record<string, unknown>): DictationHistoryItem {
  const kind = row.target_kind as DictationTargetKind;
  return {
    id: row.id as string,
    text: row.text as string,
    modelId: row.model_id as string,
    durationMs: row.duration_ms as number,
    createdAt: row.created_at as number,
    projectId: (row.project_id as string | null) ?? null,
    targetKind: (DICTATION_TARGET_KINDS as readonly string[]).includes(kind) ? kind : "clipboard",
  };
}

export function addDictation(
  db: Database.Database,
  item: Omit<DictationHistoryItem, "id" | "createdAt">,
  now = Date.now(),
): DictationHistoryItem {
  const row: DictationHistoryItem = { ...item, id: nanoid(), createdAt: now };
  // A project deleted meanwhile must not fail the insert on its foreign key
  const projectId =
    row.projectId &&
    (db.prepare("SELECT 1 FROM projects WHERE id = ?").get(row.projectId) ? row.projectId : null);
  db.prepare(
    `INSERT INTO dictation_history (id, text, model_id, duration_ms, created_at, project_id, target_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.text, row.modelId, row.durationMs, row.createdAt, projectId, row.targetKind);
  return { ...row, projectId: projectId || null };
}

export function listDictations(db: Database.Database, limit: number): DictationHistoryItem[] {
  const rows = db
    .prepare("SELECT * FROM dictation_history ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(limit) as Record<string, unknown>[];
  return rows.map(mapRow);
}

export function getDictation(db: Database.Database, id: string): DictationHistoryItem | null {
  const row = db.prepare("SELECT * FROM dictation_history WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapRow(row) : null;
}

export function deleteDictation(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM dictation_history WHERE id = ?").run(id);
}

export function clearDictations(db: Database.Database): void {
  db.prepare("DELETE FROM dictation_history").run();
}

/** Drops what is older than `days` and everything past the newest `max`; returns how many */
export function pruneDictations(
  db: Database.Database,
  retention: { days: number; max: number },
  now = Date.now(),
): number {
  const old = db
    .prepare("DELETE FROM dictation_history WHERE created_at < ?")
    .run(now - retention.days * DAY_MS);
  const extra = db
    .prepare(
      `DELETE FROM dictation_history WHERE id NOT IN (
         SELECT id FROM dictation_history ORDER BY created_at DESC, rowid DESC LIMIT ?
       )`,
    )
    .run(retention.max);
  return Number(old.changes) + Number(extra.changes);
}
