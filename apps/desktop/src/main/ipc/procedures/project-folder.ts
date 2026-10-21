import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { promisify } from "node:util";
import type { FolderInspection } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { logger } from "../../lib/logger";
import { realpathSafe } from "../../security/path-guard";

const execFileAsync = promisify(execFile);

/** Comparison key for an already realpath-resolved folder: no trailing separator, and any case
 *  on macOS and Windows, whose default file systems ignore it */
export function folderKey(p: string, platform: NodeJS.Platform = process.platform): string {
  let s = platform === "win32" ? p.replace(/\//g, "\\").replace(/^\\\\\?\\/, "") : p;
  s = s.replace(/[\\/]+$/, "") || s.slice(0, 1);
  return platform === "darwin" || platform === "win32" ? s.toLowerCase() : s;
}

export async function sameFolder(a: string, b: string, platform?: NodeJS.Platform) {
  const [x, y] = await Promise.all([realpathSafe(a), realpathSafe(b)]);
  return folderKey(x, platform) === folderKey(y, platform);
}

export async function findProjectAt<T extends { id: string; name: string; path: string }>(
  projects: T[],
  path: string,
  platform?: NodeJS.Platform,
): Promise<T | undefined> {
  const key = folderKey(await realpathSafe(path), platform);
  for (const p of projects) {
    if (folderKey(await realpathSafe(p.path), platform) === key) return p;
  }
  return undefined;
}

/** `--show-toplevel` rather than `--is-inside-work-tree`: a repo's subfolder passes the latter */
export async function gitToplevel(path: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: path });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function inspectFolder(
  path: string,
  projects: { id: string; name: string; path: string }[],
): Promise<FolderInspection> {
  const info = await stat(path).catch(() => null);
  const existing = await findProjectAt(projects, path);
  const existingProject = existing ? { id: existing.id, name: existing.name } : undefined;
  if (!info?.isDirectory()) {
    return { exists: !!info, isDirectory: false, existingProject, git: "none" };
  }
  const toplevel = await gitToplevel(path);
  if (!toplevel) return { exists: true, isDirectory: true, existingProject, git: "none" };
  if (await sameFolder(toplevel, path)) {
    return { exists: true, isDirectory: true, existingProject, git: "repo" };
  }
  return { exists: true, isDirectory: true, existingProject, git: "subfolder", toplevel };
}

/** `git init` for Add project, no commit. The branch name is checked by git itself */
export async function initGitRepo(path: string, branch: string): Promise<void> {
  try {
    await execFileAsync("git", ["check-ref-format", "--branch", branch], { cwd: path });
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid branch name: ${branch}` });
  }
  logger.info(`[Projects] git init ${basename(path)}`);
  await execFileAsync("git", ["init", `--initial-branch=${branch}`], { cwd: path });
}
