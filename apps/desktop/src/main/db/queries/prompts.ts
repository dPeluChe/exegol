import type { Prompt, PromptCreate, PromptUpdate } from "@exegol/shared";
import type Database from "libsql";
import { mapPromptRow, nanoid } from "./helpers";

export function listPrompts(db: Database.Database, projectId: string): Prompt[] {
  const rows = db
    .prepare("SELECT * FROM prompts WHERE project_id = ? ORDER BY pinned DESC, updated_at DESC")
    .all(projectId);
  return (rows as Record<string, unknown>[]).map(mapPromptRow);
}

export function createPrompt(db: Database.Database, data: PromptCreate): Prompt {
  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(
    `INSERT INTO prompts (id, project_id, title, content, category, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, data.projectId, data.title, data.content, data.category, now, now);

  const row = db.prepare("SELECT * FROM prompts WHERE id = ?").get(id);
  return mapPromptRow(row as Record<string, unknown>);
}

export function updatePrompt(db: Database.Database, id: string, data: PromptUpdate): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `UPDATE prompts SET title = COALESCE(?, title), content = COALESCE(?, content),
     category = COALESCE(?, category), updated_at = ? WHERE id = ?`,
  ).run(data.title ?? null, data.content ?? null, data.category ?? null, now, id);
}

export function deletePrompt(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM prompts WHERE id = ?").run(id);
}

export function togglePinPrompt(db: Database.Database, id: string): void {
  db.prepare("UPDATE prompts SET pinned = 1 - pinned, updated_at = ? WHERE id = ?").run(
    Math.floor(Date.now() / 1000),
    id,
  );
}
