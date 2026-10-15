import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { logger } from "./logger";
import { runGit } from "./worktree-safety";

/** The line `.git/info/exclude` needs for `relPath` under `prefix` (cwd relative to the
 *  work tree root, as `git rev-parse --show-prefix` prints it), or null when present */
export function excludeLineFor(existing: string, prefix: string, relPath: string): string | null {
  const line = `/${`${prefix}${relPath}`.replace(/[\\*?[]/g, "\\$&")}`;
  return existing.split(/\r?\n/).some((l) => l.trim() === line) ? null : line;
}

/**
 * A file Exegol created goes to the repo's `.git/info/exclude` (shared by linked worktrees),
 * never `.gitignore`: no trace in the user's tracked files. Fire-and-forget: it rides the spawn path.
 */
export function excludeFromGit(cwd: string, relPath: string): void {
  void runGit(["rev-parse", "--show-prefix", "--git-path", "info/exclude"], cwd, 2_000)
    .then((stdout) => {
      const [prefix = "", excludePath = ""] = stdout.split("\n");
      if (excludePath.trim()) {
        return appendExcludeLine(resolve(cwd, excludePath.trim()), prefix, relPath);
      }
    })
    .catch(() => {}); // not a repo, or no git
}

async function appendExcludeLine(file: string, prefix: string, relPath: string): Promise<void> {
  try {
    const existing = await readFile(file, "utf-8").catch(() => "");
    const line = excludeLineFor(existing, prefix, relPath);
    if (!line) return;
    await mkdir(dirname(file), { recursive: true });
    const sep = existing && !existing.endsWith("\n") ? "\n" : "";
    await appendFile(file, `${sep}${line}\n`, "utf-8");
    logger.info(`[GitExclude] ${line} added to the repo's info/exclude`);
  } catch (err) {
    logger.warn(`[GitExclude] Could not add ${relPath} to info/exclude:`, err);
  }
}
