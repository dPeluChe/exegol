import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { promisify } from "node:util";

// No electron or logger imports: scripts/clean-build.ts uses this too.
const execFileAsync = promisify(execFile);

/** Deleted in every checkout by the MCP setup, so it never counts as work */
const ALWAYS_CHANGED = ".agents/mcp_config.json";

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

export const runGit: GitRunner = async (args, cwd) =>
  (await execFileAsync("git", args, { cwd, timeout: 10_000, encoding: "utf-8" })).stdout;

export interface WorktreeSafety {
  removable: boolean;
  reason: "clean and pushed" | "uncommitted changes" | "unpushed commits" | "git check failed";
}

/**
 * The one rule for removing a worktree: no uncommitted change and no commit that is not on a
 * remote branch (pushed, or already in origin/main). Any git failure keeps it
 */
export async function worktreeSafety(dir: string, git = runGit): Promise<WorktreeSafety> {
  try {
    // Without its own .git, git would answer for an enclosing repo (the main checkout)
    const top = (await git(["rev-parse", "--show-toplevel"], dir)).trim();
    if (realpathSync(top) !== realpathSync(dir))
      return { removable: false, reason: "git check failed" };
    const status = await git(["status", "--porcelain"], dir);
    const changes = status.split("\n").filter((l) => l.trim() && l.slice(3) !== ALWAYS_CHANGED);
    if (changes.length > 0) return { removable: false, reason: "uncommitted changes" };
    const unpushed = await git(["rev-list", "--count", "HEAD", "--not", "--remotes"], dir);
    if (Number.parseInt(unpushed.trim(), 10) !== 0) {
      return { removable: false, reason: "unpushed commits" };
    }
    return { removable: true, reason: "clean and pushed" };
  } catch {
    return { removable: false, reason: "git check failed" };
  }
}

/** Drops only registrations whose directory is gone */
export async function pruneWorktrees(repo: string, git = runGit): Promise<void> {
  await git(["worktree", "prune"], repo).catch(() => {});
}
