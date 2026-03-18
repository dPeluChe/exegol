export const AGENT_CLI_TYPES = [
  "claude-code",
  "codex",
  "gemini",
  "aider",
  "opencode",
  "goose",
  "amp",
  "kiro",
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
