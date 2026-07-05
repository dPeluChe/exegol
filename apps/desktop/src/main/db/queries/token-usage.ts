import type {
  AgentCostRow,
  DailyTrendRow,
  ModelBreakdownRow,
  TokenUsage,
  TokenUsageSummary,
} from "@exegol/shared";
import type Database from "libsql";
import { mapTokenUsageRow } from "./helpers";

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
  // Include both agent-linked entries and scan-imported entries
  const row = db
    .prepare(
      `SELECT
        COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
        COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
        COALESCE(SUM(estimated_cost_usd), 0.0) AS total_cost_usd,
        COALESCE(SUM(tool_call_count), 0) AS total_tool_calls
      FROM token_usage
      WHERE (agent_id IN (SELECT id FROM agents WHERE project_id = ?) OR agent_id = ?)
        AND recorded_at >= ?`,
    )
    .get(projectId, `scan:${projectId}`, since) as Record<string, unknown>;

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
  // Include both agent-linked entries and scan-imported entries
  const rows = db
    .prepare(
      `SELECT * FROM token_usage
       WHERE (agent_id IN (SELECT id FROM agents WHERE project_id = ?) OR agent_id = ?)
         AND recorded_at >= ?
       ORDER BY recorded_at DESC`,
    )
    .all(projectId, `scan:${projectId}`, since);
  return (rows as Record<string, unknown>[]).map(mapTokenUsageRow);
}

// ─── T19: Per-model breakdown ─────────────────────────────────────────────

export function getModelBreakdown(
  db: Database.Database,
  projectId: string,
  days: number,
): ModelBreakdownRow[] {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const rows = db
    .prepare(
      `SELECT model, provider,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(estimated_cost_usd), 0.0) AS total_cost,
        COUNT(*) AS request_count
       FROM token_usage
       WHERE (agent_id IN (SELECT id FROM agents WHERE project_id = ?) OR agent_id = ?)
         AND recorded_at >= ?
       GROUP BY model, provider
       ORDER BY total_cost DESC`,
    )
    .all(projectId, `scan:${projectId}`, since) as Record<string, unknown>[];

  return rows.map((r) => ({
    model: r.model as string,
    provider: r.provider as string,
    inputTokens: r.input_tokens as number,
    outputTokens: r.output_tokens as number,
    totalCost: r.total_cost as number,
    requestCount: r.request_count as number,
  }));
}

// ─── T19: Per-agent cost table ────────────────────────────────────────────

export function getAgentCosts(
  db: Database.Database,
  projectId: string,
  days: number,
): AgentCostRow[] {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const rows = db
    .prepare(
      `SELECT t.agent_id,
        a.cli_type, a.task_description,
        COALESCE(SUM(t.input_tokens + t.output_tokens), 0) AS total_tokens,
        COALESCE(SUM(t.estimated_cost_usd), 0.0) AS total_cost,
        COUNT(*) AS session_count
       FROM token_usage t
       JOIN agents a ON t.agent_id = a.id
       WHERE a.project_id = ? AND t.recorded_at >= ?
       GROUP BY t.agent_id
       ORDER BY total_cost DESC`,
    )
    .all(projectId, since) as Record<string, unknown>[];

  return rows.map((r) => ({
    agentId: r.agent_id as string,
    cliType: r.cli_type as string,
    taskDescription: r.task_description as string,
    totalTokens: r.total_tokens as number,
    totalCost: r.total_cost as number,
    sessionCount: r.session_count as number,
  }));
}

// ─── T19: Daily trend data ────────────────────────────────────────────────

export function getDailyTrend(
  db: Database.Database,
  projectId: string,
  days: number,
): DailyTrendRow[] {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const rows = db
    .prepare(
      `SELECT date(recorded_at, 'unixepoch') AS date,
        COALESCE(SUM(estimated_cost_usd), 0.0) AS total_cost,
        COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens,
        COUNT(*) AS request_count
       FROM token_usage
       WHERE (agent_id IN (SELECT id FROM agents WHERE project_id = ?) OR agent_id = ?)
         AND recorded_at >= ?
       GROUP BY date(recorded_at, 'unixepoch')
       ORDER BY date ASC`,
    )
    .all(projectId, `scan:${projectId}`, since) as Record<string, unknown>[];

  return rows.map((r) => ({
    date: r.date as string,
    totalCost: r.total_cost as number,
    totalTokens: r.total_tokens as number,
    requestCount: r.request_count as number,
  }));
}
