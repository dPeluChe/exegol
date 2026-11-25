import type { Agent, AgentCreate, Worktree } from "@exegol/shared";
import { isUnderPath, samePath } from "@exegol/shared";
import type Database from "libsql";
import {
  createOplogEntry,
  createWorktree as dbCreateWorktree,
  setAgentWorktree,
} from "../db/queries";
import { logger } from "../lib/logger";
import type { WorktreeRecord } from "./agent-worktree-ops";
import { coreRust } from "./spawn-env";
import { findReusableWorktree, findWorktreeHolding, requestedBranchFor } from "./spawn-target";
import {
  createManagedWorktree,
  getWorktreeName,
  prepareNewWorktree,
  removeManagedWorktree,
} from "./worktrees";

interface ProjectInfo {
  path: string;
  name: string;
}

function joinWorktree(
  db: Database.Database,
  agentId: string,
  wt: Worktree,
  repoPath: string,
  worktrees: Map<string, WorktreeRecord>,
): void {
  setAgentWorktree(db, agentId, wt.id);
  worktrees.set(agentId, {
    dbId: wt.id,
    worktreeName: getWorktreeName(wt.branchName),
    worktreePath: wt.path,
    repoPath: wt.repoPath ?? repoPath,
  });
}

/**
 * Resolve cwd for an agent: either the override (e.g. pipeline shared worktree),
 * a reused existing worktree on the same branch, or a freshly created worktree.
 * Falls back to project root if worktree creation fails.
 */
export function setupAgentCwd(
  db: Database.Database,
  agent: Agent,
  config: AgentCreate,
  project: ProjectInfo,
  worktrees: Map<string, WorktreeRecord>,
  initialSnapshots: Map<string, { headSha: string; cwd: string; projectId: string }>,
): { cwd: string; ready: Promise<void> } {
  let cwd = project.path;
  let ready: Promise<void> = Promise.resolve();
  // A workspace root has no .git: its worktrees come from the repo inside it
  const repoPath = config.worktreeRepo ?? project.path;

  if (config.cwdOverride) {
    cwd = config.cwdOverride;
    logger.info("[AgentManager] Using a start folder override");
    // A folder of the checkout itself (the launcher's "run in") is not a pipeline worktree
    const inCheckout = samePath(cwd, project.path) || isUnderPath(cwd, project.path);
    // Joined like a reuse: the owner's exit cleanup keeps the worktree while this one lives
    const shared = inCheckout ? null : findWorktreeHolding(db, agent.projectId, cwd);
    if (shared) joinWorktree(db, agent.id, shared, project.path, worktrees);
    setIsolationMode(db, agent.id, inCheckout ? "project-root" : shared ? "isolated" : "pipeline");
    captureInitialSnapshot(agent, cwd, initialSnapshots);
    return { cwd, ready };
  }

  if (!config.useWorktree) {
    setIsolationMode(db, agent.id, "project-root");
    captureInitialSnapshot(agent, cwd, initialSnapshots);
    return { cwd, ready };
  }
  if (!coreRust) {
    // Worktree was requested but the native module is missing — silent fall back.
    cwd = repoPath;
    setIsolationMode(db, agent.id, "fallback");
    captureInitialSnapshot(agent, cwd, initialSnapshots);
    return { cwd, ready };
  }

  const requestedBranchName = requestedBranchFor(config.branchName, agent.taskDescription);
  const reuseWt = findReusableWorktree(
    db,
    agent.projectId,
    requestedBranchName,
    config.worktreeRepo,
  );
  if (reuseWt) {
    cwd = reuseWt.path;
    joinWorktree(db, agent.id, reuseWt, repoPath, worktrees);
    logger.info("[AgentManager] Reusing existing worktree:", {
      branch: requestedBranchName,
      path: reuseWt.path,
    });
    setIsolationMode(db, agent.id, "isolated");
    captureInitialSnapshot(agent, cwd, initialSnapshots);
    return { cwd, ready };
  }

  let createdWtInfo: { worktreeName: string; path: string; branchName: string } | null = null;
  try {
    const wtInfo = createManagedWorktree(
      repoPath,
      project.name,
      requestedBranchName,
      "worktrees",
      config.baseBranch,
    );
    createdWtInfo = wtInfo;
    cwd = wtInfo.path;

    const dbWt = dbCreateWorktree(db, {
      projectId: agent.projectId,
      agentId: agent.id,
      path: wtInfo.path,
      repoPath,
      branchName: wtInfo.branchName,
      autoCleanup: true,
    });
    setAgentWorktree(db, agent.id, dbWt.id);
    worktrees.set(agent.id, {
      dbId: dbWt.id,
      worktreeName: wtInfo.worktreeName,
      worktreePath: wtInfo.path,
      repoPath,
    });

    try {
      const snapshot = coreRust.getRepoSnapshot(repoPath);
      createOplogEntry(db, {
        agentId: agent.id,
        projectId: agent.projectId,
        operation: "worktree_create",
        refBefore: snapshot.headSha,
        refAfter: snapshot.headSha,
        description: `Created worktree '${wtInfo.worktreeName}' on branch '${wtInfo.branchName}'`,
      });
    } catch {
      /* Non-fatal oplog recording */
    }

    logger.info("[AgentManager] Created worktree:", {
      requestedBranch: requestedBranchName,
      branch: wtInfo.branchName,
      path: wtInfo.path,
    });

    ready = prepareNewWorktree(
      db,
      agent.projectId,
      repoPath,
      wtInfo.path,
      wtInfo.branchName,
    ).copied;
    setIsolationMode(db, agent.id, "isolated");
  } catch (err) {
    logger.error("[AgentManager] Failed to create worktree, falling back to project root:", err);
    // Half-success guard: createManagedWorktree may have written a worktree
    // to disk before dbCreateWorktree threw. Tear the on-disk worktree down
    // so we don't leak it, and reset cwd so the agent runs in the repo
    // (matching what the "fallback" badge claims).
    if (createdWtInfo) {
      try {
        removeManagedWorktree(repoPath, createdWtInfo.worktreeName, createdWtInfo.path, true);
      } catch (cleanupErr) {
        logger.warn(
          "[AgentManager] Failed to remove orphaned worktree during fallback:",
          cleanupErr,
        );
      }
    }
    cwd = repoPath;
    setIsolationMode(db, agent.id, "fallback");
  }

  captureInitialSnapshot(agent, cwd, initialSnapshots);
  return { cwd, ready };
}

function setIsolationMode(db: Database.Database, agentId: string, mode: string): void {
  try {
    db.prepare("UPDATE agents SET isolation_mode = ? WHERE id = ?").run(mode, agentId);
  } catch (err) {
    logger.warn(`[AgentManager] Failed to persist isolation_mode=${mode}:`, err);
  }
}

function captureInitialSnapshot(
  agent: Agent,
  cwd: string,
  initialSnapshots: Map<string, { headSha: string; cwd: string; projectId: string }>,
): void {
  if (!coreRust || agent.cliType === "shell") return;
  try {
    const snapshot = coreRust.getRepoSnapshot(cwd);
    initialSnapshots.set(agent.id, {
      headSha: snapshot.headSha,
      cwd,
      projectId: agent.projectId,
    });
  } catch {
    /* Non-fatal */
  }
}
