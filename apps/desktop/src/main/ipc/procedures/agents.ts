import { agentCreateSchema, agentStatusSchema } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getAgentManager } from "../../agents/manager";
import {
  createAgent,
  getAgent,
  listAgents,
  listRecentSessions,
  updateAgentStatus,
} from "../../db/queries";
import { publicProcedure, router } from "../trpc";

export const agentRouter = router({
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
});
