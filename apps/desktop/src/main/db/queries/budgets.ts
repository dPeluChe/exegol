import type { Budget, BudgetLimitType, BudgetPeriod } from "@exegol/shared";
import type Database from "libsql";
import { nanoid } from "nanoid";

function mapBudgetRow(r: Record<string, unknown>): Budget {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    period: r.period as BudgetPeriod,
    limitType: r.limit_type as BudgetLimitType,
    limitValue: r.limit_value as number,
    hardStop: !!r.hard_stop,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

export function getBudgets(db: Database.Database, projectId: string): Budget[] {
  const rows = db
    .prepare("SELECT * FROM budgets WHERE project_id = ? ORDER BY period")
    .all(projectId) as Record<string, unknown>[];
  return rows.map(mapBudgetRow);
}

export function getBudget(
  db: Database.Database,
  projectId: string,
  period: BudgetPeriod,
): Budget | null {
  const row = db
    .prepare("SELECT * FROM budgets WHERE project_id = ? AND period = ?")
    .get(projectId, period) as Record<string, unknown> | undefined;
  return row ? mapBudgetRow(row) : null;
}

export interface UpsertBudgetInput {
  projectId: string;
  period: BudgetPeriod;
  limitType: BudgetLimitType;
  limitValue: number;
  hardStop: boolean;
}

export function upsertBudget(db: Database.Database, input: UpsertBudgetInput): Budget {
  const existing = getBudget(db, input.projectId, input.period);
  const id = existing?.id ?? nanoid();
  db.prepare(
    `INSERT INTO budgets (id, project_id, period, limit_type, limit_value, hard_stop, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(project_id, period) DO UPDATE SET
       limit_type = excluded.limit_type,
       limit_value = excluded.limit_value,
       hard_stop = excluded.hard_stop,
       updated_at = unixepoch()`,
  ).run(
    id,
    input.projectId,
    input.period,
    input.limitType,
    input.limitValue,
    input.hardStop ? 1 : 0,
  );
  // biome-ignore lint/style/noNonNullAssertion: just inserted/updated above
  return getBudget(db, input.projectId, input.period)!;
}

export function deleteBudget(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM budgets WHERE id = ?").run(id);
}

// ─── Period windows ─────────────────────────────────────────────────────
// "weekly" MEASURES a rolling 7-day window ending today (UTC), but its
// periodKey must be a STABLE ISO-week label: keying alert dedup on the
// rolling window's start date changed every midnight, re-firing the same
// "budget at 80%" notification daily and growing budget_alerts unboundedly.

function isoWeekKey(d: Date): string {
  // ISO-8601 week number (Thursday rule), UTC.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function periodWindow(period: BudgetPeriod): { since: number; periodKey: string } {
  const now = new Date();
  if (period === "daily") {
    const since = Math.floor(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000,
    );
    return { since, periodKey: now.toISOString().slice(0, 10) };
  }
  const startDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6),
  );
  return {
    since: Math.floor(startDate.getTime() / 1000),
    periodKey: isoWeekKey(now),
  };
}

export interface BudgetUsage {
  tokens: number;
  costUsd: number;
  since: number;
  periodKey: string;
}

export function getBudgetUsage(
  db: Database.Database,
  projectId: string,
  period: BudgetPeriod,
): BudgetUsage {
  const { since, periodKey } = periodWindow(period);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
        COALESCE(SUM(estimated_cost_usd), 0.0) AS cost
       FROM token_usage
       WHERE (agent_id IN (SELECT id FROM agents WHERE project_id = ?) OR agent_id = ?)
         AND recorded_at >= ?`,
    )
    .get(projectId, `scan:${projectId}`, since) as { tokens: number; cost: number };
  return { tokens: row.tokens, costUsd: row.cost, since, periodKey };
}

// ─── Alert dedup (one notification per budget/threshold/period) ─────────

export function hasAlertFired(
  db: Database.Database,
  budgetId: string,
  threshold: 80 | 100,
  periodKey: string,
): boolean {
  const row = db
    .prepare("SELECT 1 FROM budget_alerts WHERE budget_id = ? AND threshold = ? AND period_key = ?")
    .get(budgetId, threshold, periodKey);
  return !!row;
}

export function recordAlertFired(
  db: Database.Database,
  budgetId: string,
  threshold: 80 | 100,
  periodKey: string,
): void {
  db.prepare(
    "INSERT OR IGNORE INTO budget_alerts (id, budget_id, threshold, period_key) VALUES (?, ?, ?, ?)",
  ).run(nanoid(), budgetId, threshold, periodKey);
}
