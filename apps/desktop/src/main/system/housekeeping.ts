import { lstat, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { dictationSettingsOf } from "@exegol/shared";
import type Database from "libsql";
import { MODEL_SETTINGS_DIR } from "../agents/launch-model";
import { WORKTREE_ROOTS } from "../agents/worktrees";
import { HOOKS_DIR } from "../agents/wrappers";
import { listLiveAgentFolders } from "../db/queries/agents";
import { getAppSettings, getJsonSetting, setJsonSetting } from "../db/queries/settings";
import { sweepRecordings } from "../dictation/recordings";
import { logger } from "../lib/logger";
import { MCP_CONFIG_DIR } from "../mcp/exegol-mcp-config";
import { MCP_TOKENS_DIR, tokenKeyFor } from "../mcp/exegol-mcp-token-file";
import { sweepOrphanWorktrees, type WorktreeSweepResult } from "./worktree-housekeeping";

const AGENT_ID = /^[A-Za-z0-9_-]{21}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const START_DELAY_MS = 2 * 60 * 1000;
export const HOUSEKEEPING_KEY = "housekeeping_last_run";

/** A folder of `<agentId><suffix>` files that nothing removes once the agent row is gone */
export interface AgentFileTarget {
  label: string;
  dir: string;
  suffixes: readonly string[];
  /** The file name minus its suffix; an agent id by default */
  id?: RegExp;
  /** Ids to keep instead of the DB's agent ids; such a target skips the reset-DB guard */
  keep?: () => ReadonlySet<string>;
}

export interface HousekeepingResult {
  at: number;
  files: number;
  bytes: number;
  skipped?: "db-looks-reset";
  worktrees?: WorktreeSweepResult;
}

/** Agent history (scrollback) is never swept: it stays as long as the session's row */
export function agentFileTargets(): AgentFileTarget[] {
  return [
    // Claude Code hook settings: written at every spawn, never removed
    { label: "hooks", dir: HOOKS_DIR, suffixes: [".json"] },
    // Per-agent MCP config: removed on a clean exit only, and it carries the agent's token
    { label: "mcp", dir: MCP_CONFIG_DIR, suffixes: [".json"] },
    { label: "model-settings", dir: MODEL_SETTINGS_DIR, suffixes: [".json"] },
  ];
}

interface Candidate {
  target: AgentFileTarget;
  path: string;
  id: string;
  bytes: number;
}

async function listCandidates(target: AgentFileTarget, cutoff: number): Promise<Candidate[]> {
  const dirInfo = await lstat(target.dir).catch(() => null);
  if (!dirInfo?.isDirectory()) return [];
  const entries = await readdir(target.dir, { withFileTypes: true }).catch(() => []);
  const out: Candidate[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const suffix = target.suffixes.find((s) => entry.name.endsWith(s));
    if (suffix === undefined) continue;
    const id = entry.name.slice(0, entry.name.length - suffix.length);
    if (!(target.id ?? AGENT_ID).test(id)) continue;
    const path = join(target.dir, entry.name);
    const info = await lstat(path).catch(() => null);
    if (!info?.isFile() || info.mtimeMs > cutoff) continue;
    out.push({ target, path, id, bytes: info.size });
  }
  return out;
}

/**
 * Removes per-agent files whose agent id is not in the DB. Files are listed BEFORE the ids are
 * read, and only files older than `minAgeMs` qualify, so an agent created mid-sweep is never hit
 */
export async function sweepOrphanAgentFiles(
  targets: readonly AgentFileTarget[],
  knownIds: () => ReadonlySet<string>,
  now = Date.now(),
  minAgeMs = DAY_MS,
): Promise<HousekeepingResult> {
  const lists = await Promise.all(targets.map((t) => listCandidates(t, now - minAgeMs)));
  const result: HousekeepingResult = { at: now, files: 0, bytes: 0 };
  const candidates = lists.flat();
  if (candidates.length === 0) return result;
  const sets = new Map<() => ReadonlySet<string>, ReadonlySet<string>>();
  const read = (source: () => ReadonlySet<string>) => {
    const set = sets.get(source) ?? source();
    sets.set(source, set);
    return set;
  };
  const orphans = candidates.filter((c) => !read(c.target.keep ?? knownIds).has(c.id));
  const guarded = new Set(orphans.filter((c) => !c.target.keep).map((c) => c.id));
  // More orphaned ids than twice the known ones: a reset or swapped DB, not leftovers
  if (guarded.size > 0 && guarded.size > 2 * read(knownIds).size) {
    logger.warn("[Housekeeping] skipped: the agents table looks reset");
    return { ...result, skipped: "db-looks-reset" };
  }
  const perLabel = new Map<string, { files: number; bytes: number }>();
  for (const c of orphans) {
    try {
      await unlink(c.path);
    } catch {
      continue;
    }
    const sum = perLabel.get(c.target.label) ?? { files: 0, bytes: 0 };
    perLabel.set(c.target.label, { files: sum.files + 1, bytes: sum.bytes + c.bytes });
    result.files++;
    result.bytes += c.bytes;
  }
  for (const [label, sum] of perLabel) {
    logger.info(
      `[Housekeeping] removed ${sum.files} orphaned ${label} file(s), ${sum.bytes} bytes`,
    );
  }
  return result;
}

/** Per-directory MCP token files no live agent's folder maps to: the last exit removes its
 *  own, this catches a crash or a kill. Keyed by spawn folder, as `writeTokenFile` is called */
export function mcpTokenTarget(liveFolders: () => readonly string[]): AgentFileTarget {
  return {
    label: "mcp-token",
    dir: MCP_TOKENS_DIR,
    suffixes: [""],
    id: /^[0-9a-f]{32}$/,
    keep: () => new Set(liveFolders().map(tokenKeyFor)),
  };
}

function agentIds(db: Database.Database): ReadonlySet<string> {
  const rows = db.prepare("SELECT id FROM agents").all() as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/** At most once a day: a couple of minutes after startup, then daily while the app stays open.
 *  Dictation recordings are swept on every run, the start one included */
export function scheduleHousekeeping(db: Database.Database): void {
  const run = async () => {
    await sweepRecordings(
      dictationSettingsOf(getAppSettings(db).dictation).recordingsRetentionDays,
    );
    const last = getJsonSetting<HousekeepingResult | null>(db, HOUSEKEEPING_KEY, null);
    if (last && Date.now() - last.at < DAY_MS) return;
    const result = await sweepOrphanAgentFiles(
      [...agentFileTargets(), mcpTokenTarget(() => listLiveAgentFolders(db))],
      () => agentIds(db),
    );
    const worktrees = await sweepOrphanWorktrees(db, Object.values(WORKTREE_ROOTS));
    if (worktrees.removed + worktrees.droppedRows + worktrees.kept > 0) {
      logger.info(
        `[Housekeeping] worktrees: removed ${worktrees.removed}, dropped ${worktrees.droppedRows} row(s) of missing dirs, kept ${worktrees.kept} orphan(s) not clean and pushed`,
      );
    }
    setJsonSetting(db, HOUSEKEEPING_KEY, { ...result, worktrees });
  };
  const safeRun = () => void run().catch((err) => logger.warn("[Housekeeping] sweep failed:", err));
  setTimeout(safeRun, START_DELAY_MS).unref?.();
  setInterval(safeRun, DAY_MS).unref?.();
}
