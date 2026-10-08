import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { lstat, readdir, rm, statfs } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  BrowserPartitionUsage,
  StorageCategory,
  StorageOtherEntry,
  StorageReport,
  StorageRoot,
  StorageRow,
} from "@exegol/shared";
import { createLimiter, mapWithConcurrency } from "../lib/concurrency";

export interface StoragePaths {
  exegolDir: string;
  userData: string;
  logDir: string;
}

export const scrollbackDir = (userData: string) => join(userData, "scrollback");

const CACHE_MS = 30_000;
const fsLimit = createLimiter(32);
const execFileAsync = promisify(execFile);
// Only what clearBrowserCache clears (clearCache, clearCodeCaches): GPU caches stay in use
const PARTITION_CACHE_DIRS = ["Cache", "Code Cache"];
const DB_FILES = ["exegol.db", "exegol.db-wal", "exegol.db-shm"];
const ROTATED_LOG = /^exegol\.\d+\.log$/;

/** Bytes under `path` without following links; 0 when missing. `skip` names top-level children */
export async function dirSize(
  path: string,
  skip: ReadonlySet<string> = new Set(),
): Promise<number> {
  let total = 0;
  let level: string[] = [path];
  // Breadth-first queue, one level at a time with bounded concurrency: no recursion, no promise fan-out
  while (level.length > 0) {
    const next: string[] = [];
    await mapWithConcurrency(level, 16, async (current) => {
      const info = await fsLimit(() => lstat(current)).catch(() => null);
      if (!info) return;
      if (info.isFile()) total += info.size;
      if (!info.isDirectory()) return;
      const entries: Dirent[] = await fsLimit(() =>
        readdir(current, { withFileTypes: true }),
      ).catch(() => []);
      for (const e of entries) {
        if (e.isSymbolicLink() || (current === path && skip.has(e.name))) continue;
        next.push(join(current, e.name));
      }
    });
    level = next;
  }
  return total;
}

/** Disk use of a large tree via `du -sk` (no links followed), null when it fails or times out */
export async function duBytes(path: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("du", ["-sk", path], { timeout: 10_000 });
    const kb = Number.parseInt(stdout.split(/\s/)[0] ?? "", 10);
    return Number.isNaN(kb) ? null : kb * 1024;
  } catch {
    return null;
  }
}

async function sumPaths(
  paths: string[],
  size: (path: string) => Promise<number | null> = dirSize,
): Promise<number> {
  const sizes = await Promise.all(paths.map((p) => size(p)));
  return sizes.reduce<number>((a, b) => a + (b ?? 0), 0);
}

interface CategorySpec {
  category: StorageCategory;
  label: string;
  paths: string[];
}

function categorySpecs(p: StoragePaths): CategorySpec[] {
  return [
    { category: "models", label: "Speech models", paths: [join(p.exegolDir, "models")] },
    {
      category: "scrollback",
      label: "Terminal scrollback",
      paths: [scrollbackDir(p.userData), join(p.exegolDir, "ring-evicted")],
    },
    {
      category: "screenshots",
      label: "Agent browser screenshots",
      paths: [join(p.exegolDir, "screenshots")],
    },
    { category: "logs", label: "Logs", paths: [p.logDir] },
    { category: "database", label: "Database", paths: DB_FILES.map((f) => join(p.userData, f)) },
    {
      category: "worktrees",
      label: "Exegol worktrees",
      paths: [join(p.exegolDir, "worktrees"), join(p.exegolDir, "pipelines")],
    },
    { category: "browser", label: "Browser panes", paths: [join(p.userData, "Partitions")] },
  ];
}

/** Partitions/project-<id> folders, matched to projects case-blind (Chromium lowercases them) */
async function partitionUsage(
  partitionsDir: string,
  projects: readonly { id: string; name: string }[],
): Promise<BrowserPartitionUsage[]> {
  const names = await readdir(partitionsDir).catch(() => [] as string[]);
  const byLower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const usage = await mapWithConcurrency([...projects], 4, async (project) => {
    const dirName = byLower.get(`project-${project.id}`.toLowerCase());
    if (!dirName) return null;
    const dir = join(partitionsDir, dirName);
    const [bytes, cacheBytes] = await Promise.all([
      dirSize(dir),
      sumPaths(PARTITION_CACHE_DIRS.map((c) => join(dir, c))),
    ]);
    return { projectId: project.id, projectName: project.name, bytes, cacheBytes };
  });
  return usage
    .filter((u): u is BrowserPartitionUsage => u !== null)
    .sort((a, b) => b.bytes - a.bytes);
}

export function storageRootDir(paths: StoragePaths, root: StorageRoot): string {
  return root === "exegol" ? paths.exegolDir : paths.userData;
}

