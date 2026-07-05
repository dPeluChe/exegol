export type SearchEntityType =
  | "scrollback"
  | "prompt"
  | "task_description"
  | "scheduler_result"
  | "memory";

export interface SearchResult {
  title: string;
  snippet: string;
  entityType: SearchEntityType;
  entityId: string;
  projectId: string;
  agentId: string | null;
  score: number;
}
