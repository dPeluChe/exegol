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
  /** Times this fact has been independently re-observed. Starts at 1 (the initial observation). */
  reinforcementCount: number;
  lastReinforcedAt: number;
  /** Id of the memory that superseded this one, if any. Superseded facts are never overwritten or deleted. */
  supersededBy: string | null;
};

export type MemoryCreate = {
  projectId: string;
  category: MemoryCategory;
  content: string;
  sourceAgentId?: string;
  relevanceScore?: number;
};
