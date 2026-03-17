import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { getSystemMetrics, getProjectMetrics } from '../../system/resources'

export const resourcesRouter = router({
  system: publicProcedure.query(async () => {
    return getSystemMetrics()
  }),

  project: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        projectPath: z.string(),
        projectName: z.string(),
      })
    )
    .query(async ({ input }) => {
      return getProjectMetrics(input.projectPath, input.projectId, input.projectName)
    }),
})
