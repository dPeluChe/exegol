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

// ─── Oplog v2 (T129) — GitButler-style hidden-ref turn snapshots ──────────

export type OplogSnapshotOperation =
  | "AgentTurn"
  | "PipelineStep"
  | "Promote"
  | "Race"
  | "PreRestore";

/** A committed turn snapshot read straight off the hidden ref chain — no
 *  parallel DB store, git is the source of truth. */
export type OplogSnapshot = {
  sha: string;
  parentSha?: string;
  operation: OplogSnapshotOperation | string;
  agentId: string;
  provider: string;
  turnIndex: number;
  description: string;
  /** unix seconds (git commit time) */
  timestamp: number;
};

/** T200.5: one file a turn changed (numstat; null counts = binary) */
export type TurnFileChange = {
  path: string;
  additions: number | null;
  deletions: number | null;
};

/** T200.5: what an interactive agent's last turn changed; `snapshotSha` is the AgentTurn
 *  oplog snapshot of the folder before the turn */
export type TurnChanges = {
  agentId: string;
  projectId: string;
  turnIndex: number;
  startedAt: number;
  endedAt: number;
  snapshotSha: string;
  files: TurnFileChange[];
};

/** T200.5: the newest recorded turn, and whether the agent is in a turn now */
export type LatestTurn = {
  turn: TurnChanges | null;
  inTurn: boolean;
};

/** T200.5: Undo turn puts back only the files still as the turn left them */
export type UndoTurnResult = {
  projectId: string;
  restored: string[];
  /** Changed since the turn ended, left as they are */
  skipped: string[];
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
