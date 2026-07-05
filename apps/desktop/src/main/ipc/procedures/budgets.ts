import type { BudgetLimitType, BudgetPeriod, BudgetStatus } from "@exegol/shared";
import { z } from "zod";
import {
  deleteBudget,
  getBudget,
  getBudgets,
  getBudgetUsage,
  hasAlertFired,
  recordAlertFired,
  upsertBudget,
} from "../../db/queries";
import { getNotificationBus } from "../../notifications/bus";
import type { Context } from "../context";
import { publicProcedure, router } from "../trpc";

const periodSchema = z.enum(["daily", "weekly"]);
const limitTypeSchema = z.enum(["tokens", "dollars"]);

function formatUsage(value: number, limitType: BudgetLimitType): string {
  return limitType === "dollars"
    ? `$${value.toFixed(2)}`
    : `${Math.round(value).toLocaleString()} tokens`;
}

/**
 * Reads current usage against the project's budget for a period and, on
 * crossing 80%/100%, emits one notification per (budget, threshold, period)
 * — deduped via the `budget_alerts` table so repeated polling doesn't spam.
 */
function checkBudgetStatus(ctx: Context, projectId: string, period: BudgetPeriod): BudgetStatus {
  const budget = getBudget(ctx.db, projectId, period);
  if (!budget) {
    return { budget: null, currentUsage: 0, periodStart: 0, periodEnd: 0, percentUsed: 0 };
  }

  const usage = getBudgetUsage(ctx.db, projectId, period);
  const current = budget.limitType === "tokens" ? usage.tokens : usage.costUsd;
  const percentUsed = budget.limitValue > 0 ? (current / budget.limitValue) * 100 : 0;

  const threshold: 80 | 100 | null = percentUsed >= 100 ? 100 : percentUsed >= 80 ? 80 : null;
  if (threshold && !hasAlertFired(ctx.db, budget.id, threshold, usage.periodKey)) {
    recordAlertFired(ctx.db, budget.id, threshold, usage.periodKey);
    getNotificationBus().emit({
      type: "budget:warning",
      title: threshold === 100 ? `${period} budget reached` : `${period} budget at 80%`,
      body: `Used ${formatUsage(current, budget.limitType)} of ${formatUsage(budget.limitValue, budget.limitType)}`,
      projectId,
      at: Date.now(),
      meta: { threshold, budgetId: budget.id, period, current, limit: budget.limitValue },
    });
  }

  return {
    budget,
    currentUsage: current,
    periodStart: usage.since,
    periodEnd: Math.floor(Date.now() / 1000),
    percentUsed,
  };
}

export const budgetsRouter = router({
  list: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => getBudgets(ctx.db, input.projectId)),

  /** Current usage vs. limit for a period — also fires 80%/100% notifications. */
  status: publicProcedure
    .input(z.object({ projectId: z.string(), period: periodSchema }))
    .query(({ ctx, input }) => checkBudgetStatus(ctx, input.projectId, input.period)),

  upsert: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        period: periodSchema,
        limitType: limitTypeSchema,
        limitValue: z.number().positive(),
        hardStop: z.boolean().default(false),
      }),
    )
    .mutation(({ ctx, input }) => upsertBudget(ctx.db, input)),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    deleteBudget(ctx.db, input.id);
    return { success: true };
  }),
});
