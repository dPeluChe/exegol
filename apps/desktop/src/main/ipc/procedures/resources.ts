import { z } from "zod";
import { getAgentManager } from "../../agents/manager";
import { listAgents } from "../../db/queries";
import { getProjectPorts } from "../../system/ports";
import { getProjectMetrics, getSystemMetrics } from "../../system/resources";
import { publicProcedure, router } from "../trpc";

export const resourcesRouter = router({
  system: publicProcedure.query(() => {
    // Returns cached metrics — no async, no blocking. Collector runs in background.
    return getSystemMetrics();
  }),

  project: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        projectPath: z.string(),
        projectName: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Collect PIDs of running agents for this project
      const manager = getAgentManager();
      const runningIds = manager.listRunning();
      const agents = listAgents(ctx.db, input.projectId);
      const pids: number[] = [];

      for (const agent of agents) {
        if (agent.pid && runningIds.includes(agent.id)) {
          pids.push(agent.pid);
        }
      }

      return getProjectMetrics(input.projectPath, input.projectId, input.projectName, pids);
    }),

  ports: publicProcedure.input(z.object({ projectPath: z.string() })).query(async ({ input }) => {
    return getProjectPorts(input.projectPath);
  }),
});
