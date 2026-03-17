import type {
  Agent,
  AgentCreate,
  AgentStatus,
  Project,
  ProjectCreate,
  TokenUsage,
  TokenUsageSummary,
  Worktree,
} from "@exegol/shared";
import type Database from "libsql";
import { nanoid } from "nanoid";

// ---------------------------------------------------------------------------
// Row mappers (snake_case DB rows -> camelCase types)
// ---------------------------------------------------------------------------

function mapProjectRow(row: Record<string, unknown>): Project {
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

function mapAgentRow(row: Record<string, unknown>): Agent {
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

function mapWorktreeRow(row: Record<string, unknown>): Worktree {
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

function mapTokenUsageRow(row: Record<string, unknown>): TokenUsage {
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

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function listProjects(db: Database.Database): Project[] {
  const rows = db.prepare("SELECT * FROM projects ORDER BY last_opened_at DESC").all();
  return (rows as Record<string, unknown>[]).map(mapProjectRow);
}

export function getProject(db: Database.Database, id: string): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return row ? mapProjectRow(row as Record<string, unknown>) : null;
}

export function createProject(db: Database.Database, data: ProjectCreate): Project {
  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(
    `INSERT INTO projects (id, name, path, git_remote, default_branch, default_ide, created_at, last_opened_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, data.name, data.path, data.gitRemote, data.defaultBranch, data.defaultIde, now, now);

  // biome-ignore lint/style/noNonNullAssertion: row was just inserted
  return getProject(db, id)!;
}

export function updateProjectLastOpened(db: Database.Database, id: string): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE projects SET last_opened_at = ? WHERE id = ?").run(now, id);
}

export function deleteProject(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export function listAgents(db: Database.Database, projectId: string): Agent[] {
  const rows = db
    .prepare("SELECT * FROM agents WHERE project_id = ? ORDER BY started_at DESC")
    .all(projectId);
  return (rows as Record<string, unknown>[]).map(mapAgentRow);
}

export function getAgent(db: Database.Database, id: string): Agent | null {
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
  return row ? mapAgentRow(row as Record<string, unknown>) : null;
}

export function createAgent(db: Database.Database, data: AgentCreate): Agent {
  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(
    `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at)
     VALUES (?, ?, ?, 'spawning', ?, ?)`,
  ).run(id, data.projectId, data.cliType, data.taskDescription, now);

  // biome-ignore lint/style/noNonNullAssertion: row was just inserted
  return getAgent(db, id)!;
}

export function updateAgentStatus(
  db: Database.Database,
  id: string,
  status: AgentStatus,
  currentStep?: string,
): void {
  if (currentStep !== undefined) {
    db.prepare("UPDATE agents SET status = ?, current_step = ? WHERE id = ?").run(
      status,
      currentStep,
      id,
    );
  } else {
    db.prepare("UPDATE agents SET status = ? WHERE id = ?").run(status, id);
  }
}

export function stopAgent(
  db: Database.Database,
  id: string,
  status: AgentStatus = "completed",
): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    "UPDATE agents SET status = ?, stopped_at = ?, pid = NULL, current_step = NULL WHERE id = ?",
  ).run(status, now, id);
}

export function setAgentWorktree(db: Database.Database, agentId: string, worktreeId: string): void {
  db.prepare("UPDATE agents SET worktree_id = ? WHERE id = ?").run(worktreeId, agentId);
}

export function setAgentPid(db: Database.Database, agentId: string, pid: number): void {
  db.prepare("UPDATE agents SET pid = ? WHERE id = ?").run(pid, agentId);
}

// ---------------------------------------------------------------------------
// Recent Sessions
// ---------------------------------------------------------------------------

export interface RecentSessionRow {
  id: string;
  taskDescription: string;
  cliType: string;
  status: string;
  startedAt: number | null;
  stoppedAt: number | null;
  projectName: string;
  projectId: string;
}

export function listRecentSessions(db: Database.Database, limit = 10): RecentSessionRow[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.task_description, a.cli_type, a.status, a.started_at, a.stopped_at,
              p.name as project_name, p.id as project_id
       FROM agents a
       JOIN projects p ON a.project_id = p.id
       WHERE a.status IN ('completed', 'failed', 'stopped')
       ORDER BY a.stopped_at DESC
       LIMIT ?`,
    )
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    taskDescription: r.task_description as string,
    cliType: r.cli_type as string,
    status: r.status as string,
    startedAt: (r.started_at as number) ?? null,
    stoppedAt: (r.stopped_at as number) ?? null,
    projectName: r.project_name as string,
    projectId: r.project_id as string,
  }));
}

