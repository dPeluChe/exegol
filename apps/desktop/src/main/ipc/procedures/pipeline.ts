import {
  pipelineRunCreateSchema,
  pipelineTemplateCreateSchema,
  pipelineTemplateUpdateSchema,
} from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createPipelineTemplate,
  deletePipelineRun,
  deletePipelineTemplate,
  getPipelineRun,
  getPipelineTemplate,
  getProject,
  listPipelineRuns,
  listPipelineTemplates,
  updatePipelineTemplate,
} from "../../db/queries";
import { buildRunReport } from "../../pipeline/evidence";
import { checkGitSync } from "../../pipeline/executor";
import { publicProcedure, router } from "../trpc";

export const pipelineRouter = router({
  // ─── Templates ──────────────────────────────────────────────────────────

  listTemplates: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      return listPipelineTemplates(ctx.db, input.projectId);
    }),

  getTemplate: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const tpl = getPipelineTemplate(ctx.db, input.id);
    if (!tpl) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
    return tpl;
  }),

  createTemplate: publicProcedure.input(pipelineTemplateCreateSchema).mutation(({ ctx, input }) => {
    return createPipelineTemplate(ctx.db, input);
  }),

  updateTemplate: publicProcedure
    .input(z.object({ id: z.string() }).merge(pipelineTemplateUpdateSchema))
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      const updated = updatePipelineTemplate(ctx.db, id, data);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      return updated;
    }),

  deleteTemplate: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    deletePipelineTemplate(ctx.db, input.id);
    return { success: true };
  }),

  // ─── Runs ───────────────────────────────────────────────────────────────

  listRuns: publicProcedure.input(z.object({ projectId: z.string() })).query(({ ctx, input }) => {
    return listPipelineRuns(ctx.db, input.projectId);
  }),

  getRun: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const run = getPipelineRun(ctx.db, input.id);
    if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline run not found" });
    return run;
  }),

  startRun: publicProcedure.input(pipelineRunCreateSchema).mutation(async ({ ctx, input }) => {
    const executor = ctx.pipelineExecutor;
    return executor.startRun(
      ctx.db,
      input.templateId,
      input.projectId,
      input.task,
      input.maxIterations,
      input.useWorktree,
    );
  }),

  pauseRun: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const executor = ctx.pipelineExecutor;
    executor.pauseRun(ctx.db, input.id);
    return { success: true };
  }),

  resumeRun: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const executor = ctx.pipelineExecutor;
      await executor.resumeRun(ctx.db, input.id);
      return { success: true };
    }),

  cancelRun: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const executor = ctx.pipelineExecutor;
      await executor.cancelRun(ctx.db, input.id);
      return { success: true };
    }),

  deleteRun: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    deletePipelineRun(ctx.db, input.id);
    return { success: true };
  }),

  /** T130 — markdown run report (evidence bundle), suitable for a PR description */
  exportRunReport: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const run = getPipelineRun(ctx.db, input.id);
    if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Pipeline run not found" });
    const template = getPipelineTemplate(ctx.db, run.templateId);
    return buildRunReport(run, template);
  }),

  /** Check if a project's git repo is synced (no uncommitted changes, no unpushed commits) */
  checkGitSync: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = getProject(ctx.db, input.projectId);
      if (!project) {
        return {
          clean: true,
          uncommittedChanges: false,
          unpushedCommits: 0,
          message: "Project not found",
        };
      }
      return checkGitSync(project.path);
    }),
});
