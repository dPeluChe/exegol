import type { LoserCleanupResult, ParallelRun } from "@exegol/shared";
import type Database from "libsql";
import { getAgent, getProject } from "../db/queries";
import { getWorktreeByAgentId, removeWorktree } from "../db/queries/worktrees";
import { logger } from "../lib/logger";
import { coreRust } from "./spawn-env";
import { removeManagedWorktree } from "./worktrees";

const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped", "crashed", "idle"]);

/**
 * T131 — race mode polish. Promoting a winner never touches `main` by
 * itself (defer mode is the only mode: the winner's worktree/branch is left
 * for the user to merge/PR via the Smart Git Button, same as any other
 * agent). This module only cleans up the losers.
 */

/**
 * Remove every non-winner agent's worktree + branch from a parallel run.
 * Dirty worktrees are skipped unless `force` is set — callers should surface
 * those back to the user as a prompt ("these have uncommitted changes,
 * delete anyway?") rather than silently discarding work.
 */
export function cleanupLoserWorktrees(
  db: Database.Database,
  run: ParallelRun,
  winnerAgentId: string,
  opts: { force?: boolean } = {},
): LoserCleanupResult[] {
  const project = getProject(db, run.projectId);
  const results: LoserCleanupResult[] = [];

  for (const agentId of run.agentIds) {
    if (agentId === winnerAgentId) continue;

    const worktree = getWorktreeByAgentId(db, agentId);
    if (!worktree) {
      results.push({ agentId, worktreePath: null, branchName: null, cleaned: false, dirty: false });
      continue;
    }

    if (!coreRust || !project) {
      results.push({
        agentId,
        worktreePath: worktree.path,
        branchName: worktree.branchName,
        cleaned: false,
        dirty: false,
        error: "Native git module or project unavailable",
      });
      continue;
    }

    // Never rm -rf under a live agent: the UI disables Promote while running,
    // but a second window / stale cache / direct IPC call can still reach here.
    const agent = getAgent(db, agentId);
    if (agent && !TERMINAL_STATUSES.has(agent.status)) {
      results.push({
        agentId,
        worktreePath: worktree.path,
        branchName: worktree.branchName,
        cleaned: false,
        dirty: false,
        error: `Agent still ${agent.status} — stop it before cleanup`,
      });
      continue;
    }

    // Fail-SAFE: if the dirty check itself fails (locked/corrupt git dir), we
    // cannot prove the worktree is clean — treat it as dirty and let the user
    // decide, instead of deleting possibly-uncommitted work.
    let dirty = true;
    try {
      dirty = coreRust.worktreeHasChanges(worktree.path);
    } catch (err) {
      logger.warn("[RaceMode] worktreeHasChanges check failed, treating as DIRTY:", err);
    }

    if (dirty && !opts.force) {
      results.push({
        agentId,
        worktreePath: worktree.path,
        branchName: worktree.branchName,
        cleaned: false,
        dirty: true,
      });
      continue;
    }

    try {
      const worktreeName = worktree.path.replace(/\/+$/, "").split("/").pop() ?? "";
      // force only when the user explicitly confirmed deleting dirty state —
      // the clean path respects git's own guards (worktree locks).
      removeManagedWorktree(project.path, worktreeName, worktree.path, opts.force ?? false);
      try {
        coreRust.deleteBranch(project.path, worktree.branchName, true);
      } catch (err) {
        logger.warn(`[RaceMode] Branch delete failed for '${worktree.branchName}':`, err);
      }
      removeWorktree(db, worktree.id);
      results.push({
        agentId,
        worktreePath: worktree.path,
        branchName: worktree.branchName,
        cleaned: true,
        dirty,
      });
    } catch (err) {
      results.push({
        agentId,
        worktreePath: worktree.path,
        branchName: worktree.branchName,
        cleaned: false,
        dirty,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
