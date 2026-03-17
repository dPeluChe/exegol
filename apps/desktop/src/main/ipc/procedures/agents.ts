import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import {
  listAgents,
  getAgent,
  createAgent,
  updateAgentStatus,
  stopAgent,
} from '../../db/queries'
import { agentCreateSchema, agentStatusSchema } from '@exegol/shared'
import { getAgentManager } from '../../agents/manager'
import { router, publicProcedure } from '../trpc'

export const agentRouter = router({
  list: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      return listAgents(ctx.db, input.projectId)
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => {
      const agent = getAgent(ctx.db, input.id)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Agent ${input.id} not found` })
      }
      return agent
    }),

  spawn: publicProcedure.input(agentCreateSchema).mutation(async ({ ctx, input }) => {
    const agent = createAgent(ctx.db, input)
    const manager = getAgentManager()

    try {
      await manager.spawn(ctx.db, agent, input)
    } catch (err) {
      updateAgentStatus(ctx.db, agent.id, 'failed', String(err))
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to spawn agent: ${err instanceof Error ? err.message : String(err)}`,
      })
    }

    return getAgent(ctx.db, agent.id)!
  }),

  stop: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const agent = getAgent(ctx.db, input.id)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Agent ${input.id} not found` })
      }

      const manager = getAgentManager()
      await manager.stop(ctx.db, input.id)
      return getAgent(ctx.db, input.id)!
    }),

  getStatus: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => {
      const agent = getAgent(ctx.db, input.id)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Agent ${input.id} not found` })
      }
      return {
        status: agent.status,
        currentStep: agent.currentStep,
      }
    }),

  updateStatus: publicProcedure
    .input(
      z.object({
        id: z.string(),
        status: agentStatusSchema,
        currentStep: z.string().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const agent = getAgent(ctx.db, input.id)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Agent ${input.id} not found` })
      }
      updateAgentStatus(ctx.db, input.id, input.status, input.currentStep)
      return getAgent(ctx.db, input.id)!
    }),
})
