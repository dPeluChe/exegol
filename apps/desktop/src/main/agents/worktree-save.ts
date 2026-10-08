import { lstatSync } from "node:fs";
import { join } from "node:path";
import { isDefaultBranch } from "../integrations/github/gh";
import { logger } from "../lib/logger";
import { ALWAYS_CHANGED, checkoutBlocker, type GitRunner, runGit } from "../lib/worktree-safety";
import { getNotificationBus } from "../notifications/bus";

const COMMIT_TIMEOUT_MS = 120_000;
const PUSH_TIMEOUT_MS = 60_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SECRET_NAME =
  /(^|\/)(\.env[^/]*|[^/]+\.pem|[^/]+\.key|id_rsa[^/]*|[^/]+\.p12|credentials[^/]*)$/i;

export type SaveOutcome =
  | { status: "saved"; branch: string; commits: number }
  | { status: "nothing"; branch: string }
  | { status: "refused"; reason: string };

export interface SaveTarget {
  dir: string;
  /** The branch Exegol created for this worktree (its row), or null for a folder with no row */
  expectedBranch: string | null;
  alias: string;
}

const refused = (reason: string): SaveOutcome => ({ status: "refused", reason });

async function defaultBranchOf(dir: string, git: GitRunner): Promise<string> {
  const ref = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir).catch(
    () => "",
  );
  return ref.trim().replace(/^origin\//, "") || "main";
}

async function unpushedCount(dir: string, git: GitRunner): Promise<number> {
  return Number.parseInt(
    (await git(["rev-list", "--count", "HEAD", "--not", "--remotes"], dir)).trim(),
    10,
  );
}

/** Staged paths that may hold a secret or a large binary; the save stops on any */
function riskyStaged(dir: string, staged: string[]): boolean {
  return staged.some((path) => {
    if (SECRET_NAME.test(path)) return true;
    const info = lstatSync(join(dir, path), { throwIfNoEntry: false });
    return (info?.size ?? 0) > MAX_FILE_BYTES;
  });
}

/**
 * Puts a worktree's work on its branch's remote: commit what is pending (tracked changes and
 * untracked files git does not ignore, hooks run) and push the branch to origin under its own
 * name. Refuses on the default branch, a branch Exegol did not create, detached HEAD,
 * submodules, an operation under way, a likely secret or big file, no identity, a failing hook
 * or push. Never forces, never sets an identity
 */
export async function saveWorktreeWork(
  target: SaveTarget,
  git: GitRunner = runGit,
): Promise<SaveOutcome> {
  const { dir, expectedBranch, alias } = target;
  try {
    const blocker = await checkoutBlocker(dir, git);
    if (blocker) return refused(blocker);
    const branch = (
      await git(["symbolic-ref", "--short", "-q", "HEAD"], dir).catch(() => "")
    ).trim();
    const pending = (await git(["status", "--porcelain", "--untracked-files=all"], dir))
      .split("\n")
      .filter((l) => l.trim() && l.slice(3) !== ALWAYS_CHANGED);
    if (pending.length === 0 && (await unpushedCount(dir, git)) === 0) {
      return { status: "nothing", branch };
    }
    if (!branch) return refused("detached HEAD");
    if (expectedBranch ? branch !== expectedBranch : !branch.startsWith("exegol/")) {
      return refused("not a branch Exegol created");
    }
    if (isDefaultBranch(branch, await defaultBranchOf(dir, git))) {
      return refused("default branch");
    }

    await git(["add", "-A", "--", ".", `:(exclude)${ALWAYS_CHANGED}`], dir);
    const staged = (await git(["diff", "--cached", "--name-only", "-z"], dir))
      .split("\0")
      .filter(Boolean);
    if (staged.length > 0) {
      if (riskyStaged(dir, staged)) {
        await git(["reset", "-q"], dir);
        return refused("a staged file looks like a secret or is over 10 MB");
      }
      const name = (await git(["config", "user.name"], dir).catch(() => "")).trim();
      const email = (await git(["config", "user.email"], dir).catch(() => "")).trim();
      if (!name || !email) {
        await git(["reset", "-q"], dir);
        return refused("no git identity configured");
      }
      try {
        await git(
          ["commit", "-q", "-m", `wip(exegol): save ${alias} work before cleanup`],
          dir,
          COMMIT_TIMEOUT_MS,
        );
      } catch {
        await git(["reset", "-q"], dir).catch(() => {});
        return refused("commit failed (a hook refused it)");
      }
    }

    const commits = await unpushedCount(dir, git);
    if (commits === 0) return { status: "nothing", branch };
    const origin = await git(["remote", "get-url", "origin"], dir).catch(() => null);
    if (origin === null) return refused("no origin remote");
    try {
      await git(
        ["push", "-u", "origin", `refs/heads/${branch}:refs/heads/${branch}`],
        dir,
        PUSH_TIMEOUT_MS,
      );
    } catch {
      return refused("push failed");
    }
    return { status: "saved", branch, commits };
  } catch {
    return refused("git check failed");
  }
}

/** One log line (alias, branch, count: no paths, no file names) and one notification */
export function announceSave(
  outcome: SaveOutcome,
  ids: { alias: string; agentId?: string; projectId?: string },
): void {
  if (outcome.status === "refused") {
    logger.info(`[WorktreeSave] ${ids.alias}: kept, not saved (${outcome.reason})`);
    return;
  }
  if (outcome.status !== "saved") return;
  logger.info(
    `[WorktreeSave] ${ids.alias}: saved to ${outcome.branch}, ${outcome.commits} commit(s) pushed`,
  );
  getNotificationBus().emit({
    type: "worktree:saved",
    title: `Saved ${ids.alias}'s work to ${outcome.branch} and pushed`,
    agentId: ids.agentId,
    projectId: ids.projectId,
    at: Date.now(),
  });
}
