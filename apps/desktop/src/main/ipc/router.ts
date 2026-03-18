import { agentRouter } from "./procedures/agents";
import { apiKeysRouter } from "./procedures/apikeys";
import { diffRouter } from "./procedures/diff";
import { filesRouter } from "./procedures/files";
import { messagesRouter } from "./procedures/messages";
import { projectRouter } from "./procedures/projects";
import { promptsRouter } from "./procedures/prompts";
import { queueRouter } from "./procedures/queue";
import { resourcesRouter } from "./procedures/resources";
import { schedulerRouter } from "./procedures/scheduler";
import { scrollbackRouter } from "./procedures/scrollback";
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
  diff: diffRouter,
  scrollback: scrollbackRouter,
  messages: messagesRouter,
  queue: queueRouter,
});

export type AppRouter = typeof appRouter;
