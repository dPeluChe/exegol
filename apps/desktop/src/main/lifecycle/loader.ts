/**
 * Lifecycle Scripts per Repo (T91)
 *
 * Reads .exegol/lifecycle.yaml from a project root and returns
 * deterministic setup/teardown/hook commands. Uses a simple
 * line-based parser since the format is flat key:value.
 */

import { exec } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../lib/logger";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface LifecycleConfig {
  setup?: string;
  beforeAgent?: string;
  afterCommit?: string;
  teardown?: string;
}

// camelCase in YAML is fine, but also support snake_case variants
const KEY_ALIASES: Record<string, keyof LifecycleConfig> = {
  setup: "setup",
  beforeagent: "beforeAgent",
  before_agent: "beforeAgent",
  aftercommit: "afterCommit",
  after_commit: "afterCommit",
  teardown: "teardown",
};

const HOOK_TIMEOUT_MS = 120_000; // 2 minutes

// ─── Per-path lifecycle config cache (session-scoped) ──────────────────────
// lifecycle.yaml is read twice per spawn (runSetupIfNeeded + manager explicit call).
// Cache eliminates the duplicate existsSync+readFileSync on subsequent calls.

const lifecycleConfigCache = new Map<string, LifecycleConfig | null>();

// ─── Track which projects have had setup run this session ──────────────────

const setupRanThisSession = new Set<string>();

export function hasRunSetup(projectPath: string): boolean {
  return setupRanThisSession.has(projectPath);
}

export function markSetupRan(projectPath: string): void {
  setupRanThisSession.add(projectPath);
}

// ─── Loader ────────────────────────────────────────────────────────────────

/**
 * Load .exegol/lifecycle.yaml from the given project path.
 * Returns null if the file doesn't exist or has no valid keys.
 * Result is cached for the session lifetime (file rarely changes at runtime).
 */
export function loadLifecycleConfig(projectPath: string): LifecycleConfig | null {
  if (lifecycleConfigCache.has(projectPath)) {
    return lifecycleConfigCache.get(projectPath) ?? null;
  }
  const dir = join(projectPath, ".exegol");
  const yamlPath = existsSync(join(dir, "lifecycle.yaml"))
    ? join(dir, "lifecycle.yaml")
    : existsSync(join(dir, "lifecycle.yml"))
      ? join(dir, "lifecycle.yml")
      : null;
  if (!yamlPath) {
    lifecycleConfigCache.set(projectPath, null);
    return null;
  }

  let result: LifecycleConfig | null = null;
  try {
    const content = readFileSync(yamlPath, "utf-8");
    result = parseLifecycleYaml(content);
  } catch (err) {
    logger.warn("[Lifecycle] Failed to read lifecycle config:", err);
  }
  lifecycleConfigCache.set(projectPath, result);
  return result;
}

/**
 * Simple line-based parser for flat key:value YAML.
 * Supports comments (#), quoted values, and trailing comment stripping.
 */
export function parseLifecycleYaml(content: string): LifecycleConfig | null {
  const config: LifecycleConfig = {};
  let hasKeys = false;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Match key: value (with optional quotes)
    const match = trimmed.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
    if (!match?.[1] || !match[2]) continue;

    const rawKey = match[1].toLowerCase();
    const canonicalKey = KEY_ALIASES[rawKey];
    if (!canonicalKey) continue;

    // Strip surrounding quotes and trailing comments
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      // Strip trailing comment (not inside quotes)
      const commentIdx = value.indexOf(" #");
      if (commentIdx !== -1) {
        value = value.slice(0, commentIdx).trim();
      }
    }

    if (value) {
      config[canonicalKey] = value;
      hasKeys = true;
    }
  }

  return hasKeys ? config : null;
}

// ─── Runner ────────────────────────────────────────────────────────────────

/**
 * Execute a lifecycle script in a given working directory.
 * Returns a promise with success/output. Non-fatal by design.
 */
export function runLifecycleScript(
  script: string,
  cwd: string,
  label: string,
): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    logger.info(`[Lifecycle] Running ${label}: ${script}`, { cwd });

    exec(
      script,
      { cwd, timeout: HOOK_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          logger.warn(`[Lifecycle] ${label} failed:`, { error: err.message, stderr });
          resolve({ success: false, output: stderr || err.message });
        } else {
          logger.info(`[Lifecycle] ${label} completed`);
          resolve({ success: true, output: stdout });
        }
      },
    );
  });
}

/**
 * Run the setup script for a project if it hasn't been run this session.
 * Non-blocking — caller should fire-and-forget or await as needed.
 */
export async function runSetupIfNeeded(projectPath: string): Promise<void> {
  if (hasRunSetup(projectPath)) return;

  const config = loadLifecycleConfig(projectPath);
  if (!config?.setup) return;

  markSetupRan(projectPath);
  await runLifecycleScript(config.setup, projectPath, "setup");
}
