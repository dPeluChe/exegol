import { z } from "zod";

export const tokenUsageSummarySchema = z.object({
  totalInputTokens: z.number().int().min(0),
  totalOutputTokens: z.number().int().min(0),
  totalCostUsd: z.number().min(0),
  totalToolCalls: z.number().int().min(0),
  periodStart: z.number(),
  periodEnd: z.number(),
});

export const tokenUsageQuerySchema = z.object({
  projectId: z.string().min(1),
  days: z.number().int().positive().default(30),
});
