export type Worktree = {
  id: string;
  projectId: string;
  agentId: string | null;
  path: string;
  branchName: string;
  autoCleanup: boolean;
  diskUsageBytes: number;
  createdAt: number;
};
