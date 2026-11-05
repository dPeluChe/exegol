import type { TokenUsageSummary } from "@exegol/shared";
import type Database from "libsql";
import type { ParsedTokenEntry } from "../../tokens/log-parser";
import type { UsageRow } from "../../tokens/usage-aggregation";

/** Every agent and log scan, all projects */
export function getAllTokenUsageSummary(db: Database.Database, since: number): TokenUsageSummary {
  const row = db
    .prepare(
      `SELECT
        COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
        COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
        COALESCE(SUM(estimated_cost_usd), 0.0) AS total_cost_usd,
        COALESCE(SUM(tool_call_count), 0) AS total_tool_calls
      FROM token_usage
      WHERE recorded_at >= ?`,
    )
    .get(since) as Record<string, number>;
  return {
    totalInputTokens: row.total_input_tokens ?? 0,
    totalOutputTokens: row.total_output_tokens ?? 0,
    totalCostUsd: row.total_cost_usd ?? 0,
    totalToolCalls: row.total_tool_calls ?? 0,
    periodStart: since,
    periodEnd: Math.floor(Date.now() / 1000),
  };
}

// ─── T147: Per-pipeline-run cost (backend only — no T130 evidence UI yet) ──

interface PipelineRunStepCost {
  stepIndex: number;
  agentId: string | null;
  cost: number;
  tokens: number;
}

interface PipelineRunCost {
  totalCost: number;
  totalTokens: number;
  perStep: PipelineRunStepCost[];
}

