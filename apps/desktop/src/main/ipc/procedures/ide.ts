import { type DetectedIde, IDE_IDS, IDE_INFO } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getProject, setProjectIde } from "../../db/queries/projects";
import { detectIdes } from "../../ide/detect";
import { publicProcedure, router } from "../trpc";

/** Installed first, each group in catalog order */
export function sortIdes(installed: Set<string>): DetectedIde[] {
  const all = IDE_INFO.map((i) => ({ ...i, installed: installed.has(i.id) }));
  return [...all.filter((i) => i.installed), ...all.filter((i) => !i.installed)];
}

export const ideRouter = router({
  list: publicProcedure
    .input(z.object({ fresh: z.boolean().optional() }).optional())
    .query(async ({ input }) => sortIdes(new Set((await detectIdes(input?.fresh)).keys()))),

  projectIde: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => getProject(ctx.db, input.projectId)?.ide ?? null),

  setProjectIde: publicProcedure
    .input(z.object({ projectId: z.string(), ide: z.enum(IDE_IDS).nullable() }))
    .mutation(({ ctx, input }) => {
      if (!getProject(ctx.db, input.projectId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      setProjectIde(ctx.db, input.projectId, input.ide);
      return { success: true };
    }),
});
