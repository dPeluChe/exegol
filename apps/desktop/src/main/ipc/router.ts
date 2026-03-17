import { agentRouter } from "./procedures/agents";
import { projectRouter } from "./procedures/projects";
import { resourcesRouter } from "./procedures/resources";
import { settingsRouter } from "./procedures/settings";
import { tokenUsageRouter } from "./procedures/token-usage";
import { router } from "./trpc";

export const appRouter = router({
  projects: projectRouter,
  agents: agentRouter,
  settings: settingsRouter,
  tokenUsage: tokenUsageRouter,
  resources: resourcesRouter,
});

export type AppRouter = typeof appRouter;
