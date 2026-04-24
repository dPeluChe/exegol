import { z } from "zod";
import { listAgents } from "../../db/queries";
import { detectPortConflicts, getProjectPorts } from "../../system/ports";
import { getMetricsHistory, getProjectMetrics, getSystemMetrics } from "../../system/resources";
import { detectProjectScripts } from "../../system/scripts";
import type { Context } from "../context";
import { publicProcedure, router } from "../trpc";

// ─── Preferred Ports (per-project, stored in settings table) ──────────────

function getPreferredPorts(db: Context["db"]): Record<string, number> {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'project_preferred_ports'")
    .get() as { value: string } | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.value) as Record<string, number>;
  } catch {
    return {};
  }
}

export const resourcesRouter = router({
  system: publicProcedure.query(() => {
    // Returns cached metrics — no async, no blocking. Collector runs in background.
    return getSystemMetrics();
  }),

  /** Last 30 metrics snapshots for sparkline charts */
  history: publicProcedure.query(() => {
    return getMetricsHistory();
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
      const manager = ctx.agentManager;
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

  /** T07: detect ports with multiple listeners (conflict warning) */
  portConflicts: publicProcedure.query(async () => {
    const conflicts = await detectPortConflicts();
    const result: Record<number, string[]> = {};
    for (const [port, procs] of conflicts) {
      result[port] = procs;
    }
    return result;
  }),

  /** Preferred port per project */
  preferredPort: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      const ports = getPreferredPorts(ctx.db);
      return ports[input.projectId] ?? null;
    }),

  setPreferredPort: publicProcedure
    .input(z.object({ projectId: z.string(), port: z.number() }))
    .mutation(({ ctx, input }) => {
      const current = getPreferredPorts(ctx.db);
      current[input.projectId] = input.port;
      ctx.db
        .prepare(
          `INSERT INTO settings (key, value) VALUES ('project_preferred_ports', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(JSON.stringify(current));
      return input.port;
    }),

  /** Detected dev scripts for a project */
  scripts: publicProcedure
    .input(z.object({ projectPath: z.string() }))
    .query(async ({ input }) => detectProjectScripts(input.projectPath)),
});
