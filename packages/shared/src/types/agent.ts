export const AGENT_CLI_TYPES = [
  "claude-code",
  "codex",
  "gemini",
  "aider",
  "opencode",
  "goose",
  "amp",
  "kiro",
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
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export type Agent = {
  id: string;
  projectId: string;
  worktreeId: string | null;
  cliType: AgentCliType;
  status: AgentStatus;
  taskDescription: string;
  currentStep: string | null;
  pid: number | null;
  startedAt: number | null;
  stoppedAt: number | null;
};

export type AgentCreate = {
  projectId: string;
  cliType: AgentCliType;
  taskDescription: string;
  useWorktree?: boolean;
  branchName?: string;
  skillNames?: string[];
};

// ─── Provider Registry ──────────────────────────────────────────────────────

export type AgentProviderCapabilities = {
  supportsWorktree: boolean;
  supportsResume: boolean;
  supportsRPC: boolean;
  supportsVision: boolean;
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
