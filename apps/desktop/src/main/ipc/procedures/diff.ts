import { execFile } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import type Database from "libsql";
import { z } from "zod";
import { logger } from "../../lib/logger";
import { getApiKey } from "../../security/keystore";
import { getProjectPorts } from "../../system/ports";
import { publicProcedure, router } from "../trpc";

const execFileAsync = promisify(execFile);

// ─── gh CLI detection (cached) ─────────────────────────────────────────────

let ghAvailable: boolean | null = null;
async function detectGhCli(): Promise<boolean> {
  if (ghAvailable !== null) return ghAvailable;
  try {
    await execFileAsync("gh", ["--version"], { timeout: 3000 });
    ghAvailable = true;
  } catch {
    ghAvailable = false;
  }
  return ghAvailable;
}

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

  /** Comprehensive git state for the Smart Git Action button */
  gitState: publicProcedure
    .input(z.object({ projectId: z.string(), pathOverride: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const cwd = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
      return buildGitState(cwd);
    }),

  /** Create a GitHub PR via gh CLI. Falls back to error if gh not installed. */
  createPullRequest: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        pathOverride: z.string().optional(),
        title: z.string().optional(),
        body: z.string().optional(),
        draft: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cwd = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
      if (!(await detectGhCli())) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/",
        });
      }
      const args = ["pr", "create"];
      if (input.title) {
        args.push("--title", input.title);
        args.push("--body", input.body ?? "");
      } else {
        args.push("--fill"); // use commit messages
      }
      if (input.draft) args.push("--draft");
      try {
        const { stdout } = await execFileAsync("gh", args, { cwd, timeout: 30_000 });
        return { url: stdout.trim() };
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `gh pr create failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),

  /** Merge an open PR via gh CLI */
  mergePullRequest: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        pathOverride: z.string().optional(),
        strategy: z.enum(["merge", "squash", "rebase"]).default("squash"),
        deleteBranch: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cwd = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
      if (!(await detectGhCli())) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "GitHub CLI (gh) is not installed.",
        });
      }
      const args = ["pr", "merge", `--${input.strategy}`];
      if (input.deleteBranch) args.push("--delete-branch");
      try {
        const { stdout } = await execFileAsync("gh", args, { cwd, timeout: 60_000 });
        return { output: stdout.trim() || "Merged successfully" };
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `gh pr merge failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),

  /** Suggest a commit message by asking Claude Haiku to summarize the diff */
  suggestCommitMessage: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        pathOverride: z.string().optional(),
        staged: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cwd = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
      const apiKey = getApiKey(ctx.db, "anthropic");
      if (!apiKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Anthropic API key not configured. Set it in Settings → API Keys.",
        });
      }
      // Grab the diff (prefer staged if anything is staged; else worktree)
      const diff = await runGitDiff(cwd, input.staged ? ["--cached"] : []);
      if (!diff.trim()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No changes to summarize.",
        });
      }
      // Truncate to keep the request cheap — Haiku handles ~200KB fine but we cap at 20KB
      const truncated = diff.slice(0, 20_000);

      const prompt = `You are writing a conventional-commit-style git commit message.

Here is the diff:

${truncated}

Respond with ONLY the commit message — one line, imperative mood, max 72 chars.
Use a conventional prefix (feat/fix/chore/docs/refactor/perf/test/style) when obvious.
No explanation, no quotes, no markdown.`;

      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 120,
            messages: [{ role: "user", content: prompt }],
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
          throw new Error(`Anthropic API ${res.status}: ${res.statusText}`);
        }
        const data = (await res.json()) as { content?: Array<{ text?: string }> };
        const text = (data.content?.[0]?.text ?? "").trim();
        // First line only, strip quotes/backticks
        const message = text.split("\n")[0]?.replace(/^[`"'\s]+|[`"'\s]+$/g, "") ?? "";
        if (!message) {
          throw new Error("Empty response from Anthropic");
        }
        return { message };
      } catch (err) {
        logger.warn("[suggestCommitMessage] failed:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to generate suggestion: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
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

// ─── Smart Git Action state builder ────────────────────────────────────────

export interface GitState {
  branch: string;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
  dirtyStaged: number;
  dirtyUnstaged: number;
  conflicts: number;
  pr: {
    state: "none" | "open" | "merged" | "closed";
    url?: string;
    mergeable?: boolean;
    mergeStateStatus?: string;
  };
  ghInstalled: boolean;
}

async function buildGitState(cwd: string): Promise<GitState> {
  const branch = await execFileAsync("git", ["branch", "--show-current"], { cwd })
    .then(({ stdout }) => stdout.trim())
    .catch(() => "unknown");

  // Upstream + ahead/behind
  let hasUpstream = false;
  let ahead = 0;
  let behind = 0;
  try {
    const { stdout: trackingRaw } = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      { cwd },
    );
    if (trackingRaw.trim()) {
      hasUpstream = true;
      const { stdout: counts } = await execFileAsync(
        "git",
        ["rev-list", "--left-right", "--count", "HEAD...@{u}"],
        { cwd },
      );
      const [a, b] = counts.trim().split(/\s+/);
      ahead = Number.parseInt(a ?? "0", 10) || 0;
      behind = Number.parseInt(b ?? "0", 10) || 0;
    }
  } catch {
    /* no upstream configured yet */
  }

  // Status: dirty counts + conflicts
  let dirtyStaged = 0;
  let dirtyUnstaged = 0;
  let conflicts = 0;
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-uall"], {
      cwd,
      maxBuffer: 1024 * 1024,
    });
    for (const line of stdout.split("\n").filter(Boolean)) {
      const index = line[0];
      const work = line[1];
      // Unmerged markers — see git-status(1) porcelain output
      if (
        index === "U" ||
        work === "U" ||
        (index === "D" && work === "D") ||
        (index === "A" && work === "A")
      ) {
        conflicts++;
        continue;
      }
      if (index && index !== " " && index !== "?") dirtyStaged++;
      if ((work && work !== " " && work !== "?") || index === "?") dirtyUnstaged++;
    }
  } catch {
    /* ignore */
  }

  // GitHub PR state (optional; only if gh is installed)
  const ghInstalled = await detectGhCli();
  let pr: GitState["pr"] = { state: "none" };
  if (ghInstalled && branch !== "unknown" && branch !== "main" && branch !== "master") {
    try {
      const { stdout } = await execFileAsync(
        "gh",
        ["pr", "view", "--json", "state,url,mergeable,mergeStateStatus"],
        { cwd, timeout: 5000 },
      );
      const parsed = JSON.parse(stdout) as {
        state: string;
        url: string;
        mergeable: string;
        mergeStateStatus: string;
      };
      pr = {
        state: (parsed.state?.toLowerCase() as GitState["pr"]["state"]) ?? "none",
        url: parsed.url,
        mergeable: parsed.mergeable === "MERGEABLE",
        mergeStateStatus: parsed.mergeStateStatus,
      };
    } catch {
      // No PR for this branch — treat as "none"
    }
  }

  return {
    branch,
    hasUpstream,
    ahead,
    behind,
    dirtyStaged,
    dirtyUnstaged,
    conflicts,
    pr,
    ghInstalled,
  };
}
