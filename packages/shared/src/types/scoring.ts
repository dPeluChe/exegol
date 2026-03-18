export type ExitReason = "success" | "failure" | "stopped" | "timeout" | "unknown";

export type AgentScoreRow = {
  agentId: string;
  filesChanged: number;
  compiles: boolean | null;
  testsPassed: boolean | null;
  taskCompleted: boolean;
  exitCode: number;
  exitReason: ExitReason;
  turnsUsed: number;
  tokensSpent: number;
  filesModifiedCount: number;
  overallScore: number;
  scoredAt: number;
};

export type ScoringStats = {
  totalScored: number;
  avgScore: number;
  successRate: number;
  avgTurns: number;
  avgTokens: number;
  byCliType: Array<{
    cliType: string;
    count: number;
    avgScore: number;
    successRate: number;
  }>;
};

export type OplogOperation =
  | "commit"
  | "branch_create"
  | "worktree_create"
  | "file_write"
  | "revert";

export type OplogEntry = {
  id: string;
  agentId: string;
  projectId: string;
  operation: OplogOperation;
  refBefore: string | null;
  refAfter: string | null;
  description: string;
  createdAt: number;
};

export type RustDiffLine = {
  content: string;
  lineType: string;
  oldLineno: number | null;
  newLineno: number | null;
};

export type RustDiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: RustDiffLine[];
};

export type RustFileDiff = {
  path: string;
  oldPath: string | null;
  status: string;
  binary: boolean;
  hunks: RustDiffHunk[];
};
