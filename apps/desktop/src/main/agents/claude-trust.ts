import { existsSync } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { lock } from "proper-lockfile";
import { logger } from "../lib/logger";

/** Claude's global config: a legacy `<configDir>/.config.json` wins, else `.claude.json` in
 *  CLAUDE_CONFIG_DIR or the home directory (the lookup Claude Code itself does) */
export function claudeConfigFile(env: NodeJS.ProcessEnv = process.env): string {
  const legacy = join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), ".config.json");
  if (existsSync(legacy)) return legacy;
  return join(env.CLAUDE_CONFIG_DIR || homedir(), ".claude.json");
}

/** Claude keys projects by the NFC-normalized absolute path */
const trustKey = (path: string) => normalize(path.normalize("NFC"));

interface ClaudeConfig {
  projects?: Record<string, { hasTrustDialogAccepted?: boolean } & Record<string, unknown>>;
}

/**
 * The config with `folder` trusted when its project root already is; null when nothing changes.
 * Trust is only ever inherited: a folder of a project you never trusted keeps Claude's prompt
 */
export function inheritedTrust(
  config: ClaudeConfig,
  folder: string,
  projectRoot: string,
): ClaudeConfig | null {
  const projects = config.projects ?? {};
  if (!projects[trustKey(projectRoot)]?.hasTrustDialogAccepted) return null;
  const key = trustKey(folder);
  if (projects[key]?.hasTrustDialogAccepted) return null;
  return {
    ...config,
    projects: { ...projects, [key]: { ...projects[key], hasTrustDialogAccepted: true } },
  };
}

/** Folders found trusted this run: a launch there skips the lock and the read of a config that
 *  can be megabytes (a trust revoked meanwhile is seen next run) */
const knownTrusted = new Set<string>();

/**
 * A worktree or pipeline folder of a trusted project opens without Claude's "trust this
 * folder?" prompt, which stalled unattended steps. Under Claude's own lock on its config, never
 * broken: a held lock means skip and let Claude ask. Written to a temp file, then renamed.
 * True when it wrote the config
 */
export async function inheritClaudeTrust(folder: string, projectRoot: string): Promise<boolean> {
  const key = trustKey(folder);
  if (key === trustKey(projectRoot) || knownTrusted.has(key)) return false;
  const file = claudeConfigFile();
  if (!existsSync(file)) return false;
  let release: (() => Promise<void>) | null = null;
  try {
    release = await lock(file, {
      stale: 2 ** 30,
      retries: { retries: 3, factor: 2, minTimeout: 50, maxTimeout: 250 },
    });
  } catch {
    return false;
  }
  try {
    const config = JSON.parse(await readFile(file, "utf-8")) as ClaudeConfig;
    const next = inheritedTrust(config, folder, projectRoot);
    if (config.projects?.[key]?.hasTrustDialogAccepted || next) knownTrusted.add(key);
    if (!next) return false;
    const tmp = join(dirname(file), `.claude.json.exegol-${process.pid}.tmp`);
    await writeFile(tmp, JSON.stringify(next, null, 2), { mode: (await stat(file)).mode });
    await rename(tmp, file);
    logger.info("[ClaudeTrust] Trusted a folder of a trusted project");
    return true;
  } catch (err) {
    logger.warn("[ClaudeTrust] Could not record folder trust:", err);
    return false;
  } finally {
    await release?.().catch(() => {});
  }
}
