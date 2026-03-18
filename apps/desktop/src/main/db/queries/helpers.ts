import type {
  Agent,
  AgentStatus,
  Project,
  Prompt,
  ScheduledResult,
  ScheduledTask,
  TokenUsage,
  Worktree,
} from "@exegol/shared";

export { nanoid } from "nanoid";

// ---------------------------------------------------------------------------
// Row mappers (snake_case DB rows -> camelCase types)
// ---------------------------------------------------------------------------

export function mapPromptRow(row: Record<string, unknown>): Prompt {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    title: row.title as string,
    content: row.content as string,
    category: row.category as Prompt["category"],
    pinned: Boolean(row.pinned),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export function mapProjectRow(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    path: row.path as string,
    gitRemote: (row.git_remote as string) ?? null,
    defaultBranch: row.default_branch as string,
    defaultIde: row.default_ide as string,
    createdAt: row.created_at as number,
    lastOpenedAt: row.last_opened_at as number,
  };
}

export function mapAgentRow(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    worktreeId: (row.worktree_id as string) ?? null,
    cliType: row.cli_type as Agent["cliType"],
    status: row.status as AgentStatus,
    taskDescription: row.task_description as string,
    currentStep: (row.current_step as string) ?? null,
    pid: (row.pid as number) ?? null,
    startedAt: (row.started_at as number) ?? null,
    stoppedAt: (row.stopped_at as number) ?? null,
  };
}

export function mapWorktreeRow(row: Record<string, unknown>): Worktree {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    agentId: (row.agent_id as string) ?? null,
    path: row.path as string,
    branchName: row.branch_name as string,
    autoCleanup: Boolean(row.auto_cleanup),
    diskUsageBytes: row.disk_usage_bytes as number,
    createdAt: row.created_at as number,
  };
}

export function mapScheduledTaskRow(row: Record<string, unknown>): ScheduledTask {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    prompt: row.prompt as string,
    cronExpression: row.cron_expression as string,
    skillName: (row.skill_name as string) ?? null,
    cliAgent: row.cli_agent as string,
    maxTokenBudget: (row.max_token_budget as number) ?? null,
    lastRunAt: (row.last_run_at as number) ?? null,
    nextRunAt: (row.next_run_at as number) ?? null,
    lastResultStatus: (row.last_result_status as string) ?? null,
    enabled: Boolean(row.enabled),
    dependsOn: (row.depends_on as string) ?? null,
  };
}

export function mapScheduledResultRow(row: Record<string, unknown>): ScheduledResult {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    agentId: row.agent_id as string,
    status: row.status as ScheduledResult["status"],
    summary: row.summary as string,
    createdAt: row.created_at as number,
  };
}

export function mapTokenUsageRow(row: Record<string, unknown>): TokenUsage {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    provider: row.provider as string,
    model: row.model as string,
    inputTokens: row.input_tokens as number,
    outputTokens: row.output_tokens as number,
    estimatedCostUsd: row.estimated_cost_usd as number,
    toolCallCount: row.tool_call_count as number,
    recordedAt: row.recorded_at as number,
  };
}
