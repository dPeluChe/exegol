export const MEMORY_CATEGORIES = [
  "preference",
  "pattern",
  "error",
  "solution",
  "dependency",
  "convention",
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export type MemoryEntry = {
  id: string;
  projectId: string;
  category: MemoryCategory;
  content: string;
  sourceAgentId: string | null;
  relevanceScore: number;
  accessCount: number;
  createdAt: number;
  lastAccessedAt: number;
};

export type MemoryCreate = {
  projectId: string;
  category: MemoryCategory;
  content: string;
  sourceAgentId?: string;
  relevanceScore?: number;
};
