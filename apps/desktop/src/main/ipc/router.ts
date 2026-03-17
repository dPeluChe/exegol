import { router } from './trpc'
import { projectRouter } from './procedures/projects'
import { agentRouter } from './procedures/agents'
import { settingsRouter } from './procedures/settings'
import { tokenUsageRouter } from './procedures/token-usage'

export const appRouter = router({
  projects: projectRouter,
  agents: agentRouter,
  settings: settingsRouter,
  tokenUsage: tokenUsageRouter,
})

export type AppRouter = typeof appRouter