/** Mark any agents still in active status as 'stopped' — their processes died with the app */
export function cleanupStaleAgents(db: Database.Database): void {
  db.prepare(
    "UPDATE agents SET status = 'stopped', stopped_at = ?, current_step = NULL, pid = NULL WHERE status IN ('running', 'spawning', 'waiting_input')",
  ).run(Math.floor(Date.now() / 1000));
}

// ---------------------------------------------------------------------------
// Worktrees
// ---------------------------------------------------------------------------

export function listWorktrees(db: Database.Database, projectId: string): Worktree[] {
  const rows = db
    .prepare("SELECT * FROM worktrees WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId);
  return (rows as Record<string, unknown>[]).map(mapWorktreeRow);
}

export function createWorktree(
  db: Database.Database,
  data: {
    projectId: string;
    agentId: string | null;
    path: string;
    branchName: string;
    autoCleanup?: boolean;
  },
): Worktree {
  const id = nanoid();

  db.prepare(
    `INSERT INTO worktrees (id, project_id, agent_id, path, branch_name, auto_cleanup)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, data.projectId, data.agentId, data.path, data.branchName, data.autoCleanup ? 1 : 0);

  const row = db.prepare("SELECT * FROM worktrees WHERE id = ?").get(id);
  return mapWorktreeRow(row as Record<string, unknown>);
}

export function removeWorktree(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM worktrees WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Token Usage
// ---------------------------------------------------------------------------

export function recordTokenUsage(
  db: Database.Database,
  data: Omit<TokenUsage, "id" | "recordedAt">,
): void {
  const id = nanoid();
  db.prepare(
    `INSERT INTO token_usage (id, agent_id, provider, model, input_tokens, output_tokens, estimated_cost_usd, tool_call_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.agentId,
    data.provider,
    data.model,
    data.inputTokens,
    data.outputTokens,
    data.estimatedCostUsd,
    data.toolCallCount,
  );
}

export function getTokenUsageSummary(
  db: Database.Database,
  agentId: string,
  since: number,
): TokenUsageSummary {
  const now = Math.floor(Date.now() / 1000);
  const row = db
    .prepare(
      `SELECT
        COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
        COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
        COALESCE(SUM(estimated_cost_usd), 0.0) AS total_cost_usd,
        COALESCE(SUM(tool_call_count), 0) AS total_tool_calls
      FROM token_usage
      WHERE agent_id = ? AND recorded_at >= ?`,
    )
    .get(agentId, since) as Record<string, unknown>;

  return {
    totalInputTokens: (row.total_input_tokens as number) ?? 0,
    totalOutputTokens: (row.total_output_tokens as number) ?? 0,
    totalCostUsd: (row.total_cost_usd as number) ?? 0,
    totalToolCalls: (row.total_tool_calls as number) ?? 0,
    periodStart: since,
    periodEnd: now,
  };
}

export function getProjectTokenUsageSummary(
  db: Database.Database,
  projectId: string,
  since: number,
): TokenUsageSummary {
  const now = Math.floor(Date.now() / 1000);
  const row = db
    .prepare(
      `SELECT
        COALESCE(SUM(t.input_tokens), 0) AS total_input_tokens,
        COALESCE(SUM(t.output_tokens), 0) AS total_output_tokens,
        COALESCE(SUM(t.estimated_cost_usd), 0.0) AS total_cost_usd,
        COALESCE(SUM(t.tool_call_count), 0) AS total_tool_calls
      FROM token_usage t
      JOIN agents a ON a.id = t.agent_id
      WHERE a.project_id = ? AND t.recorded_at >= ?`,
    )
    .get(projectId, since) as Record<string, unknown>;

  return {
    totalInputTokens: (row.total_input_tokens as number) ?? 0,
    totalOutputTokens: (row.total_output_tokens as number) ?? 0,
    totalCostUsd: (row.total_cost_usd as number) ?? 0,
    totalToolCalls: (row.total_tool_calls as number) ?? 0,
    periodStart: since,
    periodEnd: now,
  };
}

export function getProjectTokenUsage(
  db: Database.Database,
  projectId: string,
  days: number,
): TokenUsage[] {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const rows = db
    .prepare(
      `SELECT t.* FROM token_usage t
       JOIN agents a ON a.id = t.agent_id
       WHERE a.project_id = ? AND t.recorded_at >= ?
       ORDER BY t.recorded_at DESC`,
    )
    .all(projectId, since);
  return (rows as Record<string, unknown>[]).map(mapTokenUsageRow);
}
