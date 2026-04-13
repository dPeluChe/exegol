export type DiffComment = {
  id: string;
  projectId: string;
  agentId: string | null;
  filePath: string;
  lineNumber: number;
  hunkIndex: number | null;
  content: string;
  resolved: boolean;
  createdAt: number;
};

export type DiffCommentCreate = {
  projectId: string;
  agentId?: string | null;
  filePath: string;
  lineNumber: number;
  hunkIndex?: number | null;
  content: string;
};
