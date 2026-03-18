import type { SkillState } from "@exegol/shared";
import type Database from "libsql";
import { nanoid } from "./helpers";

// ─── Row mapper ──────────────────────────────────────────────────────────────

function mapSkillStateRow(row: Record<string, unknown>): SkillState {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    skillName: row.skill_name as string,
    enabled: Boolean(row.enabled),
  };
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export function listSkillStates(db: Database.Database, projectId: string): SkillState[] {
  const rows = db.prepare("SELECT * FROM skills_state WHERE project_id = ?").all(projectId);
  return (rows as Record<string, unknown>[]).map(mapSkillStateRow);
}

export function getSkillState(
  db: Database.Database,
  projectId: string,
  skillName: string,
): SkillState | null {
  const row = db
    .prepare("SELECT * FROM skills_state WHERE project_id = ? AND skill_name = ?")
    .get(projectId, skillName);
  return row ? mapSkillStateRow(row as Record<string, unknown>) : null;
}

export function setSkillEnabled(
  db: Database.Database,
  projectId: string,
  skillName: string,
  enabled: boolean,
): SkillState {
  const existing = getSkillState(db, projectId, skillName);

  if (existing) {
    db.prepare("UPDATE skills_state SET enabled = ? WHERE id = ?").run(
      enabled ? 1 : 0,
      existing.id,
    );
    return { ...existing, enabled };
  }

  const id = nanoid();
  db.prepare(
    "INSERT INTO skills_state (id, project_id, skill_name, enabled) VALUES (?, ?, ?, ?)",
  ).run(id, projectId, skillName, enabled ? 1 : 0);

  return { id, projectId, skillName, enabled };
}
