import type Database from "libsql";
import {
  clearAgentWorktree,
  removeWorktree as dbRemoveWorktree,
  getWorktreeByAgentId,
} from "../db/queries";
import { logger } from "../lib/logger";
import { loadLifecycleConfig, runLifecycleScript } from "../lifecycle/loader";
import { coreRust } from "./spawn-env";
import { getWorktreeName, removeManagedWorktree } from "./worktrees";

export interface WorktreeRecord {
  dbId: string;
  worktreeName: string;
  worktreePath: string;
  repoPath: string;
}

export function hydrateTrackedWorktree(
  db: Database.Database,
  agentId: string,
  worktrees: Map<string, WorktreeRecord>,
): void {
  if (worktrees.has(agentId)) return;
  const wt = getWorktreeByAgentId(db, agentId);
  if (!wt) return;

  const project = db.prepare("SELECT path FROM projects WHERE id = ?").get(wt.projectId) as
    | { path: string }
    | undefined;
  if (!project) return;

  worktrees.set(agentId, {
    dbId: wt.id,
    worktreeName: getWorktreeName(wt.branchName),
    worktreePath: wt.path,
    repoPath: project.path,
  });
}

export async function cleanupWorktree(
  db: Database.Database,
  agentId: string,
  worktrees: Map<string, WorktreeRecord>,
): Promise<void> {
  hydrateTrackedWorktree(db, agentId, worktrees);
  const wt = worktrees.get(agentId);
  if (!wt || !coreRust) return;
  try {
    const hasChanges = coreRust.worktreeHasChanges(wt.worktreePath);
    if (hasChanges) {
      logger.info(
        `[AgentManager] Worktree '${wt.worktreeName}' has changes — keeping at ${wt.worktreePath}`,
      );
    } else {
      // Lifecycle: run teardown script before removing worktree (T91)
      const lifecycle = loadLifecycleConfig(wt.repoPath);
      if (lifecycle?.teardown) {
        try {
          await runLifecycleScript(lifecycle.teardown, wt.worktreePath, "teardown");
        } catch {
          /* Non-fatal: proceed with cleanup even if teardown fails */
        }
      }

      removeManagedWorktree(wt.repoPath, wt.worktreeName, wt.worktreePath, false);
      dbRemoveWorktree(db, wt.dbId);
      clearAgentWorktree(db, agentId);
      logger.info(`[AgentManager] Cleaned up empty worktree '${wt.worktreeName}'`);
    }
  } catch (err) {
    logger.error(`[AgentManager] Failed to clean up worktree '${wt.worktreeName}':`, err);
  }
  worktrees.delete(agentId);
}
