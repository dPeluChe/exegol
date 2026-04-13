import { z } from "zod";
import {
  PIPELINE_RUN_STATUSES,
  PIPELINE_STEP_ROLES,
  PIPELINE_STEP_STATUSES,
} from "../types/pipeline";

export const pipelineStepRoleSchema = z.enum(PIPELINE_STEP_ROLES);
export const pipelineRunStatusSchema = z.enum(PIPELINE_RUN_STATUSES);
export const pipelineStepStatusSchema = z.enum(PIPELINE_STEP_STATUSES);

export const pipelineStepDefSchema = z.object({
  label: z.string().min(1),
  cliType: z.string().min(1),
  role: pipelineStepRoleSchema,
  promptTemplate: z.string(),
  allowFailure: z.boolean().optional(),
  loopBackTo: z.number().int().optional(),
});

export const pipelineStepResultSchema = z.object({
  stepIndex: z.number().int().min(0),
  iteration: z.number().int().min(0),
  agentId: z.string().nullable(),
  status: pipelineStepStatusSchema,
  exitCode: z.number().int().nullable(),
  outputSummary: z.string(),
  diffSummary: z.string(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
});

export const pipelineTemplateCreateSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(pipelineStepDefSchema).min(1),
});

export const pipelineTemplateUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  steps: z.array(pipelineStepDefSchema).min(1).optional(),
});

export const pipelineRunCreateSchema = z.object({
  templateId: z.string().min(1),
  projectId: z.string().min(1),
  task: z.string().min(1),
  maxIterations: z.number().int().min(1).max(20).optional(),
  useWorktree: z.boolean().optional(),
});

export const pipelineRunTransitionSchema = z.object({
  from: pipelineRunStatusSchema,
  to: pipelineRunStatusSchema,
});
