import { activitiesRouter } from "./procedures/activities";
import { agentRouter } from "./procedures/agents";
import { apiKeysRouter } from "./procedures/apikeys";
import { diffRouter } from "./procedures/diff";
import { diffCommentsRouter } from "./procedures/diff-comments";
import { doctorRouter } from "./procedures/doctor";
import { filesRouter } from "./procedures/files";
import { fsSearchRouter } from "./procedures/fs-search";
import { githubRouter } from "./procedures/github";
import { indexerRouter } from "./procedures/indexer";
import { knowledgeRouter } from "./procedures/knowledge";
import { mcpRouter } from "./procedures/mcp";
import { memoryRouter } from "./procedures/memory";
import { messagesRouter } from "./procedures/messages";
import { oplogRouter } from "./procedures/oplog";
import { pipelineRouter } from "./procedures/pipeline";
import { projectRouter } from "./procedures/projects";
import { promptsRouter } from "./procedures/prompts";
import { qaTestRouter } from "./procedures/qa-tests";
import { queueRouter } from "./procedures/queue";
import { resourcesRouter } from "./procedures/resources";
import { schedulerRouter } from "./procedures/scheduler";
import { scoringRouter } from "./procedures/scoring";
import { scrollbackRouter } from "./procedures/scrollback";
import { searchRouter } from "./procedures/search";
import { settingsRouter } from "./procedures/settings";
import { skillInstallerRouter } from "./procedures/skill-installer";
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
  diffComments: diffCommentsRouter,
  scrollback: scrollbackRouter,
  scoring: scoringRouter,
  oplog: oplogRouter,
  pipeline: pipelineRouter,
  skills: skillsRouter,
  skillInstaller: skillInstallerRouter,
  mcp: mcpRouter,
  memory: memoryRouter,
  messages: messagesRouter,
  queue: queueRouter,
  qaTests: qaTestRouter,
  activities: activitiesRouter,
  search: searchRouter,
  fsSearch: fsSearchRouter,
  github: githubRouter,
  indexer: indexerRouter,
  knowledge: knowledgeRouter,
  doctor: doctorRouter,
});

export type AppRouter = typeof appRouter;
