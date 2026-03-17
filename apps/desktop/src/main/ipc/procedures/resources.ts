import { z } from "zod";
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
    .query(async ({ input }) => {
      return getProjectMetrics(input.projectPath, input.projectId, input.projectName);
    }),

  ports: publicProcedure.input(z.object({ projectPath: z.string() })).query(async ({ input }) => {
    return getProjectPorts(input.projectPath);
  }),
});
