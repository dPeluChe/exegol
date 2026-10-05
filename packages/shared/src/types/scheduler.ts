export const SCHEDULED_TASK_STATUSES = ["enabled", "disabled", "running"] as const;
export type ScheduledTaskStatus = (typeof SCHEDULED_TASK_STATUSES)[number];

export type ScheduledTask = {
  id: string;
  projectId: string;
  prompt: string;
  cronExpression: string;
  skillName: string | null;
  cliAgent: string;
  maxTokenBudget: number | null;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastResultStatus: string | null;
  enabled: boolean;
  dependsOn: string | null;
  /** Null = DEFAULT_SCHEDULED_TIMEOUT_MINUTES */
  timeoutMinutes: number | null;
};

export type ScheduledTaskCreate = {
  projectId: string;
  prompt: string;
  cronExpression: string;
  cliAgent: string;
  skillName?: string;
  maxTokenBudget?: number;
  dependsOn?: string;
  timeoutMinutes?: number;
};

export const DEFAULT_SCHEDULED_TIMEOUT_MINUTES = 30;
export const MAX_SCHEDULED_TIMEOUT_MINUTES = 24 * 60;

export type ScheduledResultStatus = "success" | "failure" | "timeout" | "budget_exceeded";
export type ScheduledRunState = "queued" | "running" | "skipped" | ScheduledResultStatus;

export type ScheduledRun = {
  id: string;
  taskId: string;
  agentId: string | null;
  state: ScheduledRunState;
  attempt: number;
  summary: string;
  queuedAt: number;
  startedAt: number | null;
  endedAt: number | null;
};

export type ScheduledResult = {
  id: string;
  taskId: string;
  agentId: string;
  status: ScheduledResultStatus;
  summary: string;
  createdAt: number;
};
