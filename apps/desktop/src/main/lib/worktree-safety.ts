import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

// No electron or logger imports: scripts/clean-build.ts uses this too.
const execFileAsync = promisify(execFile);

/** Deleted in every checkout by the MCP setup, so it never counts as work */
export const ALWAYS_CHANGED = ".agents/mcp_config.json";

/** Ignored paths a build or install recreates; any other ignored file (.env, a local DB) is work */
const REGENERABLE_DIRS = new Set([
  "node_modules",
  "dist",
  "out",
  "build",
  ".turbo",
  "target",
  ".next",
  "coverage",
  ".vite",
  ".cache",
]);
const REGENERABLE_FILE = /(^|\/)(\.DS_Store|[^/]+\.log)$/;

const IN_PROGRESS = [
  "rebase-merge",
  "rebase-apply",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "BISECT_LOG",
];

/**
 * A path's identity for comparing two spellings of one folder: its realpath, else the resolved
 * path. On Windows git prints long names (C:/Users/runneradmin) where the caller may hold an 8.3
 * one (RUNNER~1) or another case: the native realpath expands it, the key is lowercased
 */
export function pathKey(p: string, platform: NodeJS.Platform = process.platform): string {
  const win = platform === "win32";
  try {
    const real = win ? realpathSync.native(p) : realpathSync(p);
    return win ? real.toLowerCase() : real;
  } catch {
    return win ? resolve(p).toLowerCase() : resolve(p);
  }
}

export type GitRunner = (args: string[], cwd: string, timeoutMs?: number) => Promise<string>;

/** Push credentials helpers survive; every other GIT_* (GIT_DIR, GIT_WORK_TREE,
 *  GIT_CONFIG_PARAMETERS...) is dropped, and git never waits on a terminal prompt */
const GIT_ENV_KEPT = new Set(["GIT_SSH", "GIT_SSH_COMMAND", "GIT_ASKPASS"]);

function cleanEnv(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_") || GIT_ENV_KEPT.has(k)),
  );
  return { ...env, GIT_TERMINAL_PROMPT: "0" };
}

export const runGit: GitRunner = async (args, cwd, timeoutMs = 10_000) =>
  (
    await execFileAsync(
      "git",
      ["-c", "status.showUntrackedFiles=all", "-c", "core.fsmonitor=false", ...args],
      { cwd, timeout: timeoutMs, encoding: "utf-8", env: cleanEnv(), maxBuffer: 64 * 1024 * 1024 },
    )
  ).stdout;

export type WorktreeSafetyReason =
  | "clean and pushed"
  | "uncommitted changes"
  | "ignored files that are not build output"
  | "unpushed commits"
  | "submodules"
  | "operation in progress"
  | "git check failed";

export interface WorktreeSafety {
  removable: boolean;
  reason: WorktreeSafetyReason;
}

export function isRegenerable(ignoredPath: string): boolean {
  const path = ignoredPath.replace(/\/$/, "");
  return path.split("/").some((s) => REGENERABLE_DIRS.has(s)) || REGENERABLE_FILE.test(path);
}

const keep = (reason: WorktreeSafetyReason): WorktreeSafety => ({ removable: false, reason });

/** Own checkout, no submodules, no rebase/merge/cherry-pick/revert/bisect under way. Null = ok */
export async function checkoutBlocker(
  dir: string,
  git = runGit,
): Promise<"git check failed" | "submodules" | "operation in progress" | null> {
  // Without its own .git, git would answer for an enclosing repo (the main checkout)
  const top = (await git(["rev-parse", "--show-toplevel"], dir)).trim();
  if (pathKey(top) !== pathKey(dir)) return "git check failed";
  if (existsSync(join(dir, ".gitmodules"))) return "submodules";
  const markers = (await git(["rev-parse", ...IN_PROGRESS.flatMap((m) => ["--git-path", m])], dir))
    .split("\n")
    .filter(Boolean);
  if (markers.length !== IN_PROGRESS.length) return "git check failed";
  if (markers.some((m) => existsSync(isAbsolute(m) ? m : join(dir, m)))) {
    return "operation in progress";
  }
  return null;
}

/**
 * The one rule for removing a worktree (docs/GUIDES/RELEASE.md "Orphaned worktrees"): its own
 * checkout, no submodules, no operation in progress, nothing changed or untracked, ignored files
 * only build output, every commit on a remote. Any git failure keeps it
 */
export async function worktreeSafety(dir: string, git = runGit): Promise<WorktreeSafety> {
  try {
    const blocker = await checkoutBlocker(dir, git);
    if (blocker) return keep(blocker);
    const status = await git(
      [
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--ignore-submodules=none",
        "--ignored=matching",
      ],
      dir,
    );
    for (const line of status.split("\n").filter((l) => l.trim())) {
      const path = line.slice(3);
      if (line.startsWith("!! ")) {
        if (!isRegenerable(path)) return keep("ignored files that are not build output");
      } else if (path !== ALWAYS_CHANGED) {
        return keep("uncommitted changes");
      }
    }
    const unpushed = await git(["rev-list", "--count", "HEAD", "--not", "--remotes"], dir);
    if (Number.parseInt(unpushed.trim(), 10) !== 0) return keep("unpushed commits");
    return { removable: true, reason: "clean and pushed" };
  } catch {
    return keep("git check failed");
  }
}

export interface RegisteredWorktree {
  path: string;
  branch: string | null;
  locked: boolean;
}

/** `git worktree list --porcelain` blocks */
export function parseWorktreeList(text: string): RegisteredWorktree[] {
  return text.split("\n\n").flatMap((block) => {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path) return [];
    const ref = lines.find((l) => l.startsWith("branch "))?.slice(7);
    return [
      {
        path,
        branch: ref ? ref.replace(/^refs\/heads\//, "") : null,
        locked: lines.some((l) => l === "locked" || l.startsWith("locked ")),
      },
    ];
  });
}

/** Locked, or unknown because git failed: either way it stays */
export async function isLockedOrUnknown(repo: string, dir: string, git = runGit): Promise<boolean> {
  try {
    const list = parseWorktreeList(await git(["worktree", "list", "--porcelain"], repo));
    const entry = list.find((w) => pathKey(w.path) === pathKey(dir));
    return !entry || entry.locked;
  } catch {
    return true;
  }
}

/** Drops only registrations whose directory is gone */
export async function pruneWorktrees(repo: string, git = runGit): Promise<void> {
  await git(["worktree", "prune"], repo).catch(() => {});
}
