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
import {
  agentRowSchema,
  parseRow,
  projectRowSchema,
  promptRowSchema,
  scheduledResultRowSchema,
  scheduledTaskRowSchema,
  tokenUsageRowSchema,
  worktreeRowSchema,
} from "@exegol/shared";

export { nanoid } from "nanoid";

// ---------------------------------------------------------------------------
// Row mappers (snake_case DB rows -> camelCase types)
//
// T77: each mapper validates the raw row via parseRow() + a Zod schema
// before mapping. On validation failure the row is logged and passed
// through with a forced cast so the app degrades gracefully.
// ---------------------------------------------------------------------------

export function mapPromptRow(row: Record<string, unknown>): Prompt {
  const r = parseRow(promptRowSchema, row, "prompt");
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    content: r.content,
    category: r.category,
    pinned: r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function mapProjectRow(row: Record<string, unknown>): Project {
  const r = parseRow(projectRowSchema, row, "project");
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    gitRemote: r.git_remote,
    defaultBranch: r.default_branch,
    defaultIde: r.default_ide,
    createdAt: r.created_at,
    lastOpenedAt: r.last_opened_at,
  };
}

export function mapAgentRow(row: Record<string, unknown>): Agent {
  const r = parseRow(agentRowSchema, row, "agent");
  return {
    id: r.id,
    projectId: r.project_id,
    worktreeId: r.worktree_id,
    branchName: r.branch_name,
    cliType: r.cli_type as Agent["cliType"],
    status: r.status as AgentStatus,
    taskDescription: r.task_description,
    currentStep: r.current_step,
    pid: r.pid,
    startedAt: r.started_at,
    stoppedAt: r.stopped_at,
    accessMode: r.access_mode,
  };
}

export function mapWorktreeRow(row: Record<string, unknown>): Worktree {
  const r = parseRow(worktreeRowSchema, row, "worktree");
  return {
    id: r.id,
    projectId: r.project_id,
    agentId: r.agent_id,
    path: r.path,
    branchName: r.branch_name,
    autoCleanup: r.auto_cleanup,
    diskUsageBytes: r.disk_usage_bytes,
    createdAt: r.created_at,
  };
}

export function mapScheduledTaskRow(row: Record<string, unknown>): ScheduledTask {
  const r = parseRow(scheduledTaskRowSchema, row, "scheduledTask");
  return {
    id: r.id,
    projectId: r.project_id,
    prompt: r.prompt,
    cronExpression: r.cron_expression,
    skillName: r.skill_name,
    cliAgent: r.cli_agent,
    maxTokenBudget: r.max_token_budget,
    lastRunAt: r.last_run_at,
    nextRunAt: r.next_run_at,
    lastResultStatus: r.last_result_status,
    enabled: r.enabled,
    dependsOn: r.depends_on,
  };
}

export function mapScheduledResultRow(row: Record<string, unknown>): ScheduledResult {
  const r = parseRow(scheduledResultRowSchema, row, "scheduledResult");
  return {
    id: r.id,
    taskId: r.task_id,
    agentId: r.agent_id,
    status: r.status as ScheduledResult["status"],
    summary: r.summary,
    createdAt: r.created_at,
  };
}

export function mapTokenUsageRow(row: Record<string, unknown>): TokenUsage {
  const r = parseRow(tokenUsageRowSchema, row, "tokenUsage");
  return {
    id: r.id,
    agentId: r.agent_id,
    provider: r.provider,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    estimatedCostUsd: r.estimated_cost_usd,
    toolCallCount: r.tool_call_count,
    recordedAt: r.recorded_at,
  };
}
