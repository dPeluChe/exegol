import type { PipelineRun } from "@exegol/shared";
import type Database from "libsql";
import { coreRust } from "../agents/spawn-env";
import { removeManagedWorktree } from "../agents/worktrees";
import { getProject } from "../db/queries";
import { runNative } from "../lib/concurrency";
import { logger } from "../lib/logger";

export async function cleanupPipelineWorktree(
  db: Database.Database,
  run: PipelineRun,
): Promise<void> {
  const rust = coreRust;
  const worktreePath = run.worktreePath;
  if (!worktreePath || !rust) return;
  try {
    const hasChanges = await runNative(() => rust.worktreeHasChangesAsync(worktreePath));
    if (hasChanges) {
      logger.info("[Pipeline] Worktree has changes — keeping for manual review:", {
        path: worktreePath,
      });
      return;
    }
    const project = getProject(db, run.projectId);
    if (project) {
      const wtName = worktreePath.split("/").pop() ?? "";
      removeManagedWorktree(project.path, wtName, worktreePath, false);
      logger.info("[Pipeline] Cleaned up worktree after completion");
    }
  } catch {
    /* Non-fatal */
  }
}
