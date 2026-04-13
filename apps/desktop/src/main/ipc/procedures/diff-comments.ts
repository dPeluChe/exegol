import { z } from "zod";
import {
  createDiffComment,
  deleteDiffComment,
  listDiffComments,
  toggleResolveDiffComment,
} from "../../db/queries";
import { publicProcedure, router } from "../trpc";

export const diffCommentsRouter = router({
  list: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        filePath: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) => {
      return listDiffComments(ctx.db, input.projectId, input.filePath);
    }),

  add: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        agentId: z.string().nullable().optional(),
        filePath: z.string(),
        lineNumber: z.number().int(),
        hunkIndex: z.number().int().nullable().optional(),
        content: z.string().min(1).max(5000),
      }),
    )
    .mutation(({ ctx, input }) => {
      return createDiffComment(ctx.db, input);
    }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    deleteDiffComment(ctx.db, input.id);
    return { success: true };
  }),

  toggleResolve: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    toggleResolveDiffComment(ctx.db, input.id);
    return { success: true };
  }),
});
