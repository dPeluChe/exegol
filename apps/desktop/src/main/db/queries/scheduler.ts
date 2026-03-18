import type { ScheduledResult, ScheduledTask, ScheduledTaskCreate } from "@exegol/shared";
import type Database from "libsql";
import { mapScheduledResultRow, mapScheduledTaskRow, nanoid } from "./helpers";

export function listScheduledTasks(db: Database.Database, projectId?: string): ScheduledTask[] {
  if (projectId) {
    const rows = db
      .prepare("SELECT * FROM scheduled_tasks WHERE project_id = ? ORDER BY next_run_at ASC")
      .all(projectId);
    return (rows as Record<string, unknown>[]).map(mapScheduledTaskRow);
  }
  const rows = db.prepare("SELECT * FROM scheduled_tasks ORDER BY next_run_at ASC").all();
  return (rows as Record<string, unknown>[]).map(mapScheduledTaskRow);
}

export function getScheduledTask(db: Database.Database, id: string): ScheduledTask | null {
  const row = db.prepare("SELECT * FROM scheduled_tasks WHERE id = ?").get(id);
  return row ? mapScheduledTaskRow(row as Record<string, unknown>) : null;
}

export function createScheduledTask(
  db: Database.Database,
  data: ScheduledTaskCreate,
  nextRunAt: number | null,
): ScheduledTask {
  const id = nanoid();
  db.prepare(
    `INSERT INTO scheduled_tasks (id, project_id, prompt, cron_expression, skill_name, cli_agent, max_token_budget, next_run_at, depends_on)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.projectId,
    data.prompt,
    data.cronExpression,
    data.skillName ?? null,
    data.cliAgent,
    data.maxTokenBudget ?? null,
    nextRunAt,
    data.dependsOn ?? null,
  );
  // biome-ignore lint/style/noNonNullAssertion: row was just inserted
  return getScheduledTask(db, id)!;
}

export function updateScheduledTask(
  db: Database.Database,
  id: string,
  data: Partial<{
    prompt: string;
    cronExpression: string;
    cliAgent: string;
    skillName: string | null;
    maxTokenBudget: number | null;
    lastRunAt: number;
    nextRunAt: number;
    lastResultStatus: string;
    enabled: boolean;
    dependsOn: string | null;
  }>,
): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (data.prompt !== undefined) {
    sets.push("prompt = ?");
    values.push(data.prompt);
  }
  if (data.cronExpression !== undefined) {
    sets.push("cron_expression = ?");
    values.push(data.cronExpression);
  }
  if (data.cliAgent !== undefined) {
    sets.push("cli_agent = ?");
    values.push(data.cliAgent);
  }
  if (data.skillName !== undefined) {
    sets.push("skill_name = ?");
    values.push(data.skillName);
  }
  if (data.maxTokenBudget !== undefined) {
    sets.push("max_token_budget = ?");
    values.push(data.maxTokenBudget);
  }
  if (data.lastRunAt !== undefined) {
    sets.push("last_run_at = ?");
    values.push(data.lastRunAt);
  }
  if (data.nextRunAt !== undefined) {
    sets.push("next_run_at = ?");
    values.push(data.nextRunAt);
  }
  if (data.lastResultStatus !== undefined) {
    sets.push("last_result_status = ?");
    values.push(data.lastResultStatus);
  }
  if (data.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(data.enabled ? 1 : 0);
  }
  if (data.dependsOn !== undefined) {
    sets.push("depends_on = ?");
    values.push(data.dependsOn);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE scheduled_tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteScheduledTask(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(id);
}

export function toggleScheduledTask(db: Database.Database, id: string, enabled: boolean): void {
  db.prepare("UPDATE scheduled_tasks SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function recordScheduledResult(
  db: Database.Database,
  data: { taskId: string; agentId: string; status: string; summary: string },
): void {
  const id = nanoid();
  db.prepare(
    `INSERT INTO scheduled_results (id, task_id, agent_id, status, summary)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, data.taskId, data.agentId, data.status, data.summary);
}

export function listScheduledResults(
  db: Database.Database,
  taskId: string,
  limit = 20,
): ScheduledResult[] {
  const rows = db
    .prepare("SELECT * FROM scheduled_results WHERE task_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(taskId, limit);
  return (rows as Record<string, unknown>[]).map(mapScheduledResultRow);
}
