import { z } from "zod";

export const projectGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Group name is required"),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  background: z.string().nullable(),
  sortOrder: z.number(),
  collapsed: z.boolean(),
  createdAt: z.number(),
});

export const projectGroupCreateSchema = projectGroupSchema.omit({
  id: true,
  sortOrder: true,
  collapsed: true,
  createdAt: true,
});

export type ProjectGroupSchema = z.infer<typeof projectGroupSchema>;
export type ProjectGroupCreateSchema = z.infer<typeof projectGroupCreateSchema>;
