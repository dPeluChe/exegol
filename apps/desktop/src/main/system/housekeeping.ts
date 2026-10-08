import { lstat, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type Database from "libsql";
import { getJsonSetting, setJsonSetting } from "../db/queries/settings";
import { logger } from "../lib/logger";

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
}

export function agentFileTargets(paths: { exegolDir: string; userData: string }) {
  return [
    // Claude Code hook settings: written at every spawn, never removed
    { label: "hooks", dir: join(paths.exegolDir, "hooks"), suffixes: [".json"] },
    // Per-agent MCP config: removed on a clean exit only, and it carries the agent's token
    { label: "mcp", dir: join(paths.exegolDir, "mcp"), suffixes: [".json"] },
    { label: "model-settings", dir: join(paths.exegolDir, "model-settings"), suffixes: [".json"] },
    {
      label: "scrollback",
      dir: join(paths.userData, "scrollback"),
      suffixes: [".log", ".serialized"],
    },
  ] satisfies AgentFileTarget[];
}

interface Candidate {
  label: string;
  name: string;
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
    out.push({ label: target.label, name: entry.name, path, id, bytes: info.size });
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
  const candidates = lists.flat();
  const result: HousekeepingResult = { at: now, files: 0, bytes: 0 };
  if (candidates.length === 0) return result;
  const ids = knownIds();
  // An empty agents table more likely means the wrong or a fresh DB than "everything is orphaned"
  if (ids.size === 0) return result;
  for (const c of candidates) {
    if (ids.has(c.id)) continue;
    try {
      await unlink(c.path);
      result.files++;
      result.bytes += c.bytes;
      logger.info(`[Housekeeping] removed ${c.label}/${c.name} (${c.bytes} bytes)`);
    } catch {
      /* gone already or not ours to remove */
    }
  }
  return result;
}

function agentIds(db: Database.Database): ReadonlySet<string> {
  const rows = db.prepare("SELECT id FROM agents").all() as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/** Once a day at most, a couple of minutes after startup, off the critical path */
export function scheduleHousekeeping(
  db: Database.Database,
  paths: { exegolDir: string; userData: string },
): void {
  const timer = setTimeout(() => {
    const last = getJsonSetting<HousekeepingResult | null>(db, HOUSEKEEPING_KEY, null);
    if (last && Date.now() - last.at < DAY_MS) return;
    sweepOrphanAgentFiles(agentFileTargets(paths), () => agentIds(db))
      .then((result) => {
        setJsonSetting(db, HOUSEKEEPING_KEY, result);
        if (result.files > 0) {
          logger.info(`[Housekeeping] ${result.files} orphaned file(s), ${result.bytes} bytes`);
        }
      })
      .catch((err) => logger.warn("[Housekeeping] sweep failed:", err));
  }, START_DELAY_MS);
  timer.unref?.();
}
