import { projectGroupCreateSchema } from "@exegol/shared";
import { z } from "zod";
import {
  createProjectGroup,
  deleteProjectGroup,
  listProjectGroups,
  renameProjectGroup,
  reorderProjectGroups,
  setProjectGroupCollapsed,
  updateProjectGroupAppearance,
} from "../../db/queries";
import { publicProcedure, router } from "../trpc";

export const projectGroupsRouter = router({
  list: publicProcedure.query(({ ctx }) => listProjectGroups(ctx.db)),

  create: publicProcedure.input(projectGroupCreateSchema).mutation(({ ctx, input }) => {
    return createProjectGroup(ctx.db, input);
  }),

  rename: publicProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      renameProjectGroup(ctx.db, input.id, input.name);
      return { success: true };
    }),

  setAppearance: publicProcedure
    .input(
      z.object({
        id: z.string(),
        color: z.string().nullable(),
        icon: z.string().nullable(),
        background: z.string().nullable(),
      }),
    )
    .mutation(({ ctx, input }) => {
      updateProjectGroupAppearance(ctx.db, input.id, {
        color: input.color,
        icon: input.icon,
        background: input.background,
      });
      return { success: true };
    }),

  setCollapsed: publicProcedure
    .input(z.object({ id: z.string(), collapsed: z.boolean() }))
    .mutation(({ ctx, input }) => {
      setProjectGroupCollapsed(ctx.db, input.id, input.collapsed);
      return { success: true };
    }),

  reorder: publicProcedure
    .input(z.object({ orderedIds: z.array(z.string()) }))
    .mutation(({ ctx, input }) => {
      reorderProjectGroups(ctx.db, input.orderedIds);
      return { success: true };
    }),

  /** Disband: deletes the group, member projects fall back to root via ON DELETE SET NULL. */
  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    deleteProjectGroup(ctx.db, input.id);
    return { success: true };
  }),
});
