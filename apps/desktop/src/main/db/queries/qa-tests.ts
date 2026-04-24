import { randomUUID } from "node:crypto";
import type { QaTest, QaTestRun, QaTestStatus } from "@exegol/shared";
import type Database from "libsql";

// ─── QA Tests ─────────────────────────────────────────────────────────────

export function createQaTest(
  db: Database.Database,
  data: {
    projectId: string;
    name: string;
    startUrl: string;
    actions: string;
  },
): QaTest {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const actionCount = JSON.parse(data.actions).length as number;

  db.prepare(
    `INSERT INTO qa_tests (id, project_id, name, start_url, actions, action_count, created_at, last_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'saved')`,
  ).run(id, data.projectId, data.name, data.startUrl, data.actions, actionCount, now);

  return {
    id,
    projectId: data.projectId,
    name: data.name,
    startUrl: data.startUrl,
    actions: data.actions,
    actionCount,
    createdAt: now,
    lastRunAt: null,
    lastStatus: "saved",
  };
}

export function listQaTests(db: Database.Database, projectId: string): QaTest[] {
  const rows = db
    .prepare("SELECT * FROM qa_tests WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Record<string, unknown>[];
  return rows.map(mapQaTestRow);
}

export function getQaTest(db: Database.Database, id: string): QaTest | null {
  const row = db.prepare("SELECT * FROM qa_tests WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return mapQaTestRow(row);
}

export function deleteQaTest(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM qa_tests WHERE id = ?").run(id);
}

// ─── QA Test Runs ─────────────────────────────────────────────────────────

export function createQaTestRun(
  db: Database.Database,
  data: {
    testId: string;
    status: QaTestStatus;
    stepResults: string;
    consoleErrors: string;
    durationMs: number;
  },
): QaTestRun {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(
    `INSERT INTO qa_test_runs (id, test_id, status, step_results, console_errors, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, data.testId, data.status, data.stepResults, data.consoleErrors, data.durationMs, now);

  return {
    id,
    testId: data.testId,
    status: data.status,
    stepResults: data.stepResults,
    consoleErrors: data.consoleErrors,
    durationMs: data.durationMs,
    createdAt: now,
  };
}

export function updateQaTestRun(
  db: Database.Database,
  runId: string,
  data: {
    status: QaTestStatus;
    stepResults: string;
    consoleErrors: string;
    durationMs: number;
  },
): void {
  db.prepare(
    `UPDATE qa_test_runs SET status = ?, step_results = ?, console_errors = ?, duration_ms = ? WHERE id = ?`,
  ).run(data.status, data.stepResults, data.consoleErrors, data.durationMs, runId);
}

export function getLatestTestRun(db: Database.Database, testId: string): QaTestRun | null {
  const row = db
    .prepare("SELECT * FROM qa_test_runs WHERE test_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(testId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapQaTestRunRow(row);
}

export function updateQaTestLastRun(
  db: Database.Database,
  testId: string,
  status: QaTestStatus,
): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE qa_tests SET last_run_at = ?, last_status = ? WHERE id = ?").run(
    now,
    status,
    testId,
  );
}

// ─── Row Mappers ──────────────────────────────────────────────────────────

function mapQaTestRow(row: Record<string, unknown>): QaTest {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    name: row.name as string,
    startUrl: row.start_url as string,
    actions: row.actions as string,
    actionCount: row.action_count as number,
    createdAt: row.created_at as number,
    lastRunAt: (row.last_run_at as number) ?? null,
    lastStatus: row.last_status as QaTestStatus,
  };
}

function mapQaTestRunRow(row: Record<string, unknown>): QaTestRun {
  return {
    id: row.id as string,
    testId: row.test_id as string,
    status: row.status as QaTestStatus,
    stepResults: row.step_results as string,
    consoleErrors: row.console_errors as string,
    durationMs: row.duration_ms as number,
    createdAt: row.created_at as number,
  };
}
