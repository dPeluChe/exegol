import type { AgentCliType } from "@exegol/shared";
import { agentCreateSchema, agentStatusSchema } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { promoteParallelAgent } from "../../agents/agent-parallel-orchestration";
import {
  formatHandoffForInjection,
  getHandoffByAgent,
  setHandoffSuccessor,
} from "../../agents/handoff";
import { runPreflight } from "../../agents/preflight";
import { coreRust } from "../../agents/spawn-env";
import {
  createAgent,
  getAgent,
  getWorktreeByAgentId,
  listAgents,
  listRecentSessions,
  updateAgentStatus,
} from "../../db/queries";
import {
  createParallelRun,
  enrichParallelRunForComparison,
  getParallelRun,
  listParallelRuns,
  updateParallelRunStatus,
} from "../../db/queries/parallel-runs";
import { publicProcedure, router } from "../trpc";

export const agentRouter = router({
  listProviders: publicProcedure.query(({ ctx }) => {
    return ctx.providerRegistry.list();
  }),

  /** List only enabled providers (for launcher/modal UI — respects Settings toggles) */
  listEnabledProviders: publicProcedure.query(({ ctx }) => {
    return ctx.providerRegistry.list().filter((p) => p.enabled !== false && p.id !== "shell");
  }),

  registerProvider: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        command: z.string().min(1),
        args: z.array(z.string()).default([]),
        env: z.record(z.string()).default({}),
        argsTemplate: z.string().default("{command} {task}"),
        icon: z.string().max(3).default("?"),
        color: z.string().default("#6B7280"),
        capabilities: z
          .object({
            supportsWorktree: z.boolean().default(false),
            supportsResume: z.boolean().default(false),
            resumeFlag: z.string().default(""),
            resumeCommandPattern: z.string().optional(),
            supportsRPC: z.boolean().default(false),
            supportsVision: z.boolean().default(false),
            supportsPromptArg: z.boolean().default(false),
            promptFlag: z.string().default(""),
            pipelineIdleCloseSeconds: z.number().default(0),
          })
          .default({}),
        enabled: z.boolean().default(true),
      }),
    )
    .mutation(({ ctx, input }) => {
      return ctx.providerRegistry.register(ctx.db, input);
    }),

  unregisterProvider: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      const removed = ctx.providerRegistry.unregister(ctx.db, input.id);
      if (!removed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove built-in provider or provider not found",
        });
      }
      return { success: true };
    }),

  updateProviderArgs: publicProcedure
    .input(z.object({ id: z.string(), args: z.array(z.string()) }))
    .mutation(({ ctx, input }) => {
      const registry = ctx.providerRegistry;
      const provider = registry.get(input.id);
      if (!provider) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Provider ${input.id} not found` });
      }
      // Update args in memory and persist
      provider.args = input.args;
      registry.saveCustomToDb(ctx.db);
      return { success: true };
    }),

  toggleProviderEnabled: publicProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ ctx, input }) => {
      const registry = ctx.providerRegistry;
      const provider = registry.get(input.id);
      if (!provider) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Provider ${input.id} not found` });
      }
      provider.enabled = input.enabled;
      registry.saveCustomToDb(ctx.db);
      return { success: true };
    }),

  swapProviders: publicProcedure
    .input(z.object({ idA: z.string(), idB: z.string() }))
    .mutation(({ ctx, input }) => {
      ctx.providerRegistry.swap(ctx.db, input.idA, input.idB);
      return { success: true };
    }),

  resetProviderArgs: publicProcedure.mutation(({ ctx }) => {
    const registry = ctx.providerRegistry;
    for (const p of registry.list()) {
      p.args = [];
    }
    registry.saveCustomToDb(ctx.db);
    return { success: true };
  }),

  recentSessions: publicProcedure
    .input(z.object({ limit: z.number().int().positive().optional() }).optional())
    .query(({ ctx, input }) => {
      return listRecentSessions(ctx.db, input?.limit ?? 10);
    }),

  list: publicProcedure.input(z.object({ projectId: z.string() })).query(({ ctx, input }) => {
    return listAgents(ctx.db, input.projectId);
  }),

  // Returns null (not undefined) for consistency with TanStack Query v5,
  // which treats undefined from queryFn as a protocol error.
  get: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    return getAgent(ctx.db, input.id) ?? null;
  }),

  spawn: publicProcedure.input(agentCreateSchema).mutation(async ({ ctx, input }) => {
    const agent = createAgent(ctx.db, input);
    const manager = ctx.agentManager;

    try {
      await manager.spawn(ctx.db, agent, input);
    } catch (err) {
      updateAgentStatus(ctx.db, agent.id, "failed", String(err));
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to spawn agent: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const spawned = getAgent(ctx.db, agent.id);
    if (!spawned) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Agent ${agent.id} not found after spawn`,
      });
    }
    return spawned;
  }),

  // Idempotent: if the agent is already gone (race with a concurrent close),
  // return success instead of NOT_FOUND so the renderer's double-call
  // cleanup pattern (stop + delete) doesn't spam the console.
  stop: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const agent = getAgent(ctx.db, input.id);
    if (!agent) return null;
    await ctx.agentManager.stop(ctx.db, input.id);
    return getAgent(ctx.db, input.id) ?? agent;
  }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    ctx.db.prepare("DELETE FROM agents WHERE id = ?").run(input.id);
    return { success: true };
  }),

  // Returns null instead of throwing: stale pane references to deleted
  // agents are a recoverable state, not an error.
  getStatus: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const agent = getAgent(ctx.db, input.id);
    if (!agent) return null;
    return {
      status: agent.status,
      currentStep: agent.currentStep,
    };
  }),

  // No-ops silently if the agent was deleted mid-update (e.g., user closed
  // the pane while a push event was in flight).
  updateStatus: publicProcedure
    .input(
      z.object({
        id: z.string(),
        status: agentStatusSchema,
        currentStep: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const agent = getAgent(ctx.db, input.id);
      if (!agent) return null;
      updateAgentStatus(ctx.db, input.id, input.status, input.currentStep);
      return getAgent(ctx.db, input.id) ?? null;
    }),

  /** T106 — Resolve the on-disk worktree path for an agent (for "View diff"). */
  getWorktreePath: publicProcedure
    .input(z.object({ agentId: z.string() }))
    .query(({ ctx, input }) => {
      const wt = getWorktreeByAgentId(ctx.db, input.agentId);
      return wt?.path ?? null;
    }),

  // ─── Handoff ────────────────────────────────────────────────────────────

  getHandoff: publicProcedure.input(z.object({ agentId: z.string() })).query(({ ctx, input }) => {
    return getHandoffByAgent(ctx.db, input.agentId);
  }),

  continueWithHandoff: publicProcedure
    .input(
      z.object({
        agentId: z.string(),
        cliType: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const originalAgent = getAgent(ctx.db, input.agentId);
      if (!originalAgent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Original agent not found" });
      }

      const handoff = getHandoffByAgent(ctx.db, input.agentId);
      if (!handoff) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No handoff found for this agent" });
      }

      // Build successor task description with handoff context
      const handoffContext = formatHandoffForInjection(handoff);
      const cliType = input.cliType ?? originalAgent.cliType;

      const successor = createAgent(ctx.db, {
        projectId: originalAgent.projectId,
        cliType: cliType as Parameters<typeof createAgent>[1]["cliType"],
        taskDescription: handoffContext,
      });

      // Link handoff to successor
      setHandoffSuccessor(ctx.db, handoff.id, successor.id);

      // Spawn the successor — reuse existing worktree if preserved
      const manager = ctx.agentManager;
      const existingWt = originalAgent.worktreeId
        ? getWorktreeByAgentId(ctx.db, originalAgent.id)
        : null;
      try {
        await manager.spawn(ctx.db, successor, {
          projectId: originalAgent.projectId,
          cliType: successor.cliType,
          taskDescription: handoffContext,
          // Reuse preserved worktree path instead of creating a new one
          cwdOverride: existingWt?.path,
          useWorktree: !existingWt && originalAgent.worktreeId != null,
          branchName: originalAgent.branchName ?? undefined,
        });
      } catch (err) {
        updateAgentStatus(ctx.db, successor.id, "failed", String(err));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to spawn successor: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      const spawned = getAgent(ctx.db, successor.id);
      if (!spawned) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Successor not found after spawn" });
      }
      return spawned;
    }),

  // ─── T65: Parallel Multi-Agent ────────────────────────────────────────

  spawnParallel: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        taskDescription: z.string().min(1),
        /** CLI types for each parallel variant (e.g. ["claude-code", "gemini", "codex"]) */
        cliTypes: z.array(z.string().min(1)).min(2).max(5),
        /** Use isolated worktrees for each variant */
        useWorktree: z.boolean().default(true),
        branchPrefix: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const manager = ctx.agentManager;
      const agentIds: string[] = [];
      const errors: string[] = [];

      // Spawn each variant in parallel
      const spawnPromises = input.cliTypes.map(async (cliType, index) => {
        const branchName = input.branchPrefix
          ? `${input.branchPrefix}-v${index + 1}`
          : `exegol/parallel-v${index + 1}`;
        const agent = createAgent(ctx.db, {
          projectId: input.projectId,
          cliType: cliType as AgentCliType,
          taskDescription: input.taskDescription,
        });
        agentIds.push(agent.id);
        try {
          await manager.spawn(ctx.db, agent, {
            projectId: input.projectId,
            cliType: cliType as AgentCliType,
            taskDescription: input.taskDescription,
            useWorktree: input.useWorktree,
            branchName,
          });
        } catch (err) {
          updateAgentStatus(ctx.db, agent.id, "failed", String(err));
          errors.push(`${cliType}: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      await Promise.all(spawnPromises);

      if (agentIds.length === 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `All parallel spawns failed: ${errors.join("; ")}`,
        });
      }

      // Create the parallel run record
      const run = createParallelRun(ctx.db, {
        projectId: input.projectId,
        taskDescription: input.taskDescription,
        cliTypes: input.cliTypes,
        agentIds,
      });

      // Link agents to the parallel run
      for (const agentId of agentIds) {
        ctx.db.prepare("UPDATE agents SET parallel_run_id = ? WHERE id = ?").run(run.id, agentId);
      }

      return { run, agentIds, errors };
    }),

  listParallelRuns: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      return listParallelRuns(ctx.db, input.projectId);
    }),

  getParallelRun: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    return getParallelRun(ctx.db, input.id) ?? null;
  }),

  /** T107 — enriched comparator payload: single round-trip, server-side N work. */
  getParallelRunDetails: publicProcedure
    .input(z.object({ runId: z.string() }))
    .query(({ ctx, input }) => {
      const run = getParallelRun(ctx.db, input.runId);
      if (!run) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Parallel run ${input.runId} not found`,
        });
      }
      return enrichParallelRunForComparison(ctx.db, run);
    }),

  promoteParallelAgent: publicProcedure
    .input(z.object({ runId: z.string(), agentId: z.string() }))
    .mutation(({ ctx, input }) => {
      promoteParallelAgent(ctx.db, input.runId, input.agentId);
      return { success: true };
    }),

  cancelParallelRun: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const run = getParallelRun(ctx.db, input.id);
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      const manager = ctx.agentManager;
      // Stop all running agents in the group
      for (const agentId of run.agentIds) {
        const agent = getAgent(ctx.db, agentId);
        if (agent && ["running", "spawning", "waiting_input"].includes(agent.status)) {
          await manager.stop(ctx.db, agentId);
        }
      }
      updateParallelRunStatus(ctx.db, input.id, "cancelled");
      return { success: true };
    }),

  /** T104 — Run preflight checks before spawning an agent.
   *  Returns errors (blocking) and warnings (non-blocking) without side effects. */
  preflight: publicProcedure
    .input(
      z.object({
        cliType: z.string(),
        projectId: z.string(),
        useWorktree: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const provider = ctx.providerRegistry.get(input.cliType);
      if (!provider) {
        return {
          ok: false,
          errors: [{ code: "UNKNOWN_CLI", message: `Unknown CLI type: ${input.cliType}` }],
          warnings: [],
        };
      }
      const project = ctx.db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as { path: string } | undefined;
      if (!project) {
        return {
          ok: false,
          errors: [{ code: "PROJECT_NOT_FOUND", message: "Project not found" }],
          warnings: [],
        };
      }
      return runPreflight(ctx.db, {
        cliType: input.cliType as Parameters<typeof runPreflight>[1]["cliType"],
        command: provider.command,
        projectPath: project.path,
        useWorktree: input.useWorktree,
        coreRustLoaded: !!coreRust,
      });
    }),
});
