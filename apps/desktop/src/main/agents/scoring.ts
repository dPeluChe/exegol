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

import type { ExitReason } from "@exegol/shared";
import type Database from "libsql";
import { TransientError } from "../lib/errors";
import { logger } from "../lib/logger";
import { getApiKey } from "../security/keystore";
import { stripAnsi } from "./status-parser";

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
    const editMatch = line.match(/\b(?:Edit|Write)\s*\(\s*([^)]+)\)/i);
    if (editMatch?.[1]) {
      modifiedFiles.add(editMatch[1].trim());
    }
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
    if (/\btask completed\b|successfully completed|done!/i.test(line)) {
      result.taskCompleted = true;
    }

    // ── Turn counting (tool call blocks) ──────────────────────────────
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

function resolveExitReason(exitCode: number, agentStatus: string): ExitReason {
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

  // Efficiency (20%)
  const hasWork = tier1.filesChanged > 0 ? 0.7 : 0;
  const reasonableTurns = tier1.turnsUsed > 0 && tier1.turnsUsed < 500 ? 0.3 : 0;
  score += (hasWork + reasonableTurns) * 0.2;

  // Quality (10%)
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

    // Tier 3 (async, non-blocking): LLM-as-judge quality eval
    evaluateTier3(db, agentId, scrollback).catch(() => {});
  } catch (err) {
    // Non-fatal: scoring never blocks agent completion
    logger.error("[Scoring] Failed to score agent (non-fatal):", err);
  }
}

// ─── Tier 3: LLM-as-Judge Quality Eval ──────────────────────────────────────

const TIER3_MAX_SCROLLBACK = 8000; // chars to send to judge (cost control)

/**
 * Optional LLM-as-judge evaluation. Gated behind Anthropic API key.
 * Uses claude-haiku for cost efficiency (~$0.001 per eval).
 */
async function evaluateTier3(
  db: Database.Database,
  agentId: string,
  scrollback: string,
): Promise<void> {
  const apiKey = getApiKey(db, "anthropic");
  if (!apiKey) return; // No API key — skip silently

  const cleanedScrollback = stripAnsi(scrollback).slice(-TIER3_MAX_SCROLLBACK);
  if (cleanedScrollback.length < 100) return; // Too short to evaluate

  try {
    const prompt = `You are evaluating the quality of an AI coding agent's work. Rate each dimension 1-5.

Agent output (last ${TIER3_MAX_SCROLLBACK} chars):
${cleanedScrollback}

Rate these dimensions (1=poor, 5=excellent):
1. Clarity: Is the agent's reasoning clear and well-structured?
2. Completeness: Did the agent finish what it set out to do?
3. Correctness: Does the work appear correct (no obvious bugs/errors)?

Respond with ONLY a JSON object: {"clarity":N,"completeness":N,"correctness":N}`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 100,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      throw new TransientError(`Tier 3 API error: ${res.status} ${res.statusText}`, "SCORING_API");
    }

    const response = (await res.json()) as { content?: Array<{ text?: string }> };
    const text = response?.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (!jsonMatch) return;

    const scores = JSON.parse(jsonMatch[0]) as {
      clarity: number;
      completeness: number;
      correctness: number;
    };

    // Validate scores are 1-5
    const valid = [scores.clarity, scores.completeness, scores.correctness].every(
      (s) => typeof s === "number" && s >= 1 && s <= 5,
    );
    if (!valid) return;

    const llmScore = (scores.clarity + scores.completeness + scores.correctness) / 15; // normalize to 0-1

    db.prepare(
      `UPDATE agent_scores SET
        llm_clarity = ?, llm_completeness = ?, llm_correctness = ?, llm_score = ?
      WHERE agent_id = ?`,
    ).run(scores.clarity, scores.completeness, scores.correctness, llmScore, agentId);

    logger.info("[Scoring] Tier 3 LLM eval:", {
      agentId,
      clarity: scores.clarity,
      completeness: scores.completeness,
      correctness: scores.correctness,
    });
  } catch (err) {
    // Non-fatal: LLM eval is best-effort
    logger.warn("[Scoring] Tier 3 eval failed (non-fatal):", err);
  }
}
