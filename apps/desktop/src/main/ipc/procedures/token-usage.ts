import { z } from 'zod'
import { getTokenUsageSummary, getProjectTokenUsageSummary, getProjectTokenUsage } from '../../db/queries'
import { router, publicProcedure } from '../trpc'

export const tokenUsageRouter = router({
  summary: publicProcedure
    .input(
      z
        .object({
          agentId: z.string().optional(),
          projectId: z.string().optional(),
        })
        .optional()
    )
    .query(({ ctx, input }) => {
      const since = Math.floor(Date.now() / 1000) - 86400

      if (input?.agentId) {
        return getTokenUsageSummary(ctx.db, input.agentId, since)
      }

      if (input?.projectId) {
        return getProjectTokenUsageSummary(ctx.db, input.projectId, since)
      }

      // Fallback: empty agent id (legacy behavior)
      return getTokenUsageSummary(ctx.db, '', since)
    }),
})