export function getPipelineRunCost(db: Database.Database, pipelineRunId: string): PipelineRunCost {
  const row = db
    .prepare("SELECT step_results FROM pipeline_runs WHERE id = ?")
    .get(pipelineRunId) as { step_results: string } | undefined;
  if (!row) return { totalCost: 0, totalTokens: 0, perStep: [] };

  let steps: { stepIndex: number; agentId: string | null }[] = [];
  try {
    steps = JSON.parse(row.step_results);
  } catch {
    return { totalCost: 0, totalTokens: 0, perStep: [] };
  }

  const usageStmt = db.prepare(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0.0) AS cost,
      COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
     FROM token_usage WHERE agent_id = ?`,
  );

  const perStep: PipelineRunStepCost[] = steps.map((s) => {
    if (!s.agentId) return { stepIndex: s.stepIndex, agentId: null, cost: 0, tokens: 0 };
    const usage = usageStmt.get(s.agentId) as { cost: number; tokens: number };
    return { stepIndex: s.stepIndex, agentId: s.agentId, cost: usage.cost, tokens: usage.tokens };
  });

  return {
    totalCost: perStep.reduce((sum, s) => sum + s.cost, 0),
    totalTokens: perStep.reduce((sum, s) => sum + s.tokens, 0),
    perStep,
  };
}

const IMPORT_CHUNK = 2000;

/**
 * Upserts on dedup_key: a rescan re-sends the whole window and unchanged rows are skipped.
 * Entries with no project (projectOf null) are skipped too.
 * Chunked transactions with a yield between, so a large import never holds main for long.
 */
export async function importScannedTokenUsage(
  db: Database.Database,
  entries: ParsedTokenEntry[],
  projectOf: (entry: ParsedTokenEntry) => string | null,
): Promise<{ imported: number; skipped: number }> {
  const upsert = db.prepare(
    `INSERT INTO token_usage (id, project_id, provider, model, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, estimated_cost_usd, cost_source, tool_call_count,
       recorded_at, source, dedup_key, session_id)
     VALUES (lower(hex(randomblob(10))), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'log_scan', ?, ?)
     ON CONFLICT(dedup_key) DO UPDATE SET
       project_id = excluded.project_id, model = excluded.model,
       input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
       cache_read_tokens = excluded.cache_read_tokens,
       cache_write_tokens = excluded.cache_write_tokens,
       estimated_cost_usd = excluded.estimated_cost_usd, cost_source = excluded.cost_source,
       tool_call_count = excluded.tool_call_count, recorded_at = excluded.recorded_at,
       session_id = excluded.session_id
     WHERE input_tokens != excluded.input_tokens OR output_tokens != excluded.output_tokens
       OR cache_read_tokens != excluded.cache_read_tokens
       OR cache_write_tokens != excluded.cache_write_tokens
       OR model != excluded.model OR estimated_cost_usd != excluded.estimated_cost_usd
       OR cost_source != excluded.cost_source OR project_id IS NOT excluded.project_id
       OR session_id IS NOT excluded.session_id`,
  );
  const importChunk = db.transaction((chunk: ParsedTokenEntry[]) => {
    let changed = 0;
    for (const e of chunk) {
      const projectId = projectOf(e);
      if (!projectId) continue;
      changed += upsert.run(
        projectId,
        e.provider,
        e.model,
        e.inputTokens,
        e.outputTokens,
        e.cacheReadTokens,
        e.cacheWriteTokens,
        e.estimatedCostUsd,
        e.costSource,
        e.toolCallCount,
        Math.floor(e.timestamp),
        e.key,
        e.sessionId ?? null,
      ).changes;
    }
    return changed;
  });
  let imported = 0;
  for (let i = 0; i < entries.length; i += IMPORT_CHUNK) {
    if (i > 0) await new Promise((resolve) => setImmediate(resolve));
    imported += importChunk(entries.slice(i, i + IMPORT_CHUNK)) as number;
  }
  return { imported, skipped: entries.length - imported };
}

const CLI_SQL = `CASE
    WHEN t.agent_id IS NOT NULL THEN COALESCE(a.cli_type, 'unknown')
    WHEN t.dedup_key LIKE 'claude:%' THEN 'claude-code'
    WHEN t.dedup_key LIKE 'codex:%' THEN 'codex'
    WHEN t.dedup_key LIKE 'aider:%' THEN 'aider'
    ELSE 'unknown'
  END`;

/** App-wide rows in [since, until), grouped for aggregateUsage; days in local time */
export function listUsageRows(
  db: Database.Database,
  since: number,
  until: number,
  projectId?: string,
): UsageRow[] {
  // Spelled out instead of COALESCE, which no index can serve
  const inProject = projectId
    ? `AND (t.project_id = ? OR (t.project_id IS NULL
        AND t.agent_id IN (SELECT id FROM agents WHERE project_id = ?)))`
    : "";
  const params = projectId ? [since, until, projectId, projectId] : [since, until];
  return db
    .prepare(
      `SELECT COALESCE(t.project_id, a.project_id) AS projectId,
        COALESCE(p.name, '') AS projectName,
        ${CLI_SQL} AS cli,
        t.provider AS provider, t.model AS model,
        date(t.recorded_at, 'unixepoch', 'localtime') AS date,
        t.cost_source AS costSource,
        COALESCE(t.agent_id, t.session_id, '') AS session,
        SUM(t.tool_call_count) AS toolCalls,
        SUM(t.input_tokens) AS inputTokens, SUM(t.output_tokens) AS outputTokens,
        SUM(t.cache_read_tokens) AS cacheReadTokens,
        SUM(t.cache_write_tokens) AS cacheWriteTokens,
        SUM(t.estimated_cost_usd) AS costUsd, COUNT(*) AS records
       FROM token_usage t
       LEFT JOIN agents a ON a.id = t.agent_id
       LEFT JOIN projects p ON p.id = COALESCE(t.project_id, a.project_id)
       WHERE t.recorded_at >= ? AND t.recorded_at < ? ${inProject}
       GROUP BY 1, 2, 3, 4, 5, 6, 7, 8`,
    )
    .all(...params) as UsageRow[];
}

/** Spend per CLI, with what `isUnpriced` needs; the limits read only this */
export function listCliSpendRows(
  db: Database.Database,
  since: number,
  until: number,
): { cli: string; model: string; costSource: string; costUsd: number }[] {
  return db
    .prepare(
      `SELECT ${CLI_SQL} AS cli, t.model AS model, t.cost_source AS costSource,
        SUM(t.estimated_cost_usd) AS costUsd
       FROM token_usage t
       LEFT JOIN agents a ON a.id = t.agent_id
       WHERE t.recorded_at >= ? AND t.recorded_at < ?
       GROUP BY 1, 2, 3`,
    )
    .all(since, until) as { cli: string; model: string; costSource: string; costUsd: number }[];
}

/** A name per session key (agent id or Claude session id): alias, else the task */
export function usageSessionLabels(db: Database.Database, keys: string[]): Map<string, string> {
  if (keys.length === 0) return new Map();
  const marks = keys.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, claude_session_id AS claudeSessionId, alias, task_description AS task
       FROM agents WHERE id IN (${marks}) OR claude_session_id IN (${marks})`,
    )
    .all(...keys, ...keys) as {
    id: string;
    claudeSessionId: string | null;
    alias: string | null;
    task: string;
  }[];
  const labels = new Map<string, string>();
  for (const r of rows) {
    const label = r.alias ?? r.task;
    labels.set(r.id, label);
    if (r.claudeSessionId) labels.set(r.claudeSessionId, label);
  }
  return labels;
}
