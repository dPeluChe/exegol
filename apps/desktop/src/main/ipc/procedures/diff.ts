import { execFile } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
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

  /** Git status: list changed files with their staging state */
  status: publicProcedure
    .input(z.object({ projectId: z.string(), pathOverride: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const cwd = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
      try {
        const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-uall"], {
          cwd,
          maxBuffer: 1024 * 1024,
        });
        return stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => ({
            status: line.slice(0, 2).trim(),
            staged: line[0] !== " " && line[0] !== "?",
            path: line.slice(3),
          }));
      } catch {
        return [];
      }
    }),

  /** Stage specific files or all */
  stage: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        files: z.array(z.string()).optional(),
        pathOverride: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cwd = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
      const args = input.files && input.files.length > 0 ? ["add", ...input.files] : ["add", "-A"];
      await execFileAsync("git", args, { cwd });
      return { success: true };
    }),

  /** Unstage specific files or all */
  unstage: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        files: z.array(z.string()).optional(),
        pathOverride: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cwd = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
      const args =
        input.files && input.files.length > 0
          ? ["reset", "HEAD", ...input.files]
          : ["reset", "HEAD"];
      await execFileAsync("git", args, { cwd });
      return { success: true };
    }),

  /** Commit staged changes (auto-stages all if nothing staged) */
  commit: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        message: z.string().min(1),
        pathOverride: z.string().optional(),
        stageAll: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cwd = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
      // Remove stale lock file if exists
      const lockPath = join(cwd, ".git", "index.lock");
      if (existsSync(lockPath)) {
        try {
          unlinkSync(lockPath);
        } catch {
          /* */
        }
      }
      // Stage all if requested (avoids race condition from separate stage+commit calls)
      if (input.stageAll) {
        await execFileAsync("git", ["add", "-A"], { cwd });
      }
      const { stdout } = await execFileAsync("git", ["commit", "-m", input.message], { cwd });
      return { output: stdout.trim() };
    }),

  /** Push to remote (auto-sets upstream for new branches) */
  push: publicProcedure
    .input(z.object({ projectId: z.string(), pathOverride: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const cwd = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
      try {
        const { stdout } = await execFileAsync("git", ["push"], { cwd, timeout: 30_000 });
        return { output: stdout.trim() };
      } catch (err) {
        // If no upstream, auto-set it and retry
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("no upstream branch") || msg.includes("has no upstream")) {
          const { stdout: branch } = await execFileAsync("git", ["branch", "--show-current"], {
            cwd,
          });
          const { stdout: out } = await execFileAsync(
            "git",
            ["push", "--set-upstream", "origin", branch.trim()],
            { cwd, timeout: 30_000 },
          );
          return { output: out.trim() || "Pushed with upstream set" };
        }
        throw err;
      }
    }),

  /** Get current branch name */
  branch: publicProcedure
    .input(z.object({ projectId: z.string(), pathOverride: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const cwd = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
      try {
        const { stdout } = await execFileAsync("git", ["branch", "--show-current"], { cwd });
        return stdout.trim();
      } catch {
        return "unknown";
      }
    }),
});
