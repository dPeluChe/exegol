import { lstat, readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import type Database from "libsql";
import { removingWorktrees } from "../agents/worktrees";
import { listBusyWorktreePaths, listLiveAgentFolders } from "../db/queries/agents";
import { getJsonSetting, setJsonSetting } from "../db/queries/settings";
import { mapWithConcurrency } from "../lib/concurrency";
import { logger } from "../lib/logger";
import {
  type JanitorFileLook,
  type JanitorGitLook,
  type JanitorMark,
  janitorGate,
  janitorVerdict,
  nextMark,
  sheddableDirs,
} from "../lib/worktree-janitor-rule";
import {
  ALWAYS_CHANGED,
  checkoutBlocker,
  type GitRunner,
  parseWorktreeList,
  pathKey,
  runGit,
  splitNul,
} from "../lib/worktree-safety";
import { isPathInside } from "../security/path-guard";
import { getAllProcessCwds } from "./ports";
import { duBytes } from "./storage";
import {
  inUse,
  projectRepoKeys,
  repoOf,
  TRASH_PREFIX,
  worktreeDirs,
} from "./worktree-housekeeping";

const JANITOR_MARKS_KEY = "worktree_janitor_marks";

export interface JanitorResult {
  freedBytes: number;
  worktrees: number;
}

export interface JanitorDeps {
  git?: GitRunner;
  /** Every process's cwd; null when they cannot be read (then nothing is touched) */
  processCwds?: () => Promise<string[] | null>;
  measure?: (path: string) => Promise<number | null>;
  now?: number;
}

async function lookAtGit(dir: string, git: GitRunner): Promise<JanitorGitLook> {
  const blocked = await checkoutBlocker(dir, git).catch(() => "git check failed" as const);
  if (blocked) return { fingerprint: "", clean: false, blocked };
  const [head, reflog, status] = await Promise.all([
    git(["rev-parse", "HEAD"], dir),
    git(["reflog", "-n", "1", "--date=unix", "--format=%H %gd %gs"], dir).catch(() => ""),
    git(["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"], dir),
  ]);
  const clean = status
    .split("\n")
    .filter((l) => l.trim())
    .every((l) => l.slice(3) === ALWAYS_CHANGED);
  return { fingerprint: `${head.trim()}\n${reflog.trim()}`, clean, blocked: null };
}

/** Newest mtime of the tracked and untracked files and of each sheddable dir and its entries
 *  (an install adds or replaces entries at the top); an unreadable dir counts as just changed */
async function lookAtFiles(dir: string, git: GitRunner, now: number): Promise<JanitorFileLook> {
  const [files, ignored] = await Promise.all([
    git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], dir, 30_000),
    git(
      ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
      dir,
      30_000,
    ),
  ]);
  const sheddable = sheddableDirs(splitNul(ignored));
  const mtime = (p: string) =>
    lstat(p).then(
      (s) => s.mtimeMs,
      () => 0,
    );
  const times = await mapWithConcurrency(splitNul(files), 32, (f) => mtime(join(dir, f)));
  for (const shed of sheddable) {
    const top = join(dir, shed);
    times.push(await mtime(top));
    const names = await readdir(top).catch(() => null);
    if (!names) times.push(now);
    else times.push(...(await mapWithConcurrency(names, 32, (n) => mtime(join(top, n)))));
  }
  return { newestMtimeMs: times.reduce((a, b) => Math.max(a, b), 0), sheddable };
}

/** A plain directory inside the worktree that holds no repository of its own */
async function safeToShed(path: string, worktreeReal: string): Promise<boolean> {
  const info = await lstat(path).catch(() => null);
  if (!info?.isDirectory()) return false;
  if (!isPathInside(worktreeReal, await realpath(path))) return false;
  return !(await lstat(join(path, ".git")).catch(() => null));
}

/** Exegol's worktrees on disk, each a linked worktree (a `.git` file) of a registered project,
 *  never a project's own checkout */
function managedWorktrees(db: Database.Database, roots: readonly string[]) {
  const repos = projectRepoKeys(db);
  return worktreeDirs(roots).flatMap(({ path, name }) => {
    if (name.startsWith(TRASH_PREFIX) || repos.has(pathKey(path))) return [];
    const repo = repoOf(path);
    return repo && repos.has(pathKey(repo)) ? [{ path, repo }] : [];
  });
}

