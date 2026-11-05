import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BUILD_DIRS, type GitRunner, runGit, splitNul } from "../lib/worktree-safety";
import { isPathInside, realpathSafe } from "../security/path-guard";

const MAX_COPIED_FILES = 200;
const MAX_COPIED_FILE_BYTES = 5 * 1024 * 1024;

interface LocalCopyResult {
  copied: number;
  /** Already in the worktree, a link, too big, outside the checkout or unreadable */
  skipped: number;
}

/** Control characters, quotes or backslashes: git would print the path quoted */
function hasOddChars(path: string): boolean {
  for (const ch of path) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || ch === '"' || ch === "\\") return true;
  }
  return false;
}

/**
 * Which of the files git listed (untracked, matching the project's patterns) may be copied: a
 * plain relative path, nothing under .git or a dependency or build folder, at most `max`
 */
export function planLocalCopies(listed: readonly string[], max = MAX_COPIED_FILES): string[] {
  const out = new Set<string>();
  for (const rel of listed) {
    if (out.size >= max) break;
    if (!rel || rel.startsWith("/") || rel.endsWith("/") || hasOddChars(rel)) continue;
    const parts = rel.split("/");
    if (parts.some((p) => !p || p === "." || p === ".." || p === ".git" || BUILD_DIRS.has(p))) {
      continue;
    }
    out.add(rel);
  }
  return [...out];
}

/** `git check-ignore` exits 1 when no path is ignored. One path per line: the plan has no
 *  control characters or quotes, so nothing comes back quoted */
async function ignoredOf(paths: string[], cwd: string, git: GitRunner): Promise<Set<string>> {
  try {
    const out = await git(["-c", "core.quotePath=false", "check-ignore", "--", ...paths], cwd);
    return new Set(out.split("\n").filter(Boolean));
  } catch (err) {
    if ((err as { code?: unknown }).code === 1) return new Set();
    throw err;
  }
}

async function copyOne(
  rel: string,
  src: { root: string; real: string },
  dest: { root: string; real: string },
): Promise<boolean> {
  const from = join(src.root, rel);
  const info = await lstat(from);
  if (!info.isFile() || info.size > MAX_COPIED_FILE_BYTES) return false;
  // A linked folder on the way would read from outside the checkout
  if (!isPathInside(src.real, await realpath(dirname(from)))) return false;
  const to = join(dest.root, rel);
  if (!isPathInside(dest.real, await realpathSafe(dirname(to)))) return false;
  await mkdir(dirname(to), { recursive: true });
  if (!isPathInside(dest.real, await realpath(dirname(to)))) return false;
  try {
    // EXCL: never over a file (or a link) already there
    await copyFile(from, to, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
  await chmod(to, info.mode & 0o7777);
  return true;
}

/**
 * Copies the checkout's untracked, gitignored files matching `patterns` (gitignore syntax) into
 * a new worktree: regular files only, inside both trees, never over an existing file
 */
export async function copyLocalFiles(
  sourceDir: string,
  worktreeDir: string,
  patterns: readonly string[],
  git: GitRunner = runGit,
): Promise<LocalCopyResult> {
  const result: LocalCopyResult = { copied: 0, skipped: 0 };
  if (patterns.length === 0) return result;
  // Pathspec excludes keep git out of node_modules and build output (0.8 s to 0.09 s measured)
  const skipDirs = [...BUILD_DIRS].map((d) => `:(exclude,glob)**/${d}/**`);
  const listed = splitNul(
    await git(
      [
        "ls-files",
        "-z",
        "--others",
        "--ignored",
        ...patterns.map((p) => `--exclude=${p}`),
        "--",
        ".",
        ...skipDirs,
      ],
      sourceDir,
      15_000,
    ),
  );
  const planned = planLocalCopies(listed);
  if (planned.length === 0) return result;
  const ignored = await ignoredOf(planned, sourceDir, git);
  const src = { root: sourceDir, real: await realpath(sourceDir) };
  const dest = { root: worktreeDir, real: await realpath(worktreeDir) };
  for (const rel of planned) {
    if (!ignored.has(rel)) continue;
    const ok = await copyOne(rel, src, dest).catch(() => false);
    if (ok) result.copied++;
    else result.skipped++;
  }
  return result;
}
