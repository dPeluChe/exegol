/**
 * Quality Scoring Engine for Agent Output
 *
 * 3-tier approach inspired by gstack's test pyramid:
 * - Tier 1 (free, auto): Parse stdout for files_changed, compiles, tests_pass, task_completed
 * - Tier 2 (structured): exit_reason, turns_used, tokens_spent, files_modified_count
 * - Tier 3 (future): LLM-as-judge quality eval (optional, gated behind API key)
 *
 * Non-fatal: scoring never blocks agent completion (best-effort, try/catch).
 */

import type Database from "libsql";
import { logger } from "../lib/logger";

// ─── Score Types ────────────────────────────────────────────────────────────

export interface AgentScore {
  agentId: string;
  /** Tier 1: auto-detected from stdout */
  filesChanged: number;
  compiles: boolean | null; // null = unknown
  testsPassed: boolean | null;
  taskCompleted: boolean;
  /** Tier 2: structured metrics */
  exitCode: number;
  exitReason: "success" | "failure" | "stopped" | "timeout" | "unknown";
  turnsUsed: number;
  tokensSpent: number;
  filesModifiedCount: number;
  /** Composite score 0.0–1.0 */
  overallScore: number;
  scoredAt: number;
}

// ─── Stdout Parsing (Tier 1) ────────────────────────────────────────────────

interface Tier1Result {
  filesChanged: number;
  compiles: boolean | null;
  testsPassed: boolean | null;
  taskCompleted: boolean;
  turnsUsed: number;
  filesModifiedCount: number;
}

/**
 * Parse agent scrollback for Tier 1 quality signals.
 * Works across CLI types by scanning for common patterns.
 */
export function parseTier1FromScrollback(scrollback: string): Tier1Result {
  const lines = scrollback.split("\n");
  const result: Tier1Result = {
    filesChanged: 0,
    compiles: null,
    testsPassed: null,
    taskCompleted: false,
    turnsUsed: 0,
    filesModifiedCount: 0,
  };

  const modifiedFiles = new Set<string>();
  let turnCount = 0;

  for (const raw of lines) {
    const line = stripAnsi(raw);

    // ── File modifications ────────────────────────────────────────────
    // Claude Code: "Edit(path)", "Write(path)"
    const editMatch = line.match(/\b(?:Edit|Write)\s*\(\s*([^)]+)\)/i);
    if (editMatch?.[1]) {
      modifiedFiles.add(editMatch[1].trim());
    }
    // Aider: "Applied edit to path"
    const aiderEdit = line.match(/applied edit to\s+(.+)/i);
    if (aiderEdit?.[1]) {
      modifiedFiles.add(aiderEdit[1].trim());
    }

    // ── Compilation / build detection ─────────────────────────────────
    if (/\bbuild succeeded\b|compiled successfully|compilation succeeded/i.test(line)) {
      result.compiles = true;
    }
    if (/\bbuild failed\b|compilation failed|compile error|tsc.*error/i.test(line)) {
      result.compiles = false;
    }

    // ── Test detection ────────────────────────────────────────────────
    if (/\btests?\s+passed\b|all tests pass|\bpassing\b.*\d+\s+test/i.test(line)) {
      result.testsPassed = true;
    }
    if (/\btests?\s+failed\b|\d+\s+failing\b|FAIL\s+/i.test(line)) {
      result.testsPassed = false;
    }

    // ── Task completion signals ───────────────────────────────────────
    // Claude Code: specific completion messages
    if (/\btask completed\b|successfully completed|done!/i.test(line)) {
      result.taskCompleted = true;
    }

    // ── Turn counting (tool call blocks) ──────────────────────────────
    // Claude Code tool calls indicate a "turn"
    if (/\b(?:Read|Edit|Write|Bash|Agent|Glob|Grep)\s*\(/i.test(line)) {
      turnCount++;
    }
  }

  result.filesChanged = modifiedFiles.size;
  result.filesModifiedCount = modifiedFiles.size;
  result.turnsUsed = turnCount;

  return result;
}

// ─── Tier 2: Structured Metrics ─────────────────────────────────────────────

function resolveExitReason(exitCode: number, agentStatus: string): AgentScore["exitReason"] {
  if (agentStatus === "completed" && exitCode === 0) return "success";
  if (agentStatus === "stopped") return "stopped";
  if (agentStatus === "failed") return "failure";
  if (exitCode !== 0) return "failure";
  return "unknown";
}

// ─── Composite Score Calculation ────────────────────────────────────────────

/**
 * Calculate overall score 0.0–1.0 from tier 1 + tier 2 signals.
 * Inspired by ClawWork's weighted rubric:
 * - Completeness (40%): task_completed, exit_reason
 * - Correctness (30%): compiles, tests_pass
 * - Efficiency (20%): turns_used relative, files_changed
 * - Quality (10%): clean exit, no failures
 */
