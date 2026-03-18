import { agentCreateSchema, agentStatusSchema } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  formatHandoffForInjection,
  getHandoffByAgent,
  setHandoffSuccessor,
} from "../../agents/handoff";
import { getAgentManager } from "../../agents/manager";
import { getProviderRegistry } from "../../agents/registry";
import {
  createAgent,
  getAgent,
  listAgents,
  listRecentSessions,
  updateAgentStatus,
} from "../../db/queries";
import { publicProcedure, router } from "../trpc";

export const agentRouter = router({
  listProviders: publicProcedure.query(() => {
    return getProviderRegistry().list();
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
            supportsRPC: z.boolean().default(false),
            supportsVision: z.boolean().default(false),
          })
          .default({}),
      }),
    )
    .mutation(({ ctx, input }) => {
      return getProviderRegistry().register(ctx.db, input);
    }),

  unregisterProvider: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      const removed = getProviderRegistry().unregister(ctx.db, input.id);
      if (!removed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove built-in provider or provider not found",
        });
      }
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

  get: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const agent = getAgent(ctx.db, input.id);
    if (!agent) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Agent ${input.id} not found` });
    }
    return agent;
  }),

  spawn: publicProcedure.input(agentCreateSchema).mutation(async ({ ctx, input }) => {
    const agent = createAgent(ctx.db, input);
    const manager = getAgentManager();

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

  stop: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const agent = getAgent(ctx.db, input.id);
    if (!agent) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Agent ${input.id} not found` });
    }

    const manager = getAgentManager();
    await manager.stop(ctx.db, input.id);
    const stopped = getAgent(ctx.db, input.id);
    if (!stopped) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Agent ${input.id} not found after stop` });
    }
    return stopped;
  }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    ctx.db.prepare("DELETE FROM agents WHERE id = ?").run(input.id);
    return { success: true };
  }),

  getStatus: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const agent = getAgent(ctx.db, input.id);
    if (!agent) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Agent ${input.id} not found` });
    }
    return {
      status: agent.status,
      currentStep: agent.currentStep,
    };
  }),

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
      if (!agent) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Agent ${input.id} not found` });
      }
      updateAgentStatus(ctx.db, input.id, input.status, input.currentStep);
      const updated = getAgent(ctx.db, input.id);
      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Agent ${input.id} not found after update`,
        });
      }
      return updated;
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

      // Spawn the successor
      const manager = getAgentManager();
      try {
        await manager.spawn(ctx.db, successor, {
          projectId: originalAgent.projectId,
          cliType: successor.cliType,
          taskDescription: handoffContext,
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
});
