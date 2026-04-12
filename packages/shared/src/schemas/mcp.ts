import { z } from "zod";

export const mcpTransportSchema = z.enum(["stdio", "http"]);

export const mcpServerConfigSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  transport: mcpTransportSchema,
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  enabled: z.boolean(),
});

export const mcpToolCallResultSchema = z.object({
  toolName: z.string().min(1),
  params: z.record(z.unknown()),
  result: z.unknown(),
});
