import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import type Database from "libsql";
import { z } from "zod";
import { logger } from "../../lib/logger";
import { publicProcedure, router } from "../trpc";

const execFileAsync = promisify(execFile);

// ─── Rust native module (git2 diff) ────────────────────────────────────────

let coreRust: typeof import("@exegol/core-rust") | null = null;
try {
  coreRust = require("@exegol/core-rust");
} catch {
  logger.warn("[Diff] @exegol/core-rust not available — falling back to git CLI");
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── Router ─────────────────────────────────────────────────────────────────

export const diffRouter = router({
  /** Structured diff via Rust git2 — returns FileDiff[] */
  structuredDiff: publicProcedure
    .input(z.object({ projectId: z.string(), staged: z.boolean().default(false) }))
    .query(({ ctx, input }) => {
      const projectPath = resolveProjectPath(ctx.db, input.projectId);
      if (!coreRust) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Rust native module not available for structured diff",
        });
      }
      return coreRust.getDiff(projectPath, input.staged);
    }),

  /** Legacy string diff — kept for backward compat, prefers Rust when available */
  projectDiff: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const projectPath = resolveProjectPath(ctx.db, input.projectId);
      // Try Rust first for the raw unified string (via getWorktreeDiff)
      if (coreRust) {
        try {
          return coreRust.getWorktreeDiff(projectPath);
        } catch {
          // Fall through to CLI
        }
      }
      return runGitDiff(projectPath, ["--unified=3"]);
    }),

  /** Legacy staged diff */
  stagedDiff: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const projectPath = resolveProjectPath(ctx.db, input.projectId);
      return runGitDiff(projectPath, ["--cached", "--unified=3"]);
    }),
});
