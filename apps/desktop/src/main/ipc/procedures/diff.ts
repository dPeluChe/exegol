import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../trpc";
import { aiProcedures } from "./diff-ai";
import {
  coreRust,
  diffCache,
  execFileAsync,
  invalidateProjectDiff,
  resolveProjectPath,
  runGitDiff,
} from "./diff-helpers";
import { prProcedures } from "./diff-pr";
import { buildReviewSummary } from "./diff-review";
import { buildGitState } from "./diff-state";

// ─── Router ─────────────────────────────────────────────────────────────────

export const diffRouter = router({
  /** Structured diff via Rust git2 — returns FileDiff[] */
  structuredDiff: publicProcedure
    .input(z.object({ projectId: z.string(), staged: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      const projectPath = resolveProjectPath(ctx.db, input.projectId);
      if (!coreRust) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Rust native module not available for structured diff",
        });
      }
      const rust = coreRust;
      const key = `${input.projectId}|structured|${input.staged}|`;
      return diffCache.getOrCompute(key, async () => rust.getDiff(projectPath, input.staged));
    }),

  /** Legacy string diff — kept for backward compat, prefers Rust when available */
  projectDiff: publicProcedure
    .input(z.object({ projectId: z.string(), pathOverride: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const projectPath = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
      const key = `${input.projectId}|project|false|${input.pathOverride ?? ""}`;
      return diffCache.getOrCompute(key, async () => {
        if (coreRust) {
          try {
            return coreRust.getWorktreeDiff(projectPath);
          } catch {
            // Fall through to CLI
          }
        }
        return runGitDiff(projectPath, ["--unified=3"]);
      });
    }),

  /** Legacy staged diff */
  stagedDiff: publicProcedure
    .input(z.object({ projectId: z.string(), pathOverride: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const projectPath = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
      const key = `${input.projectId}|staged|true|${input.pathOverride ?? ""}`;
      return diffCache.getOrCompute(key, async () =>
        runGitDiff(projectPath, ["--cached", "--unified=3"]),
      );
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
      invalidateProjectDiff(input.projectId);
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
      invalidateProjectDiff(input.projectId);
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
      invalidateProjectDiff(input.projectId);
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

  /** Review summary: risk signals for changed files before diving into full diff */
  reviewSummary: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        pathOverride: z.string().optional(),
        staged: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const cwd = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
      return buildReviewSummary(cwd, input.staged);
    }),

  /** Comprehensive git state for the Smart Git Action button */
  gitState: publicProcedure
    .input(z.object({ projectId: z.string(), pathOverride: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const cwd = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
      return buildGitState(cwd);
    }),

  ...prProcedures,
  ...aiProcedures,
});
