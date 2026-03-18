import type { QueueTask, QueueTaskStatus } from "@exegol/shared";
import type Database from "libsql";
import { nanoid } from "./helpers";

// ─── Row Mapper ──────────────────────────────────────────────────────────────

function mapQueueTaskRow(row: Record<string, unknown>): QueueTask {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    prompt: row.prompt as string,
    cliType: row.cli_type as string,
    priority: row.priority as number,
    status: row.status as QueueTaskStatus,
    dependsOn: (row.depends_on as string) ?? null,
    agentId: (row.agent_id as string) ?? null,
    createdAt: row.created_at as number,
    startedAt: (row.started_at as number) ?? null,
    completedAt: (row.completed_at as number) ?? null,
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function addToQueue(
  db: Database.Database,
  data: {
    projectId: string;
    prompt: string;
    cliType?: string;
    priority?: number;
    dependsOn?: string | null;
  },
): QueueTask {
  const id = nanoid();
  const status = data.dependsOn ? "blocked" : "queued";
  db.prepare(
    `INSERT INTO task_queue (id, project_id, prompt, cli_type, priority, status, depends_on)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.projectId,
    data.prompt,
    data.cliType ?? "claude-code",
    data.priority ?? 0,
    status,
    data.dependsOn ?? null,
  );
  // biome-ignore lint/style/noNonNullAssertion: row was just inserted
  return getQueueTask(db, id)!;
}

export function getQueueTask(db: Database.Database, id: string): QueueTask | null {
  const row = db.prepare("SELECT * FROM task_queue WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapQueueTaskRow(row) : null;
}

export function listQueueTasks(
  db: Database.Database,
  projectId?: string,
  status?: string,
): QueueTask[] {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (projectId) {
    conditions.push("project_id = ?");
    values.push(projectId);
  }
  if (status) {
    conditions.push("status = ?");
    values.push(status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `SELECT * FROM task_queue ${where}
       ORDER BY
         CASE WHEN status = 'running' THEN 0
              WHEN status = 'queued' THEN 1
              WHEN status = 'blocked' THEN 2
              WHEN status = 'completed' THEN 3
              WHEN status = 'failed' THEN 4
              WHEN status = 'cancelled' THEN 5
         END,
         priority DESC, created_at ASC`,
    )
    .all(...values);
  return (rows as Record<string, unknown>[]).map(mapQueueTaskRow);
}

export function listQueuedTasks(db: Database.Database, projectId: string): QueueTask[] {
  const rows = db
    .prepare(
      `SELECT * FROM task_queue
       WHERE project_id = ? AND status = 'queued'
       ORDER BY priority DESC, created_at ASC`,
    )
    .all(projectId);
  return (rows as Record<string, unknown>[]).map(mapQueueTaskRow);
}

export function countRunningQueueTasks(db: Database.Database, projectId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) as count FROM task_queue WHERE project_id = ? AND status = 'running'")
    .get(projectId) as { count: number };
  return row.count;
}

export function updateQueueTaskStatus(
  db: Database.Database,
  id: string,
  status: string,
  agentId?: string,
): void {
  const now = Math.floor(Date.now() / 1000);

  if (status === "running") {
    db.prepare("UPDATE task_queue SET status = ?, started_at = ?, agent_id = ? WHERE id = ?").run(
      status,
      now,
      agentId ?? null,
      id,
    );
  } else if (status === "completed" || status === "failed" || status === "cancelled") {
    db.prepare("UPDATE task_queue SET status = ?, completed_at = ? WHERE id = ?").run(
      status,
      now,
      id,
    );
  } else {
    db.prepare("UPDATE task_queue SET status = ? WHERE id = ?").run(status, id);
  }
}

export function cancelQueueTask(db: Database.Database, id: string): void {
  updateQueueTaskStatus(db, id, "cancelled");
}

export function unblockDependents(db: Database.Database, completedTaskId: string): void {
  // Find tasks that depend on the completed task and unblock them
  db.prepare(
    "UPDATE task_queue SET status = 'queued' WHERE depends_on = ? AND status = 'blocked'",
  ).run(completedTaskId);
}

export function updateQueueTaskPriority(db: Database.Database, id: string, priority: number): void {
  db.prepare("UPDATE task_queue SET priority = ? WHERE id = ?").run(priority, id);
}
