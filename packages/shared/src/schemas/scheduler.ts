import { z } from "zod";
import { SCHEDULED_TASK_STATUSES } from "../types/scheduler";

export const scheduledTaskStatusSchema = z.enum(SCHEDULED_TASK_STATUSES);

export const scheduledResultStatusSchema = z.enum([
  "success",
  "failure",
  "timeout",
  "budget_exceeded",
]);

export const scheduledTaskCreateSchema = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(1),
  cronExpression: z.string().min(1),
  cliAgent: z.string().min(1),
  skillName: z.string().optional(),
  maxTokenBudget: z.number().int().positive().optional(),
  dependsOn: z.string().optional(),
});

export const scheduledTaskUpdateSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1).optional(),
  cronExpression: z.string().optional(),
  cliAgent: z.string().optional(),
  skillName: z.string().nullable().optional(),
  maxTokenBudget: z.number().int().positive().nullable().optional(),
  dependsOn: z.string().nullable().optional(),
});
