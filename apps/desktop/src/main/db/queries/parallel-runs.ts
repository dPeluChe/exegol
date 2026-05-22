import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Agent, AgentScoreRow, ParallelRun, ParallelRunStatus } from "@exegol/shared";
import type Database from "libsql";
import { coreRust } from "../../agents/spawn-env";
import { getScrollbackPath } from "../../ipc/procedures/scrollback";
import { logger } from "../../lib/logger";
import { getAgent } from "./agents";
import { mapScoreRow } from "./scoring";
import { getWorktreeByAgentId } from "./worktrees";

export function createParallelRun(
  db: Database.Database,
  data: {
    projectId: string;
    taskDescription: string;
    cliTypes: string[];
    agentIds: string[];
  },
): ParallelRun {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO parallel_runs (id, project_id, task_description, cli_types, agent_ids, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'running', ?)`,
  ).run(
    id,
    data.projectId,
    data.taskDescription,
    JSON.stringify(data.cliTypes),
    JSON.stringify(data.agentIds),
    now,
  );

  return {
    id,
    projectId: data.projectId,
    taskDescription: data.taskDescription,
    cliTypes: data.cliTypes,
    agentIds: data.agentIds,
    status: "running",
    promotedAgentId: null,
    createdAt: now,
    completedAt: null,
  };
}

export function getParallelRun(db: Database.Database, id: string): ParallelRun | null {
  const row = db.prepare("SELECT * FROM parallel_runs WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return mapParallelRunRow(row);
}

export function listParallelRuns(db: Database.Database, projectId: string): ParallelRun[] {
  const rows = db
    .prepare("SELECT * FROM parallel_runs WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Record<string, unknown>[];
  return rows.map(mapParallelRunRow);
}

export function updateParallelRunStatus(
  db: Database.Database,
  id: string,
  status: ParallelRunStatus,
): void {
  const completedAt = ["completed", "failed", "cancelled"].includes(status)
    ? Math.floor(Date.now() / 1000)
    : null;
  db.prepare("UPDATE parallel_runs SET status = ?, completed_at = ? WHERE id = ?").run(
    status,
    completedAt,
    id,
  );
}

export function promoteParallelRunAgent(
  db: Database.Database,
  runId: string,
  agentId: string,
): void {
  db.prepare(
    "UPDATE parallel_runs SET promoted_agent_id = ?, status = 'completed' WHERE id = ?",
  ).run(agentId, runId);
}

// ─── T107: Comparator enrichment ─────────────────────────────────────────

export interface ParallelRunColumn {
  agent: Agent;
  worktreePath: string | null;
  diffStat: { filesChanged: number; insertions: number; deletions: number } | null;
  score: AgentScoreRow | null;
  cost: { totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number } | null;
  durationSeconds: number | null;
  lastLines: string[];
}

export interface ParallelRunDetails {
  run: ParallelRun;
  columns: ParallelRunColumn[];
}

const LAST_LINES_COUNT = 10;

/**
 * Build a single-payload comparator view of a parallel run. One IPC round
 * trip → server-side N work → renderer just renders.
 */
export function enrichParallelRunForComparison(
  db: Database.Database,
  run: ParallelRun,
): ParallelRunDetails {
  const columns: ParallelRunColumn[] = [];
  for (const agentId of run.agentIds) {
    const agent = getAgent(db, agentId);
    if (!agent) continue;
    const worktree = getWorktreeByAgentId(db, agentId);
    const worktreePath = worktree?.path ?? null;
    columns.push({
      agent,
      worktreePath,
      diffStat: computeDiffStat(worktreePath),
      score: getScoreRow(db, agentId),
      cost: getCostSummary(db, agentId, run.createdAt),
      durationSeconds: computeDuration(agent),
      lastLines: tailScrollback(agentId, LAST_LINES_COUNT),
    });
  }
  return { run, columns };
}

function getScoreRow(db: Database.Database, agentId: string): AgentScoreRow | null {
  try {
    const row = db.prepare("SELECT * FROM agent_scores WHERE agent_id = ?").get(agentId);
    return row ? mapScoreRow(row as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function getCostSummary(
  db: Database.Database,
  agentId: string,
  since: number,
): { totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number } | null {
  try {
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(input_tokens), 0) AS total_input,
           COALESCE(SUM(output_tokens), 0) AS total_output,
           COALESCE(SUM(estimated_cost_usd), 0.0) AS total_cost
         FROM token_usage
         WHERE agent_id = ? AND recorded_at >= ?`,
      )
      .get(agentId, since) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      totalCostUsd: (row.total_cost as number) ?? 0,
      totalInputTokens: (row.total_input as number) ?? 0,
      totalOutputTokens: (row.total_output as number) ?? 0,
    };
  } catch {
    return null;
  }
}

function computeDuration(agent: Agent): number | null {
  if (!agent.startedAt) return null;
  const end = agent.stoppedAt ?? Math.floor(Date.now() / 1000);
  return Math.max(0, end - agent.startedAt);
}

function computeDiffStat(
  worktreePath: string | null,
): { filesChanged: number; insertions: number; deletions: number } | null {
  if (!worktreePath || !coreRust) return null;
  try {
    const files = coreRust.getDiff(worktreePath, false);
    let insertions = 0;
    let deletions = 0;
    for (const file of files) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (line.lineType === "addition") insertions++;
          else if (line.lineType === "deletion") deletions++;
        }
      }
    }
    return { filesChanged: files.length, insertions, deletions };
  } catch (err) {
    logger.warn("[enrichParallelRunForComparison] getDiff failed:", err);
    return null;
  }
}

function tailScrollback(agentId: string, lineCount: number): string[] {
  try {
    const path = getScrollbackPath(agentId);
    if (!existsSync(path)) return [];
    const content = readFileSync(path, "utf-8");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strip CSI escape sequences for a human-readable scrollback tail
    const stripped = content.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
    const lines = stripped.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return lines.slice(-lineCount);
  } catch {
    return [];
  }
}

function mapParallelRunRow(row: Record<string, unknown>): ParallelRun {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    taskDescription: row.task_description as string,
    cliTypes: JSON.parse((row.cli_types as string) || "[]"),
    agentIds: JSON.parse((row.agent_ids as string) || "[]"),
    status: row.status as ParallelRunStatus,
    promotedAgentId: (row.promoted_agent_id as string) ?? null,
    createdAt: row.created_at as number,
    completedAt: (row.completed_at as number) ?? null,
  };
}
