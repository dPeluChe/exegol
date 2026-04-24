import { randomUUID } from "node:crypto";
import type { ParallelRun, ParallelRunStatus } from "@exegol/shared";
import type Database from "libsql";

export function createParallelRun(
  db: Database.Database,
  data: {
    projectId: string;
    taskDescription: string;
    cliTypes: string[];
    agentIds: string[];
  },
): ParallelRun {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO parallel_runs (id, project_id, task_description, cli_types, agent_ids, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'running', ?)`,
  ).run(
    id,
    data.projectId,
    data.taskDescription,
    JSON.stringify(data.cliTypes),
    JSON.stringify(data.agentIds),
    now,
  );

  return {
    id,
    projectId: data.projectId,
    taskDescription: data.taskDescription,
    cliTypes: data.cliTypes,
    agentIds: data.agentIds,
    status: "running",
    promotedAgentId: null,
    createdAt: now,
    completedAt: null,
  };
}

export function getParallelRun(db: Database.Database, id: string): ParallelRun | null {
  const row = db.prepare("SELECT * FROM parallel_runs WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return mapParallelRunRow(row);
}

export function listParallelRuns(db: Database.Database, projectId: string): ParallelRun[] {
  const rows = db
    .prepare("SELECT * FROM parallel_runs WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Record<string, unknown>[];
  return rows.map(mapParallelRunRow);
}

export function updateParallelRunStatus(
  db: Database.Database,
  id: string,
  status: ParallelRunStatus,
): void {
  const completedAt = ["completed", "failed", "cancelled"].includes(status)
    ? Math.floor(Date.now() / 1000)
    : null;
  db.prepare("UPDATE parallel_runs SET status = ?, completed_at = ? WHERE id = ?").run(
    status,
    completedAt,
    id,
  );
}

export function promoteParallelRunAgent(
  db: Database.Database,
  runId: string,
  agentId: string,
): void {
  db.prepare(
    "UPDATE parallel_runs SET promoted_agent_id = ?, status = 'completed' WHERE id = ?",
  ).run(agentId, runId);
}

function mapParallelRunRow(row: Record<string, unknown>): ParallelRun {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    taskDescription: row.task_description as string,
    cliTypes: JSON.parse((row.cli_types as string) || "[]"),
    agentIds: JSON.parse((row.agent_ids as string) || "[]"),
    status: row.status as ParallelRunStatus,
    promotedAgentId: (row.promoted_agent_id as string) ?? null,
    createdAt: row.created_at as number,
    completedAt: (row.completed_at as number) ?? null,
  };
}
