import type Database from "libsql";
import {
  clearAgentWorktree,
  removeWorktree as dbRemoveWorktree,
  getAgent,
  getWorktreeByAgentId,
} from "../db/queries";
import { countLiveAgentsInWorktree } from "../db/queries/agents";
import { getAppSettings } from "../db/queries/settings";
import { runNative } from "../lib/concurrency";
import { logger } from "../lib/logger";
import { loadLifecycleConfig, runLifecycleScript } from "../lifecycle/loader";
import { coreRust } from "./spawn-env";
import { announceSave, saveWorktreeWork } from "./worktree-save";
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
  const rust = coreRust;
  if (!wt || !rust) return;
  // findReusableWorktree lets agents share a branch's worktree; never pull it out from under one
  if (countLiveAgentsInWorktree(db, wt.dbId, agentId) > 0) {
    logger.info(`[AgentManager] Worktree '${wt.worktreeName}' still in use — keeping it`);
    worktrees.delete(agentId);
    return;
  }
  try {
    if (getAppSettings(db).saveWorktreeWork) {
      const agent = getAgent(db, agentId);
      const alias = agent?.alias || agent?.cliType || "agent";
      const outcome = await saveWorktreeWork({
        dir: wt.worktreePath,
        expectedBranch: getWorktreeByAgentId(db, agentId)?.branchName ?? null,
        alias,
      });
      announceSave(outcome, { alias, agentId, projectId: agent?.projectId });
      // Not saved (push failed, secret, hook...): the worktree is the only copy, keep it
      if (outcome.status === "refused") {
        worktrees.delete(agentId);
        return;
      }
    }
    const hasChanges = await runNative(() => rust.worktreeHasChangesAsync(wt.worktreePath));
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
