/**
 * Where a spawn will run — one definition, used by the spawn path and by the
 * launch modal's preview.
 *
 * The modal used to rebuild half of this in the renderer and got it wrong in
 * two ways it could not have got right: it could not see existing worktrees
 * (which are REUSED on a branch-name match, not suffixed) and could not know
 * the collision suffix. So it promised a directory the agent never ran in.
 */

import type { Project, Worktree } from "@exegol/shared";
import type Database from "libsql";
import { listWorktrees } from "../db/queries";
import { slugifyBranchName } from "./spawn-env";
import { previewManagedWorktree } from "./worktrees";

/** The branch a spawn asks for: what the user typed, else the task slug. */
export function requestedBranchFor(
  branchName: string | undefined,
  taskDescription: string,
): string {
  return branchName?.trim() || slugifyBranchName(taskDescription);
}

/** A worktree already on that branch is reused as-is — no suffix, no new branch. */
export function findReusableWorktree(
  db: Database.Database,
  projectId: string,
  branchName: string,
): Worktree | null {
  return listWorktrees(db, projectId).find((w) => w.branchName === branchName) ?? null;
}

export interface SpawnTarget {
  cwd: string;
  branchName: string | null;
  /** True when an existing worktree answers for this branch. */
  reused: boolean;
}

export function resolveSpawnTarget(
  db: Database.Database,
  project: Project,
  opts: { useWorktree: boolean; branchName?: string; taskDescription?: string },
): SpawnTarget {
  if (!opts.useWorktree) return { cwd: project.path, branchName: null, reused: false };

  const requested = requestedBranchFor(opts.branchName, opts.taskDescription ?? "");
  const reuse = findReusableWorktree(db, project.id, requested);
  if (reuse) return { cwd: reuse.path, branchName: requested, reused: true };

  const preview = previewManagedWorktree(project.name, requested);
  return { cwd: preview.path, branchName: preview.branchName, reused: false };
}