/** Top-level children of both roots that no category counted, largest first; empty ones dropped */
async function otherEntries(
  paths: StoragePaths,
  counted: ReadonlySet<string>,
): Promise<StorageOtherEntry[]> {
  const roots: StorageRoot[] = ["exegol", "userData"];
  const lists = await Promise.all(
    roots.map(async (root) => {
      const dir = storageRootDir(paths, root);
      const entries: Dirent[] = await readdir(dir, { withFileTypes: true }).catch(() => []);
      const kept = entries.filter((e) => !e.isSymbolicLink() && !counted.has(e.name));
      return mapWithConcurrency(kept, 4, async (e) => ({
        root,
        name: e.name,
        isDir: e.isDirectory(),
        bytes: await dirSize(join(dir, e.name)),
      }));
    }),
  );
  return lists
    .flat()
    .filter((e) => e.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
}

/** Disk use per worktree id; a missing folder counts 0, a failed measure is null (unknown) */
export async function worktreeSizes(
  worktrees: readonly { id: string; path: string }[],
  measure: (path: string) => Promise<number | null> = duBytes,
): Promise<Record<string, number | null>> {
  const sizes = await mapWithConcurrency([...worktrees], 4, async (wt) =>
    (await lstat(wt.path).catch(() => null)) ? measure(wt.path) : 0,
  );
  return Object.fromEntries(worktrees.map((wt, i) => [wt.id, sizes[i] ?? null]));
}

export type OtherTarget =
  | { ok: true; target: string; isDir: boolean }
  | { ok: false; reason: string };

/** An Other entry to open: listed in `report` (never re-walked) and not a link at open time */
export async function resolveOtherTarget(
  paths: StoragePaths,
  report: StorageReport | null,
  root: StorageRoot,
  name: string,
): Promise<OtherTarget> {
  if (!report) return { ok: false, reason: "Disk use not measured yet: refresh and try again" };
  if (!report.otherEntries.some((e) => e.root === root && e.name === name)) {
    return { ok: false, reason: `${name} is not listed under Other` };
  }
  const target = join(storageRootDir(paths, root), name);
  const info = await lstat(target).catch(() => null);
  if (!info) return { ok: false, reason: `${name} no longer exists` };
  if (info.isSymbolicLink()) return { ok: false, reason: `${name} is a link, not opened` };
  return { ok: true, target, isDir: info.isDirectory() };
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    if (await lstat(path).catch(() => null)) return path;
  }
  return null;
}

export async function buildStorageReport(
  paths: StoragePaths,
  projects: readonly { id: string; name: string }[],
): Promise<StorageReport> {
  const specs = categorySpecs(paths);
  const rows: StorageRow[] = await mapWithConcurrency(specs, 4, async (spec) => {
    const folders = spec.category === "database" ? [paths.userData] : spec.paths;
    return {
      category: spec.category,
      label: spec.label,
      // Worktrees hold whole checkouts (node_modules too): du is far faster there
      bytes: await sumPaths(spec.paths, spec.category === "worktrees" ? duBytes : dirSize),
      path: await firstExisting(folders),
    };
  });

  // Everything else under the two roots: the children the rows above already counted are skipped
  const counted = new Set(specs.flatMap((s) => s.paths).map((p) => p.split(/[\\/]/).pop() ?? ""));
  const others = await otherEntries(paths, counted);
  rows.push({
    category: "other",
    label: "Other",
    bytes: others.reduce((a, e) => a + e.bytes, 0),
    path: paths.exegolDir,
  });

  const fsInfo = await statfs(paths.exegolDir).catch(() => null);
  return {
    rows,
    totalBytes: rows.reduce((a, r) => a + r.bytes, 0),
    browserPartitions: await partitionUsage(join(paths.userData, "Partitions"), projects),
    otherEntries: others,
    freeBytes: fsInfo ? fsInfo.bavail * fsInfo.bsize : null,
    diskBytes: fsInfo ? fsInfo.blocks * fsInfo.bsize : null,
    computedAt: Date.now(),
  };
}

let cached: { report: StorageReport; at: number } | null = null;
let inflight: Promise<StorageReport> | null = null;

/** The report, recomputed at most every 30s; `fresh` after an action that freed space */
export function getStorageReport(
  paths: StoragePaths,
  projects: readonly { id: string; name: string }[],
  fresh = false,
): Promise<StorageReport> {
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.report);
  if (inflight) return inflight;
  inflight = buildStorageReport(paths, projects)
    .then((report) => {
      cached = { report, at: Date.now() };
      return report;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The last computed report, whatever its age; null before the first one or after an invalidate */
export function cachedStorageReport(): StorageReport | null {
  return cached?.report ?? null;
}

export function invalidateStorageReport(): void {
  cached = null;
}

/** Deletes every screenshot; the folder stays */
export async function clearScreenshots(exegolDir: string): Promise<void> {
  const dir = join(exegolDir, "screenshots");
  const names = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(names.map((n) => rm(join(dir, n), { force: true, recursive: true })));
}

/** Deletes the rotated logs of earlier sessions; this session's exegol.log and sidecar.log stay */
export async function clearOldLogs(logDir: string): Promise<number> {
  const names = await readdir(logDir).catch(() => [] as string[]);
  const old = names.filter((n) => ROTATED_LOG.test(n));
  await Promise.all(old.map((n) => rm(join(logDir, n), { force: true })));
  return old.length;
}
