import { z } from "zod";
import {
  getProjectTokenUsage,
  getProjectTokenUsageSummary,
  getTokenUsageSummary,
  recordTokenUsage,
} from "../../db/queries";
import { scanAllLogs } from "../../tokens/log-parser";
import { publicProcedure, router } from "../trpc";

export const tokenUsageRouter = router({
  summary: publicProcedure
    .input(
      z
        .object({
          agentId: z.string().optional(),
          projectId: z.string().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      const since = Math.floor(Date.now() / 1000) - 86400;

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
    .mutation(({ ctx, input }) => {
      const since = Math.floor(Date.now() / 1000) - 30 * 86400; // Last 30 days
      const entries = scanAllLogs(since);

      let imported = 0;
      for (const entry of entries) {
        recordTokenUsage(ctx.db, {
          agentId: input?.projectId ? `scan:${input.projectId}` : "external",
          provider: entry.provider,
          model: entry.model,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          estimatedCostUsd: entry.estimatedCostUsd,
          toolCallCount: entry.toolCallCount,
        });
        imported++;
      }

      return { imported, total: entries.length };
    }),

  /** Get raw token usage records for a project (last N days) */
  history: publicProcedure
    .input(z.object({ projectId: z.string(), days: z.number().default(30) }))
    .query(({ ctx, input }) => {
      return getProjectTokenUsage(ctx.db, input.projectId, input.days);
    }),
});
