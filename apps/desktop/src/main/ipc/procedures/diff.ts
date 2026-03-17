import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import type Database from "libsql";
import { z } from "zod";
import { publicProcedure, router } from "../trpc";

const execFileAsync = promisify(execFile);

function resolveProjectPath(db: Database.Database, projectId: string): string {
  const row = db.prepare("SELECT path FROM projects WHERE id = ?").get(projectId) as
    | { path: string }
    | undefined;
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Project ${projectId} not found` });
  }
  return row.path;
}

async function runGitDiff(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", ...args], {
      cwd,
      maxBuffer: 5 * 1024 * 1024, // 5MB
    });
    return stdout;
  } catch (err: unknown) {
    // git diff returns exit code 1 when there are differences
    if (err && typeof err === "object" && "stdout" in err) {
      return (err as { stdout: string }).stdout;
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to run git diff: ${err}`,
    });
  }
}

export const diffRouter = router({
  projectDiff: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const projectPath = resolveProjectPath(ctx.db, input.projectId);
      return runGitDiff(projectPath, ["--unified=3"]);
    }),

  stagedDiff: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const projectPath = resolveProjectPath(ctx.db, input.projectId);
      return runGitDiff(projectPath, ["--cached", "--unified=3"]);
    }),
});
