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

/** T176: a worktree as the fleet view needs it — the row plus who is still in
 *  it and what the disk says. */
export type FleetWorktree = Worktree & {
  projectName: string;
  liveAgents: number;
  exists: boolean;
  dirty: boolean;
};
