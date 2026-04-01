import { existsSync, rmSync } from "node:fs";
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

function buildTargetPath(rootKind: RootKind, projectName: string, worktreeName: string): string {
  return join(homedir(), ".exegol", rootKind, slugifyProjectName(projectName), worktreeName);
}

function withNumericSuffix(branchName: string, attempt: number): string {
  if (attempt <= 0) return branchName;
  return `${branchName}-${attempt + 1}`;
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
): ManagedWorktreeInfo {
  if (!coreRust) {
    throw new Error("Native git worktree support is unavailable");
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidateBranch = withNumericSuffix(branchName, attempt);
    const worktreeName = getWorktreeName(candidateBranch);
    const targetPath = buildTargetPath(rootKind, projectName, worktreeName);

    try {
      const info = coreRust.createWorktree(repoPath, worktreeName, candidateBranch, targetPath);
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
