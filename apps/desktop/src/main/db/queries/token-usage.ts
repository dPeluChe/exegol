import type { TokenUsage, TokenUsageSummary } from "@exegol/shared";
import type Database from "libsql";
import { mapTokenUsageRow, nanoid } from "./helpers";

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
