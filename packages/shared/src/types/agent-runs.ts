import type { Agent } from "./agent";

// ─── Task Queue ─────────────────────────────────────────────────────────────

export const QUEUE_TASK_STATUSES = [
  "queued",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
] as const;
export type QueueTaskStatus = (typeof QUEUE_TASK_STATUSES)[number];

export type QueueTask = {
  id: string;
  projectId: string;
  prompt: string;
  cliType: string;
  priority: number;
  status: QueueTaskStatus;
  dependsOn: string | null;
  agentId: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
};

// ─── Parallel Runs (T65) ───────────────────────────────────────────────────

export const PARALLEL_RUN_STATUSES = ["running", "completed", "failed", "cancelled"] as const;
export type ParallelRunStatus = (typeof PARALLEL_RUN_STATUSES)[number];

export type ParallelRun = {
  id: string;
  projectId: string;
  taskDescription: string;
  /** CLI types for each variant (could be the same or different providers) */
  cliTypes: string[];
  /** Agent IDs spawned for this run — length matches cliTypes */
  agentIds: string[];
  status: ParallelRunStatus;
  /** Agent ID that was promoted as the winner (null until user chooses) */
  promotedAgentId: string | null;
  createdAt: number;
  completedAt: number | null;
};

// ─── T107: Comparator payload ──────────────────────────────────────────────

export type ParallelRunColumn = {
  agent: Agent;
  worktreePath: string | null;
  diffStat: { filesChanged: number; insertions: number; deletions: number } | null;
  /** AgentScoreRow shape, kept loose to avoid a circular type import. */
  score: {
    overallScore: number;
    exitReason: "success" | "failure" | "stopped" | "timeout" | "unknown";
    turnsUsed: number;
    filesChanged: number;
    taskCompleted: boolean;
  } | null;
  cost: {
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  } | null;
  durationSeconds: number | null;
  lastLines: string[];
};

export type ParallelRunDetails = {
  run: ParallelRun;
  columns: ParallelRunColumn[];
};

// ─── T131: Race mode — loser cleanup report ────────────────────────────────

export type LoserCleanupResult = {
  agentId: string;
  worktreePath: string | null;
  branchName: string | null;
  cleaned: boolean;
  dirty: boolean;
  error?: string;
};

// ─── QA Tests (T102) ───────────────────────────────────────────────────────

export const QA_TEST_STATUSES = ["saved", "running", "passed", "failed"] as const;
export type QaTestStatus = (typeof QA_TEST_STATUSES)[number];

export type QaTest = {
  id: string;
  projectId: string;
  name: string;
  /** The starting URL for the test */
  startUrl: string;
  /** JSON-serialized QaAction[] */
  actions: string;
  /** Number of actions in the test */
  actionCount: number;
  createdAt: number;
  lastRunAt: number | null;
  lastStatus: QaTestStatus;
};

export type QaTestRun = {
  id: string;
  testId: string;
  status: QaTestStatus;
  /** JSON-serialized array of step results: { actionIndex, passed, screenshotBase64?, error? } */
  stepResults: string;
  /** JSON-serialized string[] of console errors captured during run */
  consoleErrors: string;
  /** Total duration in ms */
  durationMs: number;
  createdAt: number;
};
