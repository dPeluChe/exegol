import type { AgentStatus, LoserCleanupResult, ParallelRunStatus } from "@exegol/shared";
import type Database from "libsql";
import { getParallelRun, updateParallelRunStatus } from "../db/queries/parallel-runs";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { cleanupLoserWorktrees } from "./race-mode";

const TERMINAL_STATUSES: ReadonlySet<AgentStatus> = new Set([
  "completed",
  "failed",
  "stopped",
  "crashed",
]);

interface AgentStatusRow {
  status: AgentStatus;
}

/**
 * Called after each agent's onExit completes. If the agent was part of a
 * parallel run AND all sibling agents are also in a terminal state, the run
 * transitions from `running` to a final status:
 *  - all `completed` → `completed`
 *  - none `completed` → `failed`
 *  - mixed         → `completed` (partial — user inspects via comparator)
 *
 * A run already in `completed`/`failed`/`cancelled` is left alone (idempotent).
 * Emits `parallel-run:changed` for renderers to refetch.
 */
export function handleParallelAgentExit(db: Database.Database, agentId: string): void {
  try {
    const row = db.prepare("SELECT parallel_run_id FROM agents WHERE id = ?").get(agentId) as
      | { parallel_run_id: string | null }
      | undefined;
    const runId = row?.parallel_run_id;
    if (!runId) return;

    const run = getParallelRun(db, runId);
    if (!run) return;
    if (run.status !== "running") return;
    // empty array → `WHERE id IN ()` is a SQLite syntax error
    if (run.agentIds.length === 0) return;

    const statuses = db
      .prepare(`SELECT status FROM agents WHERE id IN (${run.agentIds.map(() => "?").join(",")})`)
      .all(...run.agentIds) as AgentStatusRow[];

    // If every sibling has been deleted, don't flip the run to "failed"
    // vacuously via [].every(...). Leave it as-is for the user to resolve.
    if (statuses.length === 0) return;

    const allTerminal = statuses.every((s) => TERMINAL_STATUSES.has(s.status));
    if (!allTerminal) return;

    const completedCount = statuses.filter((s) => s.status === "completed").length;
    const nextStatus: ParallelRunStatus = completedCount > 0 ? "completed" : "failed";

    updateParallelRunStatus(db, runId, nextStatus);
    logger.info(
      `[ParallelOrchestration] Run ${runId} transitioned to ${nextStatus} (${completedCount}/${statuses.length} completed)`,
    );

    broadcast("parallel-run:changed", {
      runId,
      projectId: run.projectId,
      status: nextStatus,
      completedCount,
      totalCount: statuses.length,
      timestamp: Date.now(),
    });
  } catch (err) {
    // Non-fatal: DB may be closed during shutdown
    logger.warn(`[ParallelOrchestration] handleParallelAgentExit(${agentId}) skipped:`, err);
  }
}

/**
 * Promote an agent within a parallel run. Idempotent — calling twice with
 * the same agentId leaves the state unchanged. Side effects:
 *  - Marks the run as `completed` with `promoted_agent_id = X`
 *  - Winner's worktree/branch is never touched — defer mode: nothing lands
 *    on `main` until the user explicitly merges/PRs the winner themselves
 *  - T131: loser worktrees + branches are cleaned up unless `opts.clean` is
 *    false; dirty ones are skipped (returned in the report) unless `force`
 *  - Broadcasts `parallel-run:changed` so any open comparator refetches
 */
export function promoteParallelAgent(
  db: Database.Database,
  runId: string,
  agentId: string,
  opts: { clean?: boolean; force?: boolean } = {},
): LoserCleanupResult[] {
  const run = getParallelRun(db, runId);
  if (!run) {
    logger.warn(`[ParallelOrchestration] promote: run ${runId} not found`);
    return [];
  }
  if (!run.agentIds.includes(agentId)) {
    logger.warn(
      `[ParallelOrchestration] promote: agent ${agentId} not part of run ${runId} — ignored`,
    );
    return [];
  }
  db.prepare(
    "UPDATE parallel_runs SET promoted_agent_id = ?, status = 'completed', completed_at = COALESCE(completed_at, unixepoch()) WHERE id = ?",
  ).run(agentId, runId);

  broadcast("parallel-run:changed", {
    runId,
    projectId: run.projectId,
    status: "completed" as ParallelRunStatus,
    promotedAgentId: agentId,
    timestamp: Date.now(),
  });

  if (opts.clean === false) return [];

  const cleanup = cleanupLoserWorktrees(db, run, agentId, { force: opts.force });
  logger.info("[ParallelOrchestration] Promote & clean:", {
    runId,
    winner: agentId,
    cleaned: cleanup.filter((c) => c.cleaned).length,
    skippedDirty: cleanup.filter((c) => c.dirty && !c.cleaned).length,
  });
  return cleanup;
}
