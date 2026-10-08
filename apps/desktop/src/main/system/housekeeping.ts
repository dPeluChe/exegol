import { lstat, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type Database from "libsql";
import { MODEL_SETTINGS_DIR } from "../agents/launch-model";
import { HOOKS_DIR } from "../agents/wrappers";
import { getJsonSetting, setJsonSetting } from "../db/queries/settings";
import { logger } from "../lib/logger";
import { MCP_CONFIG_DIR } from "../mcp/exegol-mcp-config";
import { scrollbackDir } from "./storage";

const AGENT_ID = /^[A-Za-z0-9_-]{21}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const START_DELAY_MS = 2 * 60 * 1000;
export const HOUSEKEEPING_KEY = "housekeeping_last_run";

/** A folder of `<agentId><suffix>` files that nothing removes once the agent row is gone */
export interface AgentFileTarget {
  label: string;
  dir: string;
  suffixes: readonly string[];
}

export interface HousekeepingResult {
  at: number;
  files: number;
  bytes: number;
  skipped?: "db-looks-reset";
}

export function agentFileTargets(userData: string): AgentFileTarget[] {
  return [
    // Claude Code hook settings: written at every spawn, never removed
    { label: "hooks", dir: HOOKS_DIR, suffixes: [".json"] },
    // Per-agent MCP config: removed on a clean exit only, and it carries the agent's token
    { label: "mcp", dir: MCP_CONFIG_DIR, suffixes: [".json"] },
    { label: "model-settings", dir: MODEL_SETTINGS_DIR, suffixes: [".json"] },
    { label: "scrollback", dir: scrollbackDir(userData), suffixes: [".log", ".serialized"] },
  ];
}

interface Candidate {
  label: string;
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
    if (!suffix) continue;
    const id = entry.name.slice(0, -suffix.length);
    if (!AGENT_ID.test(id)) continue;
    const path = join(target.dir, entry.name);
    const info = await lstat(path).catch(() => null);
    if (!info?.isFile() || info.mtimeMs > cutoff) continue;
    out.push({ label: target.label, path, id, bytes: info.size });
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
  const ids = knownIds();
  const orphans = candidates.filter((c) => !ids.has(c.id));
  // More orphaned ids than twice the known ones: a reset or swapped DB, not leftovers
  if (new Set(orphans.map((c) => c.id)).size > 2 * ids.size) {
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
    const sum = perLabel.get(c.label) ?? { files: 0, bytes: 0 };
    perLabel.set(c.label, { files: sum.files + 1, bytes: sum.bytes + c.bytes });
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

function agentIds(db: Database.Database): ReadonlySet<string> {
  const rows = db.prepare("SELECT id FROM agents").all() as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/** At most once a day: a couple of minutes after startup, then daily while the app stays open */
export function scheduleHousekeeping(db: Database.Database, userData: string): void {
  const run = () => {
    const last = getJsonSetting<HousekeepingResult | null>(db, HOUSEKEEPING_KEY, null);
    if (last && Date.now() - last.at < DAY_MS) return;
    sweepOrphanAgentFiles(agentFileTargets(userData), () => agentIds(db))
      .then((result) => setJsonSetting(db, HOUSEKEEPING_KEY, result))
      .catch((err) => logger.warn("[Housekeeping] sweep failed:", err));
  };
  setTimeout(run, START_DELAY_MS).unref?.();
  setInterval(run, DAY_MS).unref?.();
}
