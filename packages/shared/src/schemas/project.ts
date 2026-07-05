import { z } from "zod";

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Project name is required"),
  path: z.string().min(1, "Project path is required"),
  gitRemote: z.string().nullable(),
  defaultBranch: z.string().min(1).default("main"),
  defaultIde: z.string().min(1).default("vscode"),
  createdAt: z.number(),
  lastOpenedAt: z.number(),
  groupId: z.string().nullable(),
  sortOrder: z.number(),
});

export const projectCreateSchema = projectSchema.omit({
  id: true,
  createdAt: true,
  lastOpenedAt: true,
  groupId: true,
  sortOrder: true,
});

export type ProjectSchema = z.infer<typeof projectSchema>;
export type ProjectCreateSchema = z.infer<typeof projectCreateSchema>;
