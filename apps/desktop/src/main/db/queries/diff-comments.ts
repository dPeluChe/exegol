import type { DiffComment, DiffCommentCreate } from "@exegol/shared";
import type Database from "libsql";
import { mapDiffCommentRow, nanoid } from "./helpers";

export function listDiffComments(
  db: Database.Database,
  projectId: string,
  filePath?: string,
): DiffComment[] {
  if (filePath) {
    const rows = db
      .prepare(
        "SELECT * FROM diff_comments WHERE project_id = ? AND file_path = ? ORDER BY line_number ASC",
      )
      .all(projectId, filePath);
    return (rows as Record<string, unknown>[]).map(mapDiffCommentRow);
  }
  const rows = db
    .prepare("SELECT * FROM diff_comments WHERE project_id = ? ORDER BY file_path, line_number ASC")
    .all(projectId);
  return (rows as Record<string, unknown>[]).map(mapDiffCommentRow);
}

export function createDiffComment(db: Database.Database, data: DiffCommentCreate): DiffComment {
  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(
    `INSERT INTO diff_comments (id, project_id, agent_id, file_path, line_number, hunk_index, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.projectId,
    data.agentId ?? null,
    data.filePath,
    data.lineNumber,
    data.hunkIndex ?? null,
    data.content,
    now,
  );

  const row = db.prepare("SELECT * FROM diff_comments WHERE id = ?").get(id);
  return mapDiffCommentRow(row as Record<string, unknown>);
}

export function deleteDiffComment(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM diff_comments WHERE id = ?").run(id);
}

export function toggleResolveDiffComment(db: Database.Database, id: string): void {
  db.prepare("UPDATE diff_comments SET resolved = 1 - resolved WHERE id = ?").run(id);
}
