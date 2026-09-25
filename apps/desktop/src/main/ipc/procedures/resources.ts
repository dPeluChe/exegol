import { z } from "zod";
import { getProject, listAgents } from "../../db/queries";
import { killDevServer, listDevServers } from "../../system/dev-servers";
import { getProjectPorts } from "../../system/ports";
import {
  getMetricsHistory,
  getProjectMetrics,
  getSidecarMemoryMetrics,
  getSystemMetrics,
} from "../../system/resources";
import { detectRunTargets } from "../../system/scripts";
import type { Context } from "../context";
import { publicProcedure, router } from "../trpc";

// ─── Preferred Ports (per-project, stored in settings table) ──────────────

const RUN_PINS_KEY = "project_run_pins";

function readJsonSetting<T>(db: Context["db"], key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

function getPreferredPorts(db: Context["db"]): Record<string, number> {
  return readJsonSetting<Record<string, number>>(db, "project_preferred_ports", {});
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

  /** Every port the user's processes listen on, with project and Exegol terminal */
  devServers: publicProcedure.query(({ ctx }) => listDevServers(ctx.db)),

  killDevServer: publicProcedure
    .input(z.object({ pid: z.number().int().positive() }))
    .mutation(({ ctx, input }) => killDevServer(ctx.db, input.pid)),

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
  /** T197: project root + subfolders (nested repos, packages) and what each can run */
  runTargets: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = getProject(ctx.db, input.projectId);
      return project ? detectRunTargets(project.path) : [];
    }),

  /** Pinned run commands per project, as "rel\u0000command" keys */
  runPins: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(
      ({ ctx, input }) =>
        readJsonSetting<Record<string, string[]>>(ctx.db, RUN_PINS_KEY, {})[input.projectId] ?? [],
    ),

  toggleRunPin: publicProcedure
    .input(z.object({ projectId: z.string(), key: z.string().max(2000) }))
    .mutation(({ ctx, input }) => {
      const all = readJsonSetting<Record<string, string[]>>(ctx.db, RUN_PINS_KEY, {});
      const pins = all[input.projectId] ?? [];
      all[input.projectId] = pins.includes(input.key)
        ? pins.filter((k) => k !== input.key)
        : [...pins, input.key];
      ctx.db
        .prepare(
          "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(RUN_PINS_KEY, JSON.stringify(all));
      return all[input.projectId];
    }),

  /** T143: per-session PTY ring buffer memory usage + PTY count */
  sidecarMemory: publicProcedure.query(async () => getSidecarMemoryMetrics()),
});
