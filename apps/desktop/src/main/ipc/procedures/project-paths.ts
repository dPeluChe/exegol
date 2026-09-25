import { homedir } from "node:os";
import { resolve } from "node:path";
import { TRPCError } from "@trpc/server";
import { listProjects } from "../../db/queries";
import { isPathAllowed } from "../../security/path-guard";

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
