import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { FolderInspection } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { winKey } from "../../db/queries/path-claims";
import { logger } from "../../lib/logger";
import { runGit } from "../../lib/worktree-safety";
import { realpathSafe } from "../../security/path-guard";

/** Comparison key for an already realpath-resolved folder: no trailing separator, and any case
 *  on macOS and Windows, whose default file systems ignore it */
export function folderKey(p: string, platform: NodeJS.Platform = process.platform): string {
  let s = platform === "win32" ? winKey(p) : p;
  s = s.replace(/[\\/]+$/, "") || s.slice(0, 1);
  return platform === "darwin" ? s.toLowerCase() : s;
}

export async function findProjectAt<T extends { id: string; name: string; path: string }>(
  projects: T[],
  path: string,
): Promise<T | undefined> {
  const keyOf = async (p: string) => folderKey(await realpathSafe(p));
  const [key, keys] = await Promise.all([
    keyOf(path),
    Promise.all(projects.map((p) => keyOf(p.path))),
  ]);
  return projects[keys.indexOf(key)];
}

/** `--show-prefix` is empty at the repo root; `resolve` turns git's C:/ toplevel into a native path */
async function gitPlace(path: string): Promise<FolderInspection> {
  try {
    const [toplevel = "", prefix = ""] = (
      await runGit(["rev-parse", "--show-toplevel", "--show-prefix"], path)
    ).split("\n");
    return prefix.trim()
      ? { kind: "subfolder", toplevel: resolve(toplevel.trim()) }
      : { kind: "repo" };
  } catch {
    return { kind: "noGit" };
  }
}

export async function inspectFolder(
  path: string,
  projects: { id: string; name: string; path: string }[],
): Promise<FolderInspection> {
  const [info, existing] = await Promise.all([
    stat(path).catch(() => null),
    findProjectAt(projects, path),
  ]);
  if (existing) return { kind: "existing", id: existing.id, name: existing.name };
  if (!info) return { kind: "missing" };
  if (!info.isDirectory()) return { kind: "notDirectory" };
  return gitPlace(path);
}

/** `git init` for Add project, no commit. The branch name is checked by git itself */
export async function initGitRepo(path: string, branch: string): Promise<void> {
  try {
    await runGit(["check-ref-format", "--branch", branch], path);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid branch name: ${branch}` });
  }
  logger.info(`[Projects] git init ${basename(path)}`);
  await runGit(["init", `--initial-branch=${branch}`], path);
}
