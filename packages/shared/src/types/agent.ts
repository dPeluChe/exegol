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
  "grok",
  "cursor",
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
/** Statuses of a session that ended (no PTY left); string-keyed so DB rows check directly */
export const ENDED_STATUSES: ReadonlySet<string> = new Set<AgentStatus>([
  "completed",
  "failed",
  "stopped",
  "crashed",
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

/** A numbered question an agent CLI waits on (Claude's permission prompt, Codex's approval) */
export interface ScreenDialog {
  /** The line that asks ("Do you want to proceed?"), when one sits right above the options */
  question: string | null;
  /** A few lines above the question: what the agent wants to run or change */
  context: string[];
  options: { key: string; label: string }[];
  /** A selection sits on an option: a dialog for sure, not a numbered list in an answer */
  picked: boolean;
  /** Question + context: an answer names the dialog it was given for */
  fingerprint: string;
}

/** One bubble of a session's chat: never a tool's input or result */
export type SessionTurn = {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  /** Unix seconds; null for terminal text */
  at: number | null;
};

export type ChatPage = {
  turns: SessionTurn[];
  /** Hand it back for what came after; null when a page is the whole text */
  cursor: string | null;
  /** `turns` replaces what the reader holds */
  reset: boolean;
  /** Read from the terminal: there was no transcript */
  fromTerminal: boolean;
  /** The turns are Markdown; terminal text is shown as printed */
  markdown: boolean;
  /** Hand it to `agents.chatOlder` for what came before; null at the start. Only with `reset` */
  older: string | null;
};

export type OlderChatPage = Pick<ChatPage, "turns" | "older">;

/** How a message typed into a session opens, id included: the chat's way to recognize it */
export const injectedHeaders = (messageId: string): [string, string] => [
  `[Exegol message ${messageId} `,
  `[Exegol notice ${messageId} `,
];

const PASTE_TAGS = /^\s*<pasted_content[^>]*>\n?|\n?<\/pasted_content[^>]*>\s*$/g;

/** A person's turn as they wrote it: Claude Code's transcript wraps a pasted message (how
 *  Exegol sends one) in `<pasted_content>`. Only the wrapping pair goes, never a tag in the text */
export const stripPasteTags = (text: string): string => text.replace(PASTE_TAGS, "");

const INJECTED_HEADER = /^\[Exegol (?:message|notice) (\S+) /;

/** The message a turn was typed in for, read from its header; null for any other turn */
export const injectedMessageId = (text: string): string | null =>
  INJECTED_HEADER.exec(text)?.[1] ?? null;

/** What a session does, by the last tool its hooks named */
export type DeskActivity = "edits" | "command" | "browser" | "thinking" | "message";

export function toolActivity(tool: string): DeskActivity {
  if (/^(Edit|MultiEdit|Write|NotebookEdit|apply_patch)$/.test(tool)) return "edits";
  if (/^(Bash|shell|exec_command)$/.test(tool)) return "command";
  if (/^(WebFetch|WebSearch)$/.test(tool) || tool.includes("browser_")) return "browser";
  if (tool.endsWith("agent_send")) return "message";
  return "thinking";
}

/** A prompt the user queued for an agent's next turn boundary (T200.4) */
export interface FollowUpItem {
  id: string;
  text: string;
}

/** Push payload: an agent's follow-up queue after any change */
export interface FollowUpsChangedEvent {
  agentId: string;
  items: FollowUpItem[];
}

/** Steer waits this long for the prompt after the interrupt; past it the message stays queued */
export const STEER_TIMEOUT_MS = 20_000;

/** A live agent session (not a shell, not a CLI back at its shell prompt) takes follow-ups */
export function acceptsFollowUps(
  agent: Pick<Agent, "cliType" | "status" | "launchedInShell">,
): boolean {
  return (
    agent.cliType !== "shell" &&
    LIVE_STATUSES.has(agent.status) &&
    !(agent.launchedInShell && agent.status === "idle")
  );
}

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

/** A project's main session, among its live agent sessions */
export interface MainSession {
  id: string;
  /** The person marked it; false when it is main by the default rule (opened first) */
  marked: boolean;
  /** Live agent sessions in the project */
  live: number;
}

/** What a Company desk shows that the agent row does not hold */
export interface DeskFacts {
  /** Changed files in its folder; null when that is not a git repo */
  changedFiles: number | null;
  port: number | null;
  /** Linked with another agent, either direction */
  linked: boolean;
}

/** A session that finished on its own, for Company's Done since you left */
export type DoneSession = Pick<Agent, "id" | "alias" | "taskDescription" | "cliType">;

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
  /** The name it was last given inside its CLI (Claude's /rename), when Exegol has read one */
  cliName?: string | null;
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
  /** Role models it was launched with (MODEL_ROLES ids), null when none */
  modelRoles?: Record<string, string> | null;
  /** Claude Code's own session id, once known (resume, and finding a resumed session's pin) */
  claudeSessionId?: string | null;
  /** When the status last changed (ms), kept across app restarts */
  statusChangedAt?: number | null;
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
  /** A repo inside the project to cut the worktree from; undefined means the project root. */
  worktreeRepo?: string;
  /** Model for this launch (MODEL_FLAGS); undefined keeps the CLI's default */
  model?: string;
  /** Role models for this launch (MODEL_ROLES ids); undefined keeps a resumed session's */
  modelRoles?: Record<string, string>;
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
  /** The key that interrupts its turn (Steer); absent: Steer is not offered */
  interruptKey?: string | null;
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

/** What the PR watch last saw for one agent (T142) */
export interface PrWatchStatus {
  pr: { number: number; url: string; failingChecks: number; conflicting: boolean } | null;
  lastPolledAt: number | null;
}
