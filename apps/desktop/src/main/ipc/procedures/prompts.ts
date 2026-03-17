import { z } from "zod";
import {
  createPrompt,
  deletePrompt,
  listPrompts,
  togglePinPrompt,
  updatePrompt,
} from "../../db/queries";
import { publicProcedure, router } from "../trpc";

const categoryEnum = z.enum(["task", "review", "debug", "custom"]);

export const promptsRouter = router({
  list: publicProcedure.input(z.object({ projectId: z.string() })).query(({ ctx, input }) => {
    return listPrompts(ctx.db, input.projectId);
  }),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        title: z.string().min(1),
        content: z.string().min(1),
        category: categoryEnum,
      }),
    )
    .mutation(({ ctx, input }) => {
      return createPrompt(ctx.db, input);
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).optional(),
        content: z.string().min(1).optional(),
        category: categoryEnum.optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      updatePrompt(ctx.db, id, data);
      return { success: true };
    }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    deletePrompt(ctx.db, input.id);
    return { success: true };
  }),

  togglePin: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    togglePinPrompt(ctx.db, input.id);
    return { success: true };
  }),
});
