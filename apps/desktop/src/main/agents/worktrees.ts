import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "../lib/logger";
import { coreRust } from "./spawn-env";

type RootKind = "worktrees" | "pipelines";

export interface ManagedWorktreeInfo {
  branchName: string;
  requestedBranchName: string;
  worktreeName: string;
  path: string;
  repoPath: string;
}

function slugifyProjectName(projectName: string): string {
  return projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export function getWorktreeName(branchName: string): string {
  return branchName.replace(/\//g, "-");
}

/** Where this project's worktrees live. Outside the repo on purpose: next to
 *  the checkout they would need gitignore entries in every repo, and a stray
 *  one would look like project content. */
export function worktreeRootFor(projectName: string, rootKind: RootKind = "worktrees"): string {
  return join(homedir(), ".exegol", rootKind, slugifyProjectName(projectName));
}

function buildTargetPath(rootKind: RootKind, projectName: string, worktreeName: string): string {
  return join(worktreeRootFor(projectName, rootKind), worktreeName);
}

function withNumericSuffix(branchName: string, attempt: number): string {
  if (attempt <= 0) return branchName;
  return `${branchName}-${attempt + 1}`;
}

/** The nth name/place this branch would take. The ONE definition of the
 *  collision rule — the preview and the create loop must never disagree. */
function candidate(
  rootKind: RootKind,
  projectName: string,
  branchName: string,
  attempt: number,
): { branchName: string; worktreeName: string; path: string } {
  const candidateBranch = withNumericSuffix(branchName, attempt);
  const worktreeName = getWorktreeName(candidateBranch);
  return {
    branchName: candidateBranch,
    worktreeName,
    path: buildTargetPath(rootKind, projectName, worktreeName),
  };
}

const MAX_COLLISION_ATTEMPTS = 20;

/** What `createManagedWorktree` would pick if called right now. The launch modal
 *  has to show the directory the agent ACTUALLY gets, and a renderer cannot
 *  reproduce the collision suffix — it would promise `…/exegol-foo` while the
 *  agent ran in `…/exegol-foo-2`. */
export function previewManagedWorktree(
  projectName: string,
  branchName: string,
  rootKind: RootKind = "worktrees",
): { branchName: string; path: string } {
  // One directory read, not 20 stats: this runs on the main thread that pumps
  // PTY output, and the modal asks again as the user types a branch name.
  let taken: Set<string>;
  try {
    taken = new Set(readdirSync(worktreeRootFor(projectName, rootKind)));
  } catch {
    taken = new Set();
  }
  for (let attempt = 0; ; attempt++) {
    const next = candidate(rootKind, projectName, branchName, attempt);
    if (attempt === MAX_COLLISION_ATTEMPTS || !taken.has(next.worktreeName)) return next;
  }
}

function isRecoverableCreateError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes("already exists") ||
    message.includes("failed to create branch") ||
    message.includes("failed to create worktree") ||
    message.includes("exists")
  );
}

export function createManagedWorktree(
  repoPath: string,
  projectName: string,
  branchName: string,
  rootKind: RootKind = "worktrees",
  /** T177: branch/ref to cut from. Undefined = the repo's HEAD, which is what
   *  this always did — and silently, so an agent inherited whatever branch the
   *  main checkout happened to be on. */
  baseRef?: string,
): ManagedWorktreeInfo {
  if (!coreRust) {
    throw new Error("Native git worktree support is unavailable");
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt++) {
    const {
      branchName: candidateBranch,
      worktreeName,
      path: targetPath,
    } = candidate(rootKind, projectName, branchName, attempt);

    try {
      const info = coreRust.createWorktree(
        repoPath,
        worktreeName,
        candidateBranch,
        targetPath,
        baseRef,
      );
      return {
        branchName: candidateBranch,
        requestedBranchName: branchName,
        worktreeName,
        path: info.path,
        repoPath,
      };
    } catch (err) {
      lastError = err;
      if (!isRecoverableCreateError(err)) {
        throw err;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to create unique worktree for branch '${branchName}'`);
}

export function removeManagedWorktree(
  repoPath: string,
  worktreeName: string,
  worktreePath: string,
  force: boolean,
): void {
  if (coreRust) {
    try {
      coreRust.removeWorktree(repoPath, worktreeName, force);
      return;
    } catch (err) {
      if (!force) {
        throw err;
      }
      logger.warn("[Worktrees] Native removeWorktree failed, falling back to fs cleanup:", err);
    }
  }

  if (existsSync(worktreePath)) {
    rmSync(worktreePath, { recursive: true, force: true });
  }
}
