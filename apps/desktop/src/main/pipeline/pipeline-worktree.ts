import type { PipelineRun } from "@exegol/shared";
import type Database from "libsql";
import { coreRust } from "../agents/spawn-env";
import { removeManagedWorktree } from "../agents/worktrees";
import { getProject } from "../db/queries";
import { logger } from "../lib/logger";

export function cleanupPipelineWorktree(db: Database.Database, run: PipelineRun): void {
  if (!run.worktreePath || !coreRust) return;
  try {
    const hasChanges = coreRust.worktreeHasChanges(run.worktreePath);
    if (hasChanges) {
      logger.info("[Pipeline] Worktree has changes — keeping for manual review:", {
        path: run.worktreePath,
      });
      return;
    }
    const project = getProject(db, run.projectId);
    if (project) {
      const wtName = run.worktreePath.split("/").pop() ?? "";
      removeManagedWorktree(project.path, wtName, run.worktreePath, false);
      logger.info("[Pipeline] Cleaned up worktree after completion");
    }
  } catch {
    /* Non-fatal */
  }
}
