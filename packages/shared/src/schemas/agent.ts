import { z } from "zod";
import { AGENT_ACCESS_MODES, AGENT_CLI_TYPES, AGENT_STATUSES } from "../types/agent";

export const agentCliTypeSchema = z.enum(AGENT_CLI_TYPES);
export const agentStatusSchema = z.enum(AGENT_STATUSES);
export const agentAccessModeSchema = z.enum(AGENT_ACCESS_MODES);

export const agentSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  worktreeId: z.string().nullable(),
  branchName: z.string().nullable().optional(),
  cliType: agentCliTypeSchema,
  status: agentStatusSchema,
  taskDescription: z.string().min(1, "Task description is required"),
  currentStep: z.string().nullable(),
  pid: z.number().int().positive().nullable(),
  startedAt: z.number().nullable(),
  stoppedAt: z.number().nullable(),
  accessMode: agentAccessModeSchema.optional(),
});

export const agentCreateSchema = z.object({
  projectId: z.string().min(1),
  cliType: agentCliTypeSchema,
  taskDescription: z.string().min(1, "Task description is required"),
  useWorktree: z.boolean().optional(),
  branchName: z.string().optional(),
  skillNames: z.array(z.string()).optional(),
  cwdOverride: z.string().optional(),
  /** T66: Resume a previous session (appends provider's resumeFlag to command) */
  resumeSession: z.boolean().optional(),
  /** T101: ID of the agent whose claude_session_id should be used for --resume */
  resumeFromAgentId: z.string().optional(),
  /** T58: read = explore-only, write = full access (default), plan = analysis-only */
  accessMode: agentAccessModeSchema.optional(),
});

export type AgentSchema = z.infer<typeof agentSchema>;
export type AgentCreateSchema = z.infer<typeof agentCreateSchema>;
