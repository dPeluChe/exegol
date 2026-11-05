import { z } from "zod";
import { deleteBudget, getBudgets, upsertBudget } from "../../db/queries";
import { budgetStatus, checkAllBudgets } from "../../tokens/budget-check";
import { publicProcedure, router } from "../trpc";

const periodSchema = z.enum(["daily", "weekly"]);
const limitTypeSchema = z.enum(["tokens", "dollars"]);

export const budgetsRouter = router({
  list: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => getBudgets(ctx.db, input.projectId)),

  /** Current usage vs. limit for a period */
  status: publicProcedure
    .input(z.object({ projectId: z.string(), period: periodSchema }))
    .query(({ ctx, input }) => budgetStatus(ctx.db, input.projectId, input.period)),

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
    .mutation(({ ctx, input }) => {
      const budget = upsertBudget(ctx.db, input);
      checkAllBudgets(ctx.db);
      return budget;
    }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    deleteBudget(ctx.db, input.id);
    return { success: true };
  }),
});
