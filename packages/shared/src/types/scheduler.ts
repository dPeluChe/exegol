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
};

export type ScheduledTaskCreate = {
  projectId: string;
  prompt: string;
  cronExpression: string;
  cliAgent: string;
  skillName?: string;
  maxTokenBudget?: number;
  dependsOn?: string;
};

export type ScheduledResult = {
  id: string;
  taskId: string;
  agentId: string;
  status: "success" | "failure" | "timeout" | "budget_exceeded";
  summary: string;
  createdAt: number;
};
