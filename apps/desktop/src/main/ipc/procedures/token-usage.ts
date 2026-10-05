import { z } from "zod";
import {
  getAgentCosts,
  getDailyTrend,
  getModelBreakdown,
  getPipelineRunCost,
  getProject,
  getProjectTokenUsage,
  getProjectTokenUsageSummary,
  getTokenUsageSummary,
  importScannedTokenUsage,
} from "../../db/queries";
import { isInside } from "../../system/ports";
import { scanAllLogs } from "../../tokens/log-parser";
import { publicProcedure, router } from "../trpc";

export const tokenUsageRouter = router({
  summary: publicProcedure
    .input(
      z
        .object({
          agentId: z.string().optional(),
          projectId: z.string().optional(),
          /** The Tokens section's range; the cards said "Last 30 days" over 24h of data */
          days: z.number().int().min(1).max(365).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      const since = Math.floor(Date.now() / 1000) - 86400 * (input?.days ?? 1);

      if (input?.agentId) {
        return getTokenUsageSummary(ctx.db, input.agentId, since);
      }

      if (input?.projectId) {
        return getProjectTokenUsageSummary(ctx.db, input.projectId, since);
      }

      // Fallback: empty agent id (legacy behavior)
      return getTokenUsageSummary(ctx.db, "", since);
    }),

  /** Scan local CLI logs and import token usage into the database */
  scan: publicProcedure
    .input(z.object({ projectId: z.string() }).optional())
    .mutation(async ({ ctx, input }) => {
      const since = Math.floor(Date.now() / 1000) - 30 * 86400; // Last 30 days
      const { entries: scanned } = await scanAllLogs(since);
      const agentId = input?.projectId ? `scan:${input.projectId}` : "external";
      const project = input?.projectId ? getProject(ctx.db, input.projectId) : null;
      // Claude logs cover every project on the machine: keep the ones run inside this one
      const entries = project
        ? scanned.filter((e) => !e.cwd || isInside(e.cwd, project.path))
        : scanned;
      const { imported, skipped } = importScannedTokenUsage(ctx.db, agentId, entries);
      return { imported, skipped, total: entries.length };
    }),

  /** Get raw token usage records for a project (last N days) */
  history: publicProcedure
    .input(z.object({ projectId: z.string(), days: z.number().default(30) }))
    .query(({ ctx, input }) => {
      return getProjectTokenUsage(ctx.db, input.projectId, input.days);
    }),

  /** T19: Per-model breakdown */
  modelBreakdown: publicProcedure
    .input(z.object({ projectId: z.string(), days: z.number().default(30) }))
    .query(({ ctx, input }) => {
      return getModelBreakdown(ctx.db, input.projectId, input.days);
    }),

  /** T19: Per-agent cost table */
  agentCosts: publicProcedure
    .input(z.object({ projectId: z.string(), days: z.number().default(30) }))
    .query(({ ctx, input }) => {
      return getAgentCosts(ctx.db, input.projectId, input.days);
    }),

  /** T19: Daily cost trend */
  dailyTrend: publicProcedure
    .input(z.object({ projectId: z.string(), days: z.number().default(30) }))
    .query(({ ctx, input }) => {
      return getDailyTrend(ctx.db, input.projectId, input.days);
    }),

  /**
   * T147: cost per pipeline step, joining step_results.agentId against
   * token_usage. Backend-only for now — T130 (Pipeline Evidence, WT-C) owns
   * the run-view UI; this just makes the data available once that lands.
   */
  pipelineRunCost: publicProcedure
    .input(z.object({ pipelineRunId: z.string() }))
    .query(({ ctx, input }) => {
      return getPipelineRunCost(ctx.db, input.pipelineRunId);
    }),
});
