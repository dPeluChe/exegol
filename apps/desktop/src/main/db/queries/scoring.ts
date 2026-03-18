import type { AgentScoreRow, ScoringStats } from "@exegol/shared";
import type Database from "libsql";

// ─── Row mapper ─────────────────────────────────────────────────────────────

export function mapScoreRow(row: Record<string, unknown>): AgentScoreRow {
  return {
    agentId: row.agent_id as string,
    filesChanged: row.files_changed as number,
    compiles: row.compiles === null ? null : Boolean(row.compiles),
    testsPassed: row.tests_passed === null ? null : Boolean(row.tests_passed),
    taskCompleted: Boolean(row.task_completed),
    exitCode: row.exit_code as number,
    exitReason: row.exit_reason as AgentScoreRow["exitReason"],
    turnsUsed: row.turns_used as number,
    tokensSpent: row.tokens_spent as number,
    filesModifiedCount: row.files_modified_count as number,
    overallScore: row.overall_score as number,
    scoredAt: row.scored_at as number,
  };
}

// ─── Queries ────────────────────────────────────────────────────────────────

export function getAgentScore(db: Database.Database, agentId: string): AgentScoreRow | null {
  const row = db.prepare("SELECT * FROM agent_scores WHERE agent_id = ?").get(agentId);
  return row ? mapScoreRow(row as Record<string, unknown>) : null;
}

export function listProjectScores(db: Database.Database, projectId: string): AgentScoreRow[] {
  const rows = db
    .prepare(
      `SELECT s.* FROM agent_scores s
       JOIN agents a ON s.agent_id = a.id
       WHERE a.project_id = ?
       ORDER BY s.scored_at DESC`,
    )
    .all(projectId) as Record<string, unknown>[];
  return rows.map(mapScoreRow);
}

export function getProjectScoringStats(db: Database.Database, projectId: string): ScoringStats {
  const overallRow = db
    .prepare(
      `SELECT
         COUNT(*) as total,
         AVG(s.overall_score) as avg_score,
         AVG(CASE WHEN s.exit_reason = 'success' THEN 1.0 ELSE 0.0 END) as success_rate,
         AVG(s.turns_used) as avg_turns,
         AVG(s.tokens_spent) as avg_tokens
       FROM agent_scores s
       JOIN agents a ON s.agent_id = a.id
       WHERE a.project_id = ?`,
    )
    .get(projectId) as Record<string, unknown>;

  const byCliRows = db
    .prepare(
      `SELECT
         a.cli_type,
         COUNT(*) as count,
         AVG(s.overall_score) as avg_score,
         AVG(CASE WHEN s.exit_reason = 'success' THEN 1.0 ELSE 0.0 END) as success_rate
       FROM agent_scores s
       JOIN agents a ON s.agent_id = a.id
       WHERE a.project_id = ?
       GROUP BY a.cli_type
       ORDER BY count DESC`,
    )
    .all(projectId) as Record<string, unknown>[];

  return {
    totalScored: (overallRow.total as number) ?? 0,
    avgScore: Math.round(((overallRow.avg_score as number) ?? 0) * 100) / 100,
    successRate: Math.round(((overallRow.success_rate as number) ?? 0) * 100) / 100,
    avgTurns: Math.round((overallRow.avg_turns as number) ?? 0),
    avgTokens: Math.round((overallRow.avg_tokens as number) ?? 0),
    byCliType: byCliRows.map((r) => ({
      cliType: r.cli_type as string,
      count: r.count as number,
      avgScore: Math.round(((r.avg_score as number) ?? 0) * 100) / 100,
      successRate: Math.round(((r.success_rate as number) ?? 0) * 100) / 100,
    })),
  };
}
