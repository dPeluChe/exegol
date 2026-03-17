import { TRPCError } from "@trpc/server";
import { Cron } from "croner";
import { z } from "zod";
import {
  createScheduledTask,
  deleteScheduledTask,
  getScheduledTask,
  listScheduledResults,
  listScheduledTasks,
  toggleScheduledTask,
  updateScheduledTask,
} from "../../db/queries";
import { getSchedulerEngine } from "../../scheduler/engine";
import { publicProcedure, router } from "../trpc";

export const schedulerRouter = router({
  list: publicProcedure
    .input(z.object({ projectId: z.string().optional() }).optional())
    .query(({ ctx, input }) => {
      return listScheduledTasks(ctx.db, input?.projectId);
    }),

  get: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const task = getScheduledTask(ctx.db, input.id);
    if (!task) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Scheduled task not found" });
    }
    return task;
  }),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        prompt: z.string().min(1),
        cronExpression: z.string(),
        cliAgent: z.string(),
        skillName: z.string().optional(),
        maxTokenBudget: z.number().int().positive().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      // Validate cron expression by attempting to construct
      let job: Cron;
      try {
        job = new Cron(input.cronExpression);
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid cron expression: "${input.cronExpression}"`,
        });
      }

      // Compute next_run_at
      const nextRun = job.nextRun();
      const nextRunAt = nextRun ? Math.floor(nextRun.getTime() / 1000) : null;
      job.stop();

      const task = createScheduledTask(ctx.db, input, nextRunAt);

      // Register with scheduler engine
      const engine = getSchedulerEngine();
      engine.addTask(task.id, task.cronExpression);

      return task;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        prompt: z.string().min(1).optional(),
        cronExpression: z.string().optional(),
        cliAgent: z.string().optional(),
        skillName: z.string().nullable().optional(),
        maxTokenBudget: z.number().int().positive().nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      const existing = getScheduledTask(ctx.db, id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scheduled task not found" });
      }

      if (data.cronExpression) {
        try {
          new Cron(data.cronExpression).stop();
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid cron expression: "${data.cronExpression}"`,
          });
        }
      }

      updateScheduledTask(ctx.db, id, data);

      // Re-register cron job if expression changed
      if (data.cronExpression && existing.enabled) {
        const engine = getSchedulerEngine();
        engine.removeTask(id);
        engine.addTask(id, data.cronExpression);
      }

      return getScheduledTask(ctx.db, id);
    }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const engine = getSchedulerEngine();
    engine.removeTask(input.id);
    deleteScheduledTask(ctx.db, input.id);
    return { success: true };
  }),

  toggle: publicProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ ctx, input }) => {
      toggleScheduledTask(ctx.db, input.id, input.enabled);

      const engine = getSchedulerEngine();
      const task = getScheduledTask(ctx.db, input.id);
      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scheduled task not found" });
      }

      if (input.enabled) {
        engine.addTask(task.id, task.cronExpression);
      } else {
        engine.removeTask(task.id);
      }

      return task;
    }),

  results: publicProcedure
    .input(z.object({ taskId: z.string(), limit: z.number().int().positive().optional() }))
    .query(({ ctx, input }) => {
      return listScheduledResults(ctx.db, input.taskId, input.limit);
    }),

  runNow: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const task = getScheduledTask(ctx.db, input.id);
    if (!task) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Scheduled task not found" });
    }

    const engine = getSchedulerEngine();
    // Fire and forget — don't await completion (it polls for 5s intervals)
    engine.runNow(input.id).catch((err) => {
      console.error(`[Scheduler] runNow failed for task ${input.id}:`, err);
    });
    return { triggered: true };
  }),
});
