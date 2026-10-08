import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type Database from "libsql";
import { removeWorktree as dbRemoveWorktree } from "../db/queries";
import { countLiveAgentsInWorktree } from "../db/queries/agents";
import { type GitRunner, pruneWorktrees, runGit, worktreeSafety } from "../lib/worktree-safety";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WorktreeSweepResult {
  removed: number;
  droppedRows: number;
  /** Orphaned but not provably safe (dirty, unpushed, unreadable): left in place */
  kept: number;
}

interface Row {
  id: string;
  agent_id: string | null;
  path: string;
  repo: string;
  created_at: number;
  last_change: number | null;
}

const norm = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
const isDir = (path: string) => lstatSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

/** Worktrees an active pipeline or a running race still needs, by path or by agent */
function inUse(db: Database.Database): { paths: Set<string>; agents: Set<string> } {
  const paths = new Set(
    (
      db
        .prepare(
          "SELECT worktree_path FROM pipeline_runs WHERE worktree_path IS NOT NULL AND status IN ('pending','running','paused')",
        )
        .all() as { worktree_path: string }[]
    ).map((r) => norm(r.worktree_path)),
  );
  const agents = new Set<string>();
  const races = db
    .prepare("SELECT agent_ids FROM parallel_runs WHERE status = 'running'")
    .all() as {
    agent_ids: string;
  }[];
  for (const r of races) {
    try {
      for (const id of JSON.parse(r.agent_ids) as unknown[])
        if (typeof id === "string") agents.add(id);
    } catch {
      /* unreadable run: its rows stay protected by the live-agent check */
    }
  }
  return { paths, agents };
}

/** The repo of a worktree, from its own `.git` file (`gitdir: <repo>/.git/worktrees/<name>`) */
function repoOf(dir: string): string | null {
  const file = join(dir, ".git");
  if (!lstatSync(file, { throwIfNoEntry: false })?.isFile()) return null;
  const m = /^gitdir:\s*(.+?)\/?\s*$/m.exec(readFileSync(file, "utf-8"));
  const gitdir = m?.[1];
  if (!gitdir || !/\/\.git\/worktrees\/[^/]+$/.test(gitdir)) return null;
  return dirname(dirname(dirname(gitdir)));
}

/**
 * Clean and pushed, of a registered project, and still unused after the git checks: then the
 * directory goes off the main thread (a node_modules tree blocks for seconds when removed
 * synchronously) and `git worktree prune` drops its registration. The branch stays
 */
async function removeIfSafe(
  path: string,
  repos: Set<string>,
  stillFree: () => boolean,
  git: GitRunner,
): Promise<boolean> {
  const repo = repoOf(path);
  if (!repo || !repos.has(norm(repo))) return false;
  if (!(await worktreeSafety(path, git)).removable || !stillFree()) return false;
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    return false;
  }
  await pruneWorktrees(repo, git);
  return !isDir(path);
}

/**
 * Orphaned Exegol worktrees: a row whose directory is gone (row dropped, registration pruned),
 * a row whose agents ended over a day ago, and a directory under `roots` with no row. The last
 * two are removed only when clean and pushed, never while an agent, pipeline or race uses them
 */
export async function sweepOrphanWorktrees(
  db: Database.Database,
  roots: readonly string[],
  now = Date.now(),
  git: GitRunner = runGit,
): Promise<WorktreeSweepResult> {
  const result: WorktreeSweepResult = { removed: 0, droppedRows: 0, kept: 0 };
  const busy = inUse(db);
  const rows = db
    .prepare(
      `SELECT w.id, w.agent_id, w.path, w.created_at, p.path AS repo,
              (SELECT MAX(COALESCE(a.status_changed_at, COALESCE(a.stopped_at, a.started_at) * 1000))
                 FROM agents a WHERE a.worktree_id = w.id OR a.id = w.agent_id) AS last_change
       FROM worktrees w JOIN projects p ON p.id = w.project_id`,
    )
    .all() as Row[];
  const projectRepos = new Set(
    (db.prepare("SELECT path FROM projects").all() as { path: string }[]).map((p) => norm(p.path)),
  );

  for (const row of rows) {
    const used =
      countLiveAgentsInWorktree(db, row.id) > 0 ||
      (row.agent_id !== null && busy.agents.has(row.agent_id)) ||
      busy.paths.has(norm(row.path));
    if (used) continue;
    if (!lstatSync(row.path, { throwIfNoEntry: false })) {
      dbRemoveWorktree(db, row.id);
      await pruneWorktrees(row.repo, git);
      result.droppedRows++;
      continue;
    }
    const since = row.last_change ?? row.created_at * 1000;
    if (now - since < DAY_MS) continue;
    const free = () => countLiveAgentsInWorktree(db, row.id) === 0;
    if (await removeIfSafe(row.path, projectRepos, free, git)) {
      dbRemoveWorktree(db, row.id);
      result.removed++;
    } else {
      result.kept++;
    }
  }

  const known = new Set(rows.map((r) => norm(r.path)));
  for (const root of roots) {
    if (!isDir(root)) continue;
    for (const project of readdirSync(root)) {
      const projectDir = join(root, project);
      if (!isDir(projectDir)) continue;
      for (const name of readdirSync(projectDir)) {
        const path = join(projectDir, name);
        if (!isDir(path) || known.has(norm(path)) || busy.paths.has(norm(path))) continue;
        const gitFile = lstatSync(join(path, ".git"), { throwIfNoEntry: false });
        // A day old at least: a spawn creates the directory a moment before its row
        if (gitFile && now - gitFile.mtimeMs < DAY_MS) continue;
        const free = () => !db.prepare("SELECT 1 FROM worktrees WHERE path = ?").get(path);
        if (await removeIfSafe(path, projectRepos, free, git)) result.removed++;
        else result.kept++;
      }
    }
  }
  return result;
}
