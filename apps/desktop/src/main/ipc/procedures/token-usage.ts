import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getAllTokenUsageSummary,
  getPipelineRunCost,
  getProject,
  importScannedTokenUsage,
  listUsageRows,
  listWorktrees,
  usageSessionLabels,
} from "../../db/queries";
import { getJsonSetting } from "../../db/queries/settings";
import { scanAllLogs } from "../../tokens/log-parser";
import { aggregateUsage } from "../../tokens/usage-aggregation";
import { onUsageChanged, USAGE_IMPORT_KEY, type UsageImportState } from "../../tokens/usage-import";
import { checkUsageLimits, setUsageLimit, usageLimitRows } from "../../tokens/usage-limits";
import { publicProcedure, router } from "../trpc";

export const tokenUsageRouter = router({
  /** Since a unix second, all projects (the status bar's "today") */
  summary: publicProcedure
    .input(z.object({ since: z.number().int().min(0) }))
    .query(({ ctx, input }) => getAllTokenUsageSummary(ctx.db, input.since)),

  /** Scan local CLI logs and import token usage into the database */
  scan: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const project = getProject(ctx.db, input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      const since = Math.floor(Date.now() / 1000) - 30 * 86400; // Last 30 days
      // CLI logs cover every project on the machine: keep sessions run in this one or its worktrees
      const roots = [project.path, ...listWorktrees(ctx.db, project.id).map((w) => w.path)];
      const { entries } = await scanAllLogs(since, undefined, roots);
      const { imported, skipped } = await importScannedTokenUsage(
        ctx.db,
        entries,
        () => project.id,
      );
      if (imported > 0) onUsageChanged(ctx.db);
      return { imported, skipped, total: entries.length };
    }),

  /** App-wide usage over [since, until) (unix seconds), filled by the background import */
  usage: publicProcedure
    .input(
      z
        .object({
          since: z.number().int().min(0).optional(),
          until: z.number().int().min(0).optional(),
          days: z.number().int().min(1).max(365).optional(),
          projectId: z.string().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      const until = input?.until ?? Math.floor(Date.now() / 1000) + 1;
      const since = input?.since ?? until - 86400 * (input?.days ?? 30);
      const last = getJsonSetting<UsageImportState | null>(ctx.db, USAGE_IMPORT_KEY, null);
      const rows = listUsageRows(ctx.db, since, until, input?.projectId);
      const report = aggregateUsage(rows, { since, until });
      const labels = usageSessionLabels(
        ctx.db,
        report.bySession.map((s) => s.session),
      );
      return {
        ...report,
        bySession: report.bySession.map((s) => ({ ...s, label: labels.get(s.session) })),
        lastImportAt: last?.at ?? null,
      };
    }),

  limits: publicProcedure.query(({ ctx }) => usageLimitRows(ctx.db)),

  setLimit: publicProcedure
    .input(z.object({ cli: z.string().min(1), limitUsd: z.number().positive().nullable() }))
    .mutation(({ ctx, input }) => {
      setUsageLimit(ctx.db, input.cli, input.limitUsd);
      if (input.limitUsd !== null) checkUsageLimits(ctx.db);
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