/** Keys of the worktrees each repo registers unlocked; a repo git cannot list gives none */
async function unlockedByRepo(repos: string[], git: GitRunner): Promise<Set<string>> {
  const out = new Set<string>();
  for (const repo of new Set(repos)) {
    const text = await git(["worktree", "list", "--porcelain"], repo).catch(() => "");
    for (const w of parseWorktreeList(text)) if (!w.locked) out.add(pathKey(w.path));
  }
  return out;
}

/** Live sessions, active pipelines and races awaiting a pick: worktree keys and live folders */
function busyByDb(db: Database.Database) {
  const busy = inUse(db);
  const rows = listBusyWorktreePaths(db, [...busy.agents]);
  return {
    keys: new Set([...busy.paths, ...rows.map((p) => pathKey(p))]),
    folders: listLiveAgentFolders(db).map((f) => pathKey(f)),
  };
}

const isBusy = (key: string, db: ReturnType<typeof busyByDb>, cwds: string[]) =>
  db.keys.has(key) || [...db.folders, ...cwds].some((f) => isPathInside(key, f));

/**
 * Frees the regenerable folders (JANITOR_DIRS) of Exegol's idle worktrees under
 * `janitorVerdict`. Marks of HEAD and reflog persist between runs, so a worktree is shed on the
 * second daily look at the earliest. Measured before deleting
 */
export async function runWorktreeJanitor(
  db: Database.Database,
  roots: readonly string[],
  deps: JanitorDeps = {},
): Promise<JanitorResult> {
  const { git = runGit, processCwds = getAllProcessCwds, measure = duBytes } = deps;
  const now = deps.now ?? Date.now();
  const result: JanitorResult = { freedBytes: 0, worktrees: 0 };
  const worktrees = managedWorktrees(db, roots);
  if (worktrees.length === 0) return result;
  const cwds = await processCwds();
  if (!cwds) return result;
  const resolvedCwds = cwds.map((c) => pathKey(c));
  const unlocked = await unlockedByRepo(
    worktrees.map((w) => w.repo),
    git,
  );
  const busy = busyByDb(db);
  const marks = getJsonSetting<Record<string, JanitorMark>>(db, JANITOR_MARKS_KEY, {});
  const next: Record<string, JanitorMark> = {};

  for (const { path } of worktrees) {
    const key = pathKey(path);
    if (!unlocked.has(key)) continue;
    let look: JanitorGitLook;
    try {
      look = await lookAtGit(path, git);
    } catch {
      continue;
    }
    if (look.fingerprint) next[key] = nextMark(marks[key], look.fingerprint, now);
    const gate = { busy: isBusy(key, busy, resolvedCwds), git: look, prev: marks[key], now };
    if (janitorGate(gate)) continue;
    let files: JanitorFileLook;
    try {
      files = await lookAtFiles(path, git, now);
    } catch {
      continue;
    }
    const verdict = janitorVerdict({ ...gate, files });
    if (!verdict.shed) continue;

    removingWorktrees.add(path);
    try {
      // A session may have started while this one was looked at
      if (isBusy(key, busyByDb(db), resolvedCwds)) continue;
      let freed = 0;
      for (const rel of verdict.dirs) {
        const target = join(path, rel);
        if (!(await safeToShed(target, key))) continue;
        const bytes = (await measure(target)) ?? 0;
        await rm(target, { recursive: true, force: true });
        freed += bytes;
      }
      if (freed > 0) {
        result.freedBytes += freed;
        result.worktrees++;
      }
    } catch (err) {
      logger.warn(`[WorktreeJanitor] shed failed: ${(err as { code?: unknown }).code ?? "error"}`);
    } finally {
      removingWorktrees.delete(path);
    }
  }
  setJsonSetting(db, JANITOR_MARKS_KEY, next);
  if (result.worktrees > 0) {
    const mb = Math.round(result.freedBytes / (1024 * 1024));
    logger.info(`[WorktreeJanitor] freed ${mb} MB in ${result.worktrees} worktrees`);
  }
  return result;
}
