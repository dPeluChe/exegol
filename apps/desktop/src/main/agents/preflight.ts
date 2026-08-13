import { exec } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentCliType } from "@exegol/shared";
import type Database from "libsql";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PreflightIssue {
  code: string;
  message: string;
}

export interface PreflightResult {
  ok: boolean;
  /** Blocking — spawn should not proceed */
  errors: PreflightIssue[];
  /** Non-blocking — spawn proceeds but user should be informed */
  warnings: PreflightIssue[];
}

// ─── Individual checks ────────────────────────────────────────────────────────

function checkCliAvailable(command: string): Promise<boolean> {
  const cmd = process.platform === "win32" ? `where "${command}"` : `which "${command}"`;
  return new Promise((resolve) => exec(cmd, (err) => resolve(!err)));
}

async function checkProjectPath(projectPath: string): Promise<"ok" | "missing" | "not-dir"> {
  try {
    const s = await stat(projectPath);
    return s.isDirectory() ? "ok" : "not-dir";
  } catch {
    return "missing";
  }
}

async function checkGitRepo(projectPath: string): Promise<boolean> {
  try {
    await access(join(projectPath, ".git"));
    return true;
  } catch {
    return false;
  }
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export interface PreflightOptions {
  cliType: AgentCliType;
  command: string;
  projectPath: string;
  useWorktree?: boolean;
  coreRustLoaded?: boolean;
}

export async function runPreflight(
  _db: Database.Database,
  opts: PreflightOptions,
): Promise<PreflightResult> {
  const errors: PreflightIssue[] = [];
  const warnings: PreflightIssue[] = [];

  // Run all checks concurrently. "__shell__" is the plain-shell sentinel
  // (registry "shell" provider) — resolved to $SHELL at spawn, never on PATH.
  const [cliFound, pathStatus, isGitRepo] = await Promise.all([
    opts.command === "__shell__" ? Promise.resolve(true) : checkCliAvailable(opts.command),
    checkProjectPath(opts.projectPath),
    opts.useWorktree ? checkGitRepo(opts.projectPath) : Promise.resolve(true),
  ]);

  // ── Error: CLI not found ──────────────────────────────────────────────────
  if (!cliFound) {
    errors.push({
      code: "CLI_NOT_FOUND",
      message: `Command '${opts.command}' not found on PATH. Install it or configure a custom path in Settings > CLIs.`,
    });
  }

  // ── Error: project path invalid ──────────────────────────────────────────
  if (pathStatus === "missing") {
    errors.push({
      code: "PROJECT_PATH_MISSING",
      message: `Project directory does not exist: ${opts.projectPath}`,
    });
  } else if (pathStatus === "not-dir") {
    errors.push({
      code: "PROJECT_PATH_NOT_DIR",
      message: `Project path is not a directory: ${opts.projectPath}`,
    });
  }

  // No API-key check here on purpose: claude and codex authenticate through the
  // user's subscription, so warning about a missing OPENAI_API_KEY on every
  // codex spawn was pure noise for a non-problem. Exegol's OWN AI features
  // (commit messages, scoring, evaluator gates) do need keys — Doctor checks
  // those, where the finding is actionable.

  // ── Warning: worktree requested but git repo not detected ─────────────────
  if (opts.useWorktree && pathStatus === "ok" && !isGitRepo) {
    warnings.push({
      code: "NOT_GIT_REPO",
      message:
        "Worktree isolation requested but project directory is not a git repo. Agent will run in project root.",
    });
  }

  // ── Warning: worktree requested but Rust module unavailable ──────────────
  if (opts.useWorktree && opts.coreRustLoaded === false) {
    warnings.push({
      code: "RUST_MODULE_UNAVAILABLE",
      message:
        "Worktree isolation unavailable: native Rust module not loaded. Agent will run in project root.",
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}
