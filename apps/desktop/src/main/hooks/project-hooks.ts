// Project hook scripts (T60) — exegol.yaml parsing + execution.
// Inspired by Orca's hook system: setup/archive scripts per project.

import { exec } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../lib/logger";
import { inspectCommand } from "../security/command-guard";

const HOOK_TIMEOUT_MS = 120_000; // 2 minutes

export interface ProjectHooks {
  setup?: string; // Runs after worktree creation
  archive?: string; // Runs before worktree deletion
}

/**
 * Parse exegol.yaml from a project root directory.
 * Supports simple YAML: `setup: "command"` and `archive: "command"`.
 */
export function parseProjectHooks(projectPath: string): ProjectHooks | null {
  const yamlPath = join(projectPath, "exegol.yaml");
  if (!existsSync(yamlPath)) return null;

  try {
    const content = readFileSync(yamlPath, "utf-8");
    const hooks: ProjectHooks = {};

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed) continue;

      // Simple YAML: key: value (supports quotes, strips trailing comments)
      const setupMatch = trimmed.match(/^setup:\s*["']?(.+?)["']?\s*(?:#.*)?$/);
      if (setupMatch?.[1]) hooks.setup = setupMatch[1].trim();

      const archiveMatch = trimmed.match(/^archive:\s*["']?(.+?)["']?\s*(?:#.*)?$/);
      if (archiveMatch?.[1]) hooks.archive = archiveMatch[1].trim();
    }

    return hooks.setup || hooks.archive ? hooks : null;
  } catch {
    return null;
  }
}

/**
 * Execute a hook script in the context of a worktree.
 * Non-blocking, returns a promise. Logs output/errors.
 */
export function runHook(
  script: string,
  opts: {
    cwd: string;
    projectPath: string;
    worktreePath: string;
    branchName: string;
  },
): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      EXEGOL_ROOT_PATH: opts.projectPath,
      EXEGOL_WORKTREE_PATH: opts.worktreePath,
      EXEGOL_BRANCH: opts.branchName,
    };

    const verdict = inspectCommand(script);
    if (!verdict.ok) {
      logger.error(`[Hooks] Refused by safety guard (${verdict.reason}): ${script}`);
      resolve({ success: false, output: `Refused by safety guard: ${verdict.reason}` });
      return;
    }

    logger.info(`[Hooks] Running: ${script}`, { cwd: opts.cwd });

    exec(
      script,
      { cwd: opts.cwd, env, timeout: HOOK_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          logger.warn(`[Hooks] Failed: ${script}`, { error: err.message, stderr });
          resolve({ success: false, output: stderr || err.message });
        } else {
          logger.info(`[Hooks] Completed: ${script}`);
          resolve({ success: true, output: stdout });
        }
      },
    );
  });
}

/**
 * Run the setup hook for a project after worktree creation.
 * Non-blocking — fires and forgets (logs result).
 */
export async function runSetupHook(
  projectPath: string,
  worktreePath: string,
  branchName: string,
): Promise<void> {
  const hooks = parseProjectHooks(projectPath);
  if (!hooks?.setup) return;

  await runHook(hooks.setup, {
    cwd: worktreePath,
    projectPath,
    worktreePath,
    branchName,
  });
}

/**
 * Run the archive hook for a project before worktree deletion.
 * Blocking — waits for completion before proceeding with deletion.
 */
export async function runArchiveHook(
  projectPath: string,
  worktreePath: string,
  branchName: string,
): Promise<void> {
  const hooks = parseProjectHooks(projectPath);
  if (!hooks?.archive) return;

  await runHook(hooks.archive, {
    cwd: worktreePath,
    projectPath,
    worktreePath,
    branchName,
  });
}
