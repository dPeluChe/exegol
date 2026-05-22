export const AGENT_CLI_TYPES = [
  "claude-code",
  "codex",
  "gemini",
  "aider",
  "opencode",
  "goose",
  "amp",
  "kiro",
  "kilocode",
  "crush",
  "factory-droid",
  "shell",
  "custom",
] as const;
export type AgentCliType = (typeof AGENT_CLI_TYPES)[number];

export const AGENT_STATUSES = [
  "idle",
  "spawning",
  "running",
  "waiting_input",
  "paused",
  "completed",
  "failed",
  "stopped",
  "crashed",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const RUNNING_STATUSES = new Set<AgentStatus>(["running", "waiting_input"]);
export const ACTIVE_STATUSES = new Set<AgentStatus>(["running", "spawning", "waiting_input"]);

// ─── Activity Classification (T70) ─────────────────────────────────────────

export const AGENT_ACTIVITY_LEVELS = ["busy", "idle", "neutral"] as const;
export type AgentActivityLevel = (typeof AGENT_ACTIVITY_LEVELS)[number];

/**
 * Derive a coarse activity level from agent status + optional current step.
 * This is a pure function — no side effects, no debounce. Callers handle timing.
 *
 * - **busy**: agent is actively doing work (running with a tool/thinking step)
 * - **idle**: agent is alive but not doing anything (waiting for input, paused)
 * - **neutral**: terminal state or not enough info to classify
 */
export function classifyActivity(
  status: AgentStatus,
  currentStep?: string | null,
): AgentActivityLevel {
  switch (status) {
    case "running":
    case "spawning":
      // If we have a step signal, it's definitely busy
      if (currentStep && currentStep !== "") return "busy";
      // Running but no step detected yet — still busy (just started)
      return "busy";
    case "waiting_input":
    case "paused":
      return "idle";
    case "completed":
    case "failed":
    case "stopped":
    case "crashed":
    case "idle":
      return "neutral";
    default:
      return "neutral";
  }
}

export const AGENT_ACCESS_MODES = ["read", "write", "plan"] as const;
export type AgentAccessMode = (typeof AGENT_ACCESS_MODES)[number];

// ─── T105: Worktree Isolation Status ───────────────────────────────────────

export const ISOLATION_MODES = ["isolated", "pipeline", "project-root", "fallback"] as const;
export type IsolationMode = (typeof ISOLATION_MODES)[number];

/**
 * Derive the isolation badge state from an Agent. Prefers the stored
 * `isolationMode` field (set at spawn time); otherwise falls back to a
 * coarse heuristic based on worktreeId. Pure function — testable.
 *
 * - `isolated` — agent owns a private git worktree
 * - `pipeline` — agent runs in a shared pipeline worktree (cwdOverride)
 * - `project-root` — agent was launched without isolation, intentionally
 * - `fallback` — agent requested a worktree but creation failed silently
 *
 * Why: the user thinks they have isolation if they ticked the "worktree"
 * box at spawn time. A silent fallback to project root is a footgun and
 * must surface visibly (red badge). Pipeline and isolated are both safe
 * (green) but distinct in operator mental model.
 */
export function deriveIsolationMode(agent: {
  isolationMode?: IsolationMode | null;
  worktreeId?: string | null;
}): IsolationMode {
  if (agent.isolationMode) return agent.isolationMode;
  return agent.worktreeId ? "isolated" : "project-root";
}

export type Agent = {
  id: string;
  projectId: string;
  worktreeId: string | null;
  branchName?: string | null;
  cliType: AgentCliType;
  status: AgentStatus;
  taskDescription: string;
  currentStep: string | null;
  pid: number | null;
  startedAt: number | null;
  stoppedAt: number | null;
  /** T58: read = explore-only, write = full access (default), plan = analysis-only (no file writes) */
  accessMode?: AgentAccessMode;
  /** T105: Worktree isolation status — set at spawn time. */
  isolationMode?: IsolationMode | null;
};

export type AgentCreate = {
  projectId: string;
  cliType: AgentCliType;
  taskDescription: string;
  useWorktree?: boolean;
  branchName?: string;
  skillNames?: string[];
  /** Override cwd for agent (e.g. pipeline shared worktree). Skips worktree creation. */
  cwdOverride?: string;
  /** T66: Resume a previous session (appends provider's resumeFlag to command) */
  resumeSession?: boolean;
  /** T101: ID of the agent whose claude_session_id should be used for --resume */
  resumeFromAgentId?: string;
  /** T58: access mode — "read" for explore-only, "write" for full access (default), "plan" for analysis-only */
  accessMode?: AgentAccessMode;
};

// ─── Provider Registry ──────────────────────────────────────────────────────

export type AgentProviderCapabilities = {
  supportsWorktree: boolean;
  supportsResume: boolean;
  /** Flag to resume the last session (e.g. `--continue`, `--resume`). Empty = no resume. */
  resumeFlag: string;
  /**
   * Substring prefix the CLI prints in its shutdown output that identifies the
   * resume command to run next time (T101). The parser extracts from this prefix
   * to end-of-line and stores the full command verbatim.
   *
   * Examples:
   *   claude-code  → "claude --resume "
   *   gemini       → "gemini --resume "
   *   codex        → "codex resume "
   *   droid        → "droid --resume "
   *   opencode     → "opencode -s "
   *
   * Leave empty or omit when the CLI has no session resume support.
   */
  resumeCommandPattern?: string;
  supportsRPC: boolean;
  supportsVision: boolean;
  /** CLI accepts a prompt/task as a positional argument (e.g. `claude 'task'`) */
  supportsPromptArg: boolean;
  /** Flag to pass a prompt (e.g. `aider --message 'task'`). Empty = no flag support. */
  promptFlag: string;
  /** Seconds of idle (no PTY output) before auto-closing in pipeline mode. 0 = disabled. */
  pipelineIdleCloseSeconds: number;
};

export type AgentProvider = {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  argsTemplate: string;
  icon: string;
  color: string;
  capabilities: AgentProviderCapabilities;
  isBuiltin: boolean;
  /** Whether this provider is shown in the launcher (default: true) */
  enabled: boolean;
};

// ─── Messages ───────────────────────────────────────────────────────────────

export const AGENT_MESSAGE_TYPES = ["text", "handoff", "status", "request", "result"] as const;
export type AgentMessageType = (typeof AGENT_MESSAGE_TYPES)[number];

export type AgentMessage = {
  id: string;
  fromAgentId: string | null;
  toAgentId: string | null;
  type: AgentMessageType;
  content: string;
  createdAt: number;
  readAt: number | null;
};

// ─── Handoff ────────────────────────────────────────────────────────────────

export type HandoffSummary = {
  id: string;
  agentId: string;
  successorAgentId: string | null;
  goal: string;
  progress: string;
  filesModified: string;
  nextSteps: string;
  criticalContext: string;
  createdAt: number;
};

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

// ─── Sessions ───────────────────────────────────────────────────────────────

export type RecentSession = {
  id: string;
  taskDescription: string;
  cliType: string;
  status: AgentStatus;
  startedAt: number | null;
  stoppedAt: number | null;
  projectName: string;
  projectId: string;
};
