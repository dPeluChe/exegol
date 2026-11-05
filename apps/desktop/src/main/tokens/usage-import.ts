import type Database from "libsql";
import { getJsonSetting, setJsonSetting } from "../db/queries/settings";
import { importScannedTokenUsage } from "../db/queries/token-usage";
import { logger } from "../lib/logger";
import { isInside } from "../system/ports";
import { scanAllLogs } from "./log-parser";

export const USAGE_IMPORT_KEY = "token_usage_import";
const WINDOW_SEC = 30 * 86400;
/** mtime granularity and a write landing while the previous scan listed files */
const OVERLAP_SEC = 300;
const START_DELAY_MS = 90 * 1000;
const INTERVAL_MS = 30 * 60 * 1000;

export interface UsageImportState {
  /** Unix seconds the last import started */
  at: number;
  imported: number;
  skipped: number;
}

/** Records from the last 30 days, read only from files written since the last import */
export function importWindow(
  last: UsageImportState | null,
  now: number,
): { since: number; modifiedSince: number } {
  const since = now - WINDOW_SEC;
  return { since, modifiedSince: last ? Math.max(since, last.at - OVERLAP_SEC) : 0 };
}

export interface ProjectRoot {
  projectId: string;
  path: string;
}

/** The deepest root wins, so a nested project or a worktree takes its own sessions */
export function projectForCwd(roots: ProjectRoot[], cwd: string | undefined): string | null {
  let best: ProjectRoot | null = null;
  for (const root of roots) {
    if (isInside(cwd, root.path) && (!best || root.path.length > best.path.length)) best = root;
  }
  return best?.projectId ?? null;
}

function projectRoots(db: Database.Database): ProjectRoot[] {
  return db
    .prepare(
      `SELECT id AS projectId, path FROM projects
       UNION ALL SELECT project_id AS projectId, path FROM worktrees`,
    )
    .all() as ProjectRoot[];
}

let running: Promise<UsageImportState> | null = null;

/** Sessions outside every project (and aider's, which carry no folder) are skipped */
export function runUsageImport(db: Database.Database): Promise<UsageImportState> {
  running ??= (async () => {
    const started = Date.now();
    const at = Math.floor(started / 1000);
    const { since, modifiedSince } = importWindow(
      getJsonSetting<UsageImportState | null>(db, USAGE_IMPORT_KEY, null),
      at,
    );
    const { entries } = await scanAllLogs(since, undefined, undefined, modifiedSince);
    const roots = projectRoots(db);
    const result = await importScannedTokenUsage(db, entries, (e) => projectForCwd(roots, e.cwd));
    const state = { at, ...result };
    setJsonSetting(db, USAGE_IMPORT_KEY, state);
    if (entries.length > 0) {
      logger.info(
        `[TokenUsage] imported ${result.imported} (skipped ${result.skipped}) in ${Date.now() - started}ms`,
      );
    }
    return state;
  })().finally(() => {
    running = null;
  });
  return running;
}

export function scheduleUsageImport(db: Database.Database): void {
  const run = () =>
    void runUsageImport(db).catch((err) => logger.warn("[TokenUsage] import failed:", err));
  setTimeout(run, START_DELAY_MS).unref?.();
  setInterval(run, INTERVAL_MS).unref?.();
}
