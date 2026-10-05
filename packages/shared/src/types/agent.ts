export const AGENT_CLI_TYPES = [
  "claude-code",
  "codex",
  "gemini",
  "agy",
  "devin",
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
/** Non-terminal statuses — an agent that may still hold a PTY (T156). */
export const LIVE_STATUSES = new Set<AgentStatus>([
  "idle",
  "spawning",
  "running",
  "waiting_input",
  "paused",
]);

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
  cliType?: string,
): AgentActivityLevel {
  switch (status) {
    case "running":
    case "spawning":
      // A shell's step is its foreground job: without one it waits at the prompt
      return cliType === "shell" && !currentStep ? "idle" : "busy";
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

/**
 * Flag that makes each CLI skip its own permission prompts. Single source of
 * truth: the settings toggle, the pipeline executor and the spawn modal all
 * read this. The two former copies had already drifted — crush's flag existed
 * in the pipeline but not in settings, so its toggle silently did nothing.
 * One token each (the toggle finds the flag by exact match). Checked against
 * each CLI's --help, 2026-09-24; codex dropped --full-auto.
 */
export const YOLO_FLAGS: Record<string, string> = {
  "claude-code": "--dangerously-skip-permissions",
  codex: "--dangerously-bypass-approvals-and-sandbox",
  gemini: "--yolo",
  agy: "--dangerously-skip-permissions",
  devin: "--permission-mode=dangerous",
  opencode: "--auto",
  amp: "--dangerously-allow-all",
  kilocode: "--auto",
  crush: "--yolo",
  "factory-droid": "--auto=high",
  aider: "--yes-always",
  goose: "--no-confirm",
};

/**
 * How each CLI takes a model for one session (--help and vendor docs, 2026-09-30): a flag; an
 * environment variable (goose); or droid's `--settings` file, merged for that process only.
 * amp picks its model through a mode. crush and kiro have no per-session model (their config
 * file is global), so the launcher shows no field for them.
 */
export type ModelLaunch = { flag: string } | { env: string } | { settingsFile: true };

export const MODEL_LAUNCH: Record<string, ModelLaunch> = {
  "claude-code": { flag: "--model" },
  codex: { flag: "--model" },
  gemini: { flag: "-m" },
  agy: { flag: "--model" },
  devin: { flag: "--model" },
  aider: { flag: "--model" },
  opencode: { flag: "-m" },
  kilocode: { flag: "-m" },
  amp: { flag: "-m" },
  goose: { env: "GOOSE_MODEL" },
  "factory-droid": { settingsFile: true },
};

/**
 * How each CLI takes an image from the clipboard (each one's source or docs, 2026-10-01):
 * "ctrl-v": it reads the clipboard itself on Ctrl+V and attaches it (Cmd+V never reaches a
 * terminal program on macOS, so Exegol sends Ctrl+V for it); "/paste": a command that does it
 * (typed, not sent: the user adds text and presses Enter). Absent (goose, shells): Exegol saves
 * the image to a file and types its path
 */
export const CLIPBOARD_IMAGE: Record<string, "ctrl-v" | "/paste"> = {
  "claude-code": "ctrl-v",
  codex: "ctrl-v",
  gemini: "ctrl-v",
  agy: "ctrl-v",
  devin: "ctrl-v",
  opencode: "ctrl-v",
  amp: "ctrl-v",
  kilocode: "ctrl-v",
  crush: "ctrl-v",
  "factory-droid": "ctrl-v",
  aider: "/paste",
  kiro: "/paste",
};

/** Suggestions shipped with the app; CLIs that can list theirs add them (agents.listModels) */
export const MODEL_SUGGESTIONS: Record<string, string[]> = {
  "claude-code": ["sonnet", "opus", "haiku"],
  amp: ["smart", "rush", "free"],
};

/** Goes into the shell command unquoted: model ids only (letters, digits, . _ - : / @) */
export const MODEL_ID_PATTERN = /^[\w.:/@-]{1,100}$/;

/** One window of a CLI's subscription plan (Claude: 5h and weekly; Codex: primary/secondary) */
export interface PlanWindow {
  usedPercent: number;
  /** Epoch ms; null when the source does not say */
  resetsAt: number | null;
  windowMins: number | null;
}

/** A CLI's plan usage, as its own login reports it */
export interface PlanUsage {
  cliType: string;
  session: PlanWindow | null;
  weekly: PlanWindow | null;
  /** When the numbers were read (Codex: its last turn) */
  fetchedAt: number;
  /** The last good reading, served while the source fails or rate-limits */
  stale: boolean;
}

/** A CLI's installed version against its newest release (Doctor's cliUpdates) */
export interface CliUpdateStatus {
  cliType: string;
  installed: string | null;
  /** When the installed binary was written (ms): a session started before it runs an older one */
  installedAt: number | null;
  latest: string | null;
  updateAvailable: boolean;
  updateCommand: string | null;
}

function versionParts(v: string | null | undefined): number[] | null {
  const m = v?.match(/\d+(?:\.\d+)*/);
  return m ? m[0].split(".").map(Number) : null;
}

/** a > b, comparing the numbers CLIs print: 2.1.286, 0.0.1768123456-gabc, 3000.11.3 */
export function isNewerVersion(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const pa = versionParts(a);
  const pb = versionParts(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
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
  /** T160: user-editable session alias — addressing name for agent_send + UI labels. */
  alias?: string | null;
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
  /** T101: CLI-emitted "resume this session" command string. T106: gates the Resume action. */
  resumeCommand?: string | null;
  /** Per-launch YOLO choice (null = the provider's configured args); a resume inherits it */
  yolo?: boolean | null;
  /** Alive, but kept out of Needs attention and notifications */
  muted?: boolean;
  /** Opt-in: Exegol tells it about its PR's failing checks, reviews and conflicts */
  prWatch?: boolean;
  /** Stopped on purpose to come back later (Resume); quiet like muted */
  suspendedAt?: number | null;
  /** Started by hand in a plain terminal: the CLI can exit back to the shell prompt */
  launchedInShell?: boolean;
  /** The CLI's version when this session started (null: unknown, or a shell) */
  cliVersion?: string | null;
  /** The model it was launched with (null: the CLI's default) */
  model?: string | null;
  /** Claude Code's own session id, once known (resume, and finding a resumed session's pin) */
  claudeSessionId?: string | null;
};

export type AgentCreate = {
  projectId: string;
  cliType: AgentCliType;
  /** Optional: `createAgent` labels a blank one with the provider name. */
  taskDescription?: string;
  useWorktree?: boolean;
  branchName?: string;
  skillNames?: string[];
  /** Override cwd for agent (e.g. pipeline shared worktree). Skips worktree creation. */
  cwdOverride?: string;
  /** T66: Resume a previous session (appends provider's resumeFlag to command) */
  resumeSession?: boolean;
  /** T101: ID of the agent whose claude_session_id should be used for --resume */
  resumeFromAgentId?: string;
  /** A Claude Code session from its own store (picked by name or title): `--resume <id>` */
  resumeLocalSessionId?: string;
  /** T58: access mode — "read" for explore-only, "write" for full access (default), "plan" for analysis-only */
  accessMode?: AgentAccessMode;
  /** T161: per-launch YOLO override; undefined keeps the provider's setting. */
  yolo?: boolean;
  /** T177: branch/ref the worktree is cut from; undefined means the repo's HEAD. */
  baseBranch?: string;
  /** Model for this launch (MODEL_FLAGS); undefined keeps the CLI's default */
  model?: string;
  /** Session name (alias); undefined picks a codename, or keeps the resumed session's */
  name?: string;
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
  /** Set by agents.listEnabledProviders: its command is on PATH (launchable) */
  installed?: boolean;
  /** How to install it on this OS, when not installed (the vendor's recommended command) */
  installCommand?: string | null;
  /** The vendor's install guide (the only way when this OS has no command, e.g. amp on Windows) */
  installDocs?: string | null;
};

// ─── Messages ───────────────────────────────────────────────────────────────

export const AGENT_MESSAGE_TYPES = ["text", "handoff", "status", "request", "result"] as const;
export type AgentMessageType = (typeof AGENT_MESSAGE_TYPES)[number];

/** `queued` and `delivered` are transport; `consumed` is the receiver's own turn boundary.
 *  Only the terminal three are final. */
export type MessageDeliveryState =
  | "queued"
  | "delivered"
  | "consumed"
  | "cancelled"
  | "undeliverable";

export type AgentMessage = {
  id: string;
  fromAgentId: string | null;
  toAgentId: string | null;
  type: AgentMessageType;
  content: string;
  createdAt: number;
  /** The receiver pulled it (messages_check) */
  readAt: number | null;
  deliveryState: MessageDeliveryState | null;
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

/** A past session a provider can reopen with its own resume flag (`agents.listResumable`). */
export type ResumableSession = {
  agentId: string;
  cliType: string;
  /** Session codename, when it had one — how the user knew this session. */
  alias: string | null;
  taskDescription: string;
  status: string;
  endedAt: number | null;
};

/** Where a spawn WOULD run, resolved by the same code that will create it —
 *  the renderer cannot reproduce the worktree collision suffix. */
export type SpawnPreview = {
  cwd: string;
  /** The branch that will be created, suffixed if the requested one is taken. */
  branchName: string | null;
  /** True when an existing worktree already holds that branch and is reused. */
  reused: boolean;
};

/**
 * T181 — one row in Project › History.
 *
 * `origin` is the honest distinction, not a decoration: Exegol knows the score,
 * the spend and the oplog for what IT launched, and knows only that a session
 * happened for everything read out of a CLI's own on-disk store.
 */
export type HistoryEntry = {
  origin: "exegol" | "local";
  id: string;
  provider: string;
  /** Session codename for Exegol runs; the CLI's own title otherwise. */
  label: string;
  task: string | null;
  branch: string | null;
  startedAt: number | null;
  endedAt: number | null;
  /** Null for a local session — a store on disk records no outcome. */
  status: string | null;
  score: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  oplogEntries: number;
  hasFinalOutput: boolean;
  archived: boolean;
  /** The provider's own session id, when known — what its resume flag takes. */
  sessionId: string | null;
  /** CLI version that ran it, when the source records one. */
  version: string | null;
  /** Transcript size for a local session — with no score and no token count,
   *  it is the only signal of how much actually happened. 0 for Exegol rows,
   *  which have better evidence. */
  sizeBytes: number;
};
