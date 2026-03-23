import type {
  PipelineRun,
  PipelineRunStatus,
  PipelineStepDef,
  PipelineStepResult,
  PipelineTemplate,
  PipelineTemplateCreate,
  PipelineTemplateUpdate,
} from "@exegol/shared";
import type Database from "libsql";
import { nanoid } from "./helpers";

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function mapTemplateRow(row: Record<string, unknown>): PipelineTemplate {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    name: row.name as string,
    description: row.description as string,
    steps: JSON.parse(row.steps as string) as PipelineStepDef[],
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

function mapRunRow(row: Record<string, unknown>): PipelineRun {
  return {
    id: row.id as string,
    templateId: row.template_id as string,
    projectId: row.project_id as string,
    status: row.status as PipelineRunStatus,
    currentStepIndex: row.current_step_index as number,
    stepResults: JSON.parse(row.step_results as string) as PipelineStepResult[],
    iterationCount: row.iteration_count as number,
    maxIterations: row.max_iterations as number,
    originalTask: row.original_task as string,
    worktreePath: (row.worktree_path as string) ?? null,
    createdAt: row.created_at as number,
    startedAt: (row.started_at as number) ?? null,
    completedAt: (row.completed_at as number) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Templates CRUD
// ---------------------------------------------------------------------------

export function listPipelineTemplates(
  db: Database.Database,
  projectId: string,
): PipelineTemplate[] {
  const rows = db
    .prepare("SELECT * FROM pipeline_templates WHERE project_id = ? ORDER BY updated_at DESC")
    .all(projectId);
  return (rows as Record<string, unknown>[]).map(mapTemplateRow);
}

export function getPipelineTemplate(db: Database.Database, id: string): PipelineTemplate | null {
  const row = db.prepare("SELECT * FROM pipeline_templates WHERE id = ?").get(id);
  return row ? mapTemplateRow(row as Record<string, unknown>) : null;
}

export function createPipelineTemplate(
  db: Database.Database,
  data: PipelineTemplateCreate,
): PipelineTemplate {
  const id = nanoid();
  db.prepare(
    `INSERT INTO pipeline_templates (id, project_id, name, description, steps)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, data.projectId, data.name, data.description ?? "", JSON.stringify(data.steps));
  // biome-ignore lint/style/noNonNullAssertion: row was just inserted
  return getPipelineTemplate(db, id)!;
}

export function updatePipelineTemplate(
  db: Database.Database,
  id: string,
  data: PipelineTemplateUpdate,
): PipelineTemplate | null {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (data.name !== undefined) {
    sets.push("name = ?");
    values.push(data.name);
  }
  if (data.description !== undefined) {
    sets.push("description = ?");
    values.push(data.description);
  }
  if (data.steps !== undefined) {
    sets.push("steps = ?");
    values.push(JSON.stringify(data.steps));
  }

  if (sets.length === 0) return getPipelineTemplate(db, id);

  sets.push("updated_at = unixepoch()");
  db.prepare(`UPDATE pipeline_templates SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  return getPipelineTemplate(db, id);
}

export function deletePipelineTemplate(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM pipeline_templates WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Runs CRUD
// ---------------------------------------------------------------------------

export function listPipelineRuns(db: Database.Database, projectId: string): PipelineRun[] {
  const rows = db
    .prepare(
      `SELECT * FROM pipeline_runs WHERE project_id = ?
       ORDER BY
         CASE WHEN status = 'running' THEN 0
              WHEN status = 'paused' THEN 1
              WHEN status = 'pending' THEN 2
              ELSE 3 END,
         created_at DESC`,
    )
    .all(projectId);
  return (rows as Record<string, unknown>[]).map(mapRunRow);
}

export function getPipelineRun(db: Database.Database, id: string): PipelineRun | null {
  const row = db.prepare("SELECT * FROM pipeline_runs WHERE id = ?").get(id);
  return row ? mapRunRow(row as Record<string, unknown>) : null;
}

export function createPipelineRun(
  db: Database.Database,
  data: {
    templateId: string;
    projectId: string;
    originalTask: string;
    maxIterations: number;
    worktreePath: string | null;
  },
): PipelineRun {
  const id = nanoid();
  db.prepare(
    `INSERT INTO pipeline_runs (id, template_id, project_id, original_task, max_iterations, worktree_path)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.templateId,
    data.projectId,
    data.originalTask,
    data.maxIterations,
    data.worktreePath,
  );
  // biome-ignore lint/style/noNonNullAssertion: row was just inserted
  return getPipelineRun(db, id)!;
}

export function updatePipelineRun(
  db: Database.Database,
  id: string,
  data: {
    status?: PipelineRunStatus;
    currentStepIndex?: number;
    stepResults?: PipelineStepResult[];
    iterationCount?: number;
    worktreePath?: string | null;
    startedAt?: number;
    completedAt?: number;
  },
): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (data.status !== undefined) {
    sets.push("status = ?");
    values.push(data.status);
  }
  if (data.currentStepIndex !== undefined) {
    sets.push("current_step_index = ?");
    values.push(data.currentStepIndex);
  }
  if (data.stepResults !== undefined) {
    sets.push("step_results = ?");
    values.push(JSON.stringify(data.stepResults));
  }
  if (data.iterationCount !== undefined) {
    sets.push("iteration_count = ?");
    values.push(data.iterationCount);
  }
  if (data.worktreePath !== undefined) {
    sets.push("worktree_path = ?");
    values.push(data.worktreePath);
  }
  if (data.startedAt !== undefined) {
    sets.push("started_at = ?");
    values.push(data.startedAt);
  }
  if (data.completedAt !== undefined) {
    sets.push("completed_at = ?");
    values.push(data.completedAt);
  }

  if (sets.length > 0) {
    db.prepare(`UPDATE pipeline_runs SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  }
}

export function deletePipelineRun(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM pipeline_runs WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Recovery: mark running pipelines as paused on startup
// ---------------------------------------------------------------------------

export function recoverStalePipelineRuns(db: Database.Database): number {
  const result = db
    .prepare("UPDATE pipeline_runs SET status = 'paused' WHERE status = 'running'")
    .run();
  return result.changes;
}
