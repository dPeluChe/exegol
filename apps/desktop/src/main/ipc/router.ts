import { agentRouter } from "./procedures/agents";
import { apiKeysRouter } from "./procedures/apikeys";
import { filesRouter } from "./procedures/files";
import { projectRouter } from "./procedures/projects";
import { promptsRouter } from "./procedures/prompts";
import { resourcesRouter } from "./procedures/resources";
import { schedulerRouter } from "./procedures/scheduler";
import { settingsRouter } from "./procedures/settings";
import { tokenUsageRouter } from "./procedures/token-usage";
import { router } from "./trpc";

export const appRouter = router({
  projects: projectRouter,
  agents: agentRouter,
  settings: settingsRouter,
  tokenUsage: tokenUsageRouter,
  resources: resourcesRouter,
  apiKeys: apiKeysRouter,
  scheduler: schedulerRouter,
  files: filesRouter,
  prompts: promptsRouter,
});

export type AppRouter = typeof appRouter;
