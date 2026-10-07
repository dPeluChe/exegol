import type { Dirent } from "node:fs";
import { lstat, readdir, rm, statfs } from "node:fs/promises";
import { join } from "node:path";
import type {
  BrowserPartitionUsage,
  StorageCategory,
  StorageReport,
  StorageRow,
} from "@exegol/shared";
import { createLimiter, mapWithConcurrency } from "../lib/concurrency";

export interface StoragePaths {
  exegolDir: string;
  userData: string;
  logDir: string;
}

const CACHE_MS = 30_000;
const fsLimit = createLimiter(32);
const PARTITION_CACHE_DIRS = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
];
const DB_FILES = ["exegol.db", "exegol.db-wal", "exegol.db-shm"];
const ROTATED_LOG = /^exegol\.\d+\.log$/;

/** Bytes under `path` without following links; 0 when missing. `skip` names top-level children */
export async function dirSize(
  path: string,
  skip: ReadonlySet<string> = new Set(),
): Promise<number> {
  const info = await fsLimit(() => lstat(path)).catch(() => null);
  if (!info) return 0;
  if (!info.isDirectory()) return info.isFile() ? info.size : 0;
  const entries: Dirent[] = await fsLimit(() => readdir(path, { withFileTypes: true })).catch(
    () => [],
  );
  const sizes = await Promise.all(
    entries
      .filter((e) => !skip.has(e.name) && !e.isSymbolicLink())
      .map((e) => dirSize(join(path, e.name))),
  );
  return sizes.reduce((a, b) => a + b, 0);
}

async function sumPaths(paths: string[]): Promise<number> {
  const sizes = await Promise.all(paths.map((p) => dirSize(p)));
  return sizes.reduce((a, b) => a + b, 0);
}

interface CategorySpec {
  category: StorageCategory;
  label: string;
  paths: string[];
}

export function categorySpecs(p: StoragePaths): CategorySpec[] {
  return [
    { category: "models", label: "Speech models", paths: [join(p.exegolDir, "models")] },
    {
      category: "scrollback",
      label: "Terminal scrollback",
      paths: [join(p.userData, "scrollback"), join(p.exegolDir, "ring-evicted")],
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
      bytes: await sumPaths(spec.paths),
      path: await firstExisting(folders),
    };
  });

  // Everything else under the two roots: the children the rows above already counted are skipped
  const counted = new Set(specs.flatMap((s) => s.paths).map((p) => p.split(/[\\/]/).pop() ?? ""));
  const other =
    (await dirSize(paths.exegolDir, counted)) + (await dirSize(paths.userData, counted));
  rows.push({ category: "other", label: "Other", bytes: other, path: paths.exegolDir });

  const fsInfo = await statfs(paths.exegolDir).catch(() => null);
  return {
    rows,
    totalBytes: rows.reduce((a, r) => a + r.bytes, 0),
    browserPartitions: await partitionUsage(join(paths.userData, "Partitions"), projects),
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
