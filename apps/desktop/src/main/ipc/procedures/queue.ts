import { z } from "zod";
// Queue queries - imported from T34 implementation
import {
  addToQueue,
  cancelQueueTask,
  getQueueTask,
  listQueueTasks,
  updateQueueTaskStatus,
} from "../../db/queries/queue";
import { publicProcedure, router } from "../trpc";

export const queueRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().optional(),
          status: z.string().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      return listQueueTasks(ctx.db, input?.projectId, input?.status);
    }),

  get: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    return getQueueTask(ctx.db, input.id);
  }),

  add: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        prompt: z.string().min(1),
        cliType: z.string().default("claude-code"),
        priority: z.number().int().default(0),
        dependsOn: z.string().nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return addToQueue(ctx.db, input);
    }),

  cancel: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    cancelQueueTask(ctx.db, input.id);
    return { success: true };
  }),

  updateStatus: publicProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.string(),
        agentId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      updateQueueTaskStatus(ctx.db, input.id, input.status, input.agentId);
      return { success: true };
    }),
});
