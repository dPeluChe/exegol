import { activitiesRouter } from "./procedures/activities";
import { agentRouter } from "./procedures/agents";
import { apiKeysRouter } from "./procedures/apikeys";
import { diffRouter } from "./procedures/diff";
import { filesRouter } from "./procedures/files";
import { mcpRouter } from "./procedures/mcp";
import { memoryRouter } from "./procedures/memory";
import { messagesRouter } from "./procedures/messages";
import { oplogRouter } from "./procedures/oplog";
import { projectRouter } from "./procedures/projects";
import { promptsRouter } from "./procedures/prompts";
import { queueRouter } from "./procedures/queue";
import { resourcesRouter } from "./procedures/resources";
import { schedulerRouter } from "./procedures/scheduler";
import { scoringRouter } from "./procedures/scoring";
import { scrollbackRouter } from "./procedures/scrollback";
import { searchRouter } from "./procedures/search";
import { settingsRouter } from "./procedures/settings";
import { skillsRouter } from "./procedures/skills";
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
  scoring: scoringRouter,
  oplog: oplogRouter,
  skills: skillsRouter,
  mcp: mcpRouter,
  memory: memoryRouter,
  messages: messagesRouter,
  queue: queueRouter,
  activities: activitiesRouter,
  search: searchRouter,
});

export type AppRouter = typeof appRouter;