function calculateOverallScore(tier1: Tier1Result, exitCode: number, exitReason: string): number {
  let score = 0;

  // Completeness (40%)
  const completeness =
    (tier1.taskCompleted ? 0.6 : 0) +
    (exitReason === "success" ? 0.4 : exitReason === "stopped" ? 0.1 : 0);
  score += completeness * 0.4;

  // Correctness (30%)
  let correctness = 0.5; // unknown baseline
  if (tier1.compiles === true) correctness += 0.25;
  if (tier1.compiles === false) correctness -= 0.3;
  if (tier1.testsPassed === true) correctness += 0.25;
  if (tier1.testsPassed === false) correctness -= 0.3;
  score += Math.max(0, Math.min(1, correctness)) * 0.3;

  // Efficiency (20%) — having changes is better than no changes for a task
  const hasWork = tier1.filesChanged > 0 ? 0.7 : 0;
  const reasonableTurns = tier1.turnsUsed > 0 && tier1.turnsUsed < 500 ? 0.3 : 0;
  score += (hasWork + reasonableTurns) * 0.2;

  // Quality (10%) — clean exit
  const quality = exitCode === 0 ? 1.0 : exitCode === 1 ? 0.3 : 0;
  score += quality * 0.1;

  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
}

// ─── Main Scoring Entry Point ───────────────────────────────────────────────

/**
 * Score an agent session after completion. Non-fatal: always wrapped in try/catch.
 */
export function scoreAgent(
  db: Database.Database,
  agentId: string,
  exitCode: number,
  agentStatus: string,
  scrollback: string,
): void {
  try {
    // Get token usage for this agent
    const tokenRow = db
      .prepare(
        "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total FROM token_usage WHERE agent_id = ?",
      )
      .get(agentId) as { total: number } | undefined;

    const tokensSpent = tokenRow?.total ?? 0;
    const tier1 = parseTier1FromScrollback(scrollback);
    const exitReason = resolveExitReason(exitCode, agentStatus);
    const overallScore = calculateOverallScore(tier1, exitCode, exitReason);

    const now = Math.floor(Date.now() / 1000);

    db.prepare(
      `INSERT OR REPLACE INTO agent_scores
       (agent_id, files_changed, compiles, tests_passed, task_completed,
        exit_code, exit_reason, turns_used, tokens_spent, files_modified_count,
        overall_score, scored_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      agentId,
      tier1.filesChanged,
      tier1.compiles === null ? null : tier1.compiles ? 1 : 0,
      tier1.testsPassed === null ? null : tier1.testsPassed ? 1 : 0,
      tier1.taskCompleted ? 1 : 0,
      exitCode,
      exitReason,
      tier1.turnsUsed,
      tokensSpent,
      tier1.filesModifiedCount,
      overallScore,
      now,
    );

    logger.info("[Scoring] Agent scored:", {
      agentId,
      overallScore,
      exitReason,
      filesChanged: tier1.filesChanged,
      taskCompleted: tier1.taskCompleted,
    });
  } catch (err) {
    // Non-fatal: scoring never blocks agent completion
    logger.error("[Scoring] Failed to score agent (non-fatal):", err);
  }
}

// ─── Query Helpers ──────────────────────────────────────────────────────────

export interface AgentScoreRow {
  agentId: string;
  filesChanged: number;
  compiles: boolean | null;
  testsPassed: boolean | null;
  taskCompleted: boolean;
  exitCode: number;
  exitReason: string;
  turnsUsed: number;
  tokensSpent: number;
  filesModifiedCount: number;
  overallScore: number;
  scoredAt: number;
}

export function mapScoreRow(row: Record<string, unknown>): AgentScoreRow {
  return {
    agentId: row.agent_id as string,
    filesChanged: row.files_changed as number,
    compiles: row.compiles === null ? null : Boolean(row.compiles),
    testsPassed: row.tests_passed === null ? null : Boolean(row.tests_passed),
    taskCompleted: Boolean(row.task_completed),
    exitCode: row.exit_code as number,
    exitReason: row.exit_reason as string,
    turnsUsed: row.turns_used as number,
    tokensSpent: row.tokens_spent as number,
    filesModifiedCount: row.files_modified_count as number,
    overallScore: row.overall_score as number,
    scoredAt: row.scored_at as number,
  };
}

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

export interface ScoringStats {
  totalScored: number;
  avgScore: number;
  successRate: number;
  avgTurns: number;
  avgTokens: number;
  byCliType: Array<{
    cliType: string;
    count: number;
    avgScore: number;
    successRate: number;
  }>;
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape sequence stripping
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}
