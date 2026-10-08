import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { TRPCError } from "@trpc/server";
import { listProjects } from "../../db/queries";
import { isPathAllowed, isPathInside, realpathSafe } from "../../security/path-guard";

export function allowedBases(ctx: { db: import("libsql").Database }): string[] {
  return [...listProjects(ctx.db).map((p) => p.path), resolve(homedir(), ".exegol")];
}

/**
 * A path from the renderer must be inside a registered project (or ~/.exegol).
 * realpath + relative() in isPathAllowed stop symlink and /repo/app-evil prefix tricks.
 */
export async function assertPathInsideProject(
  filePath: string,
  ctx: { db: import("libsql").Database },
): Promise<void> {
  if (!(await isPathAllowed(filePath, allowedBases(ctx)))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Access denied: path is outside any registered project directory",
    });
  }
}

/** The project root or a folder under it, realpath-resolved; anything else is refused */
export async function resolveProjectFolder(projectPath: string, dir: string): Promise<string> {
  const [base, target] = await Promise.all([realpathSafe(projectPath), realpathSafe(dir)]);
  if (!isPathInside(base, target)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "That folder is outside the project" });
  }
  const info = await stat(target).catch(() => null);
  if (!info?.isDirectory()) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Folder not found: ${dir}` });
  }
  return target;
}
