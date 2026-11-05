import type { Budget, BudgetLimitType, BudgetPeriod, BudgetStatus } from "@exegol/shared";
import { limitThreshold } from "@exegol/shared";
import type Database from "libsql";
import {
  getAllBudgets,
  getBudget,
  getBudgetUsage,
  hasAlertFired,
  recordAlertFired,
} from "../db/queries";
import { getNotificationBus } from "../notifications/bus";

export function formatUsage(value: number, limitType: BudgetLimitType): string {
  return limitType === "dollars"
    ? `$${value.toFixed(2)}`
    : `${Math.round(value).toLocaleString()} tokens`;
}

function measure(db: Database.Database, budget: Budget) {
  const usage = getBudgetUsage(db, budget.projectId, budget.period);
  const current = budget.limitType === "tokens" ? usage.tokens : usage.costUsd;
  const percentUsed = budget.limitValue > 0 ? (current / budget.limitValue) * 100 : 0;
  return { usage, current, percentUsed };
}

export function budgetStatus(
  db: Database.Database,
  projectId: string,
  period: BudgetPeriod,
): BudgetStatus {
  const budget = getBudget(db, projectId, period);
  if (!budget) {
    return { budget: null, currentUsage: 0, periodStart: 0, periodEnd: 0, percentUsed: 0 };
  }
  const { usage, current, percentUsed } = measure(db, budget);
  return {
    budget,
    currentUsage: current,
    periodStart: usage.since,
    periodEnd: Math.floor(Date.now() / 1000),
    percentUsed,
  };
}

/** One notification per (budget, threshold, period), deduped in `budget_alerts` */
export function checkAllBudgets(db: Database.Database): void {
  for (const budget of getAllBudgets(db)) {
    const { usage, current, percentUsed } = measure(db, budget);
    const threshold = limitThreshold(percentUsed);
    if (!threshold || hasAlertFired(db, budget.id, threshold, usage.periodKey)) continue;
    recordAlertFired(db, budget.id, threshold, usage.periodKey);
    getNotificationBus().emit({
      type: "budget:warning",
      title:
        threshold === 100 ? `${budget.period} budget reached` : `${budget.period} budget at 80%`,
      body: `Used ${formatUsage(current, budget.limitType)} of ${formatUsage(budget.limitValue, budget.limitType)}`,
      projectId: budget.projectId,
      at: Date.now(),
      meta: {
        threshold,
        budgetId: budget.id,
        period: budget.period,
        current,
        limit: budget.limitValue,
      },
    });
  }
}
