import { z } from 'zod'
import { AGENT_CLI_TYPES, AGENT_STATUSES } from '../types/agent'

export const agentCliTypeSchema = z.enum(AGENT_CLI_TYPES)
export const agentStatusSchema = z.enum(AGENT_STATUSES)

export const agentSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  worktreeId: z.string().nullable(),
  cliType: agentCliTypeSchema,
  status: agentStatusSchema,
  taskDescription: z.string().min(1, 'Task description is required'),
  currentStep: z.string().nullable(),
  pid: z.number().int().positive().nullable(),
  startedAt: z.number().nullable(),
  stoppedAt: z.number().nullable(),
})

export const agentCreateSchema = z.object({
  projectId: z.string().min(1),
  cliType: agentCliTypeSchema,
  taskDescription: z.string().min(1, 'Task description is required'),
  useWorktree: z.boolean().optional(),
})

export type AgentSchema = z.infer<typeof agentSchema>
export type AgentCreateSchema = z.infer<typeof agentCreateSchema>
