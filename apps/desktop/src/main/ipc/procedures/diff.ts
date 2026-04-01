import { execFile } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import type Database from "libsql";
import { z } from "zod";
import { logger } from "../../lib/logger";
import { getProjectPorts } from "../../system/ports";
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
    .input(z.object({ projectId: z.string(), pathOverride: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const projectPath = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
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
    .input(z.object({ projectId: z.string(), pathOverride: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const projectPath = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
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
});

// ─── Review Summary Builder ────────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  /\.env($|\.)/,
  /credentials/i,
  /secret/i,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /id_rsa/,
  /\.keystore$/,
];

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".wasm",
  ".pdf",
  ".mp4",
  ".mp3",
]);

const DEP_FILES = new Set([
  "package.json",
  "package-lock.json",
  "bun.lockb",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "requirements.txt",
  "Pipfile.lock",
  "poetry.lock",
  "Gemfile.lock",
  "composer.lock",
]);

const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /__tests__\//,
  /test\//i,
  /\.cy\.[jt]sx?$/, // Cypress
];

interface ReviewSignal {
  type: "info" | "warn" | "risk";
  label: string;
  detail?: string;
}

interface ReviewSummary {
  totalFiles: number;
  filesByType: Record<string, number>;
  signals: ReviewSignal[];
  additions: number;
  deletions: number;
}

async function buildReviewSummary(cwd: string, staged?: boolean): Promise<ReviewSummary> {
  const signals: ReviewSignal[] = [];
  const filesByType: Record<string, number> = {};

  // Get changed files from git status
  let statusFiles: string[] = [];
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-uall"], {
      cwd,
      maxBuffer: 1024 * 1024,
    });
    statusFiles = stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3));
  } catch {
    return {
      totalFiles: 0,
      filesByType,
      signals: [{ type: "warn", label: "Could not read git status" }],
      additions: 0,
      deletions: 0,
    };
  }

  if (statusFiles.length === 0) {
    return { totalFiles: 0, filesByType, signals, additions: 0, deletions: 0 };
  }

  // Classify files
  const sensitiveFiles: string[] = [];
  const binaryFiles: string[] = [];
  const depFiles: string[] = [];
  const testFiles: string[] = [];

  for (const filePath of statusFiles) {
    const ext = extname(filePath).toLowerCase() || "(no ext)";
    filesByType[ext] = (filesByType[ext] ?? 0) + 1;

    const baseName = filePath.split("/").pop() ?? filePath;

    if (SENSITIVE_PATTERNS.some((p) => p.test(filePath))) sensitiveFiles.push(filePath);
    if (BINARY_EXTENSIONS.has(ext)) binaryFiles.push(filePath);
    if (DEP_FILES.has(baseName)) depFiles.push(filePath);
    if (TEST_PATTERNS.some((p) => p.test(filePath))) testFiles.push(filePath);
  }

  // Fetch diff stats + ports in parallel (both non-fatal)
  const diffArgs = staged ? ["diff", "--cached", "--shortstat"] : ["diff", "--shortstat"];
  const [diffStat, ports] = await Promise.all([
    execFileAsync("git", diffArgs, { cwd, maxBuffer: 64 * 1024 })
      .then(({ stdout }) => stdout)
      .catch(() => ""),
    getProjectPorts(cwd).catch(() => []),
  ]);

  let additions = 0;
  let deletions = 0;
  const addMatch = diffStat.match(/(\d+) insertion/);
  const delMatch = diffStat.match(/(\d+) deletion/);
  if (addMatch?.[1]) additions = Number.parseInt(addMatch[1], 10);
  if (delMatch?.[1]) deletions = Number.parseInt(delMatch[1], 10);

  // Build risk signals
  if (sensitiveFiles.length > 0) {
    signals.push({
      type: "risk",
      label: `${sensitiveFiles.length} sensitive file(s)`,
      detail: sensitiveFiles.join(", "),
    });
  }
  if (depFiles.length > 0) {
    signals.push({ type: "warn", label: `Dependency changes: ${depFiles.join(", ")}` });
  }
  if (binaryFiles.length > 0) {
    signals.push({
      type: "warn",
      label: `${binaryFiles.length} binary/asset file(s)`,
      detail: binaryFiles.join(", "),
    });
  }
  if (testFiles.length > 0) {
    signals.push({ type: "info", label: `${testFiles.length} test file(s) modified` });
  } else if (statusFiles.length > 3) {
    signals.push({ type: "warn", label: "No test files in this changeset" });
  }
  if (statusFiles.length > 20) {
    signals.push({ type: "warn", label: `Large changeset: ${statusFiles.length} files` });
  }

  const runtimePorts = ports.filter((p) => p.source === "runtime");
  if (runtimePorts.length > 0) {
    signals.push({
      type: "info",
      label: `${runtimePorts.length} open port(s): ${runtimePorts.map((p) => p.port).join(", ")}`,
    });
  }

  return { totalFiles: statusFiles.length, filesByType, signals, additions, deletions };
}
