import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type Database from "libsql";
import { announceSave, type SaveTarget, saveWorktreeWork } from "../agents/worktree-save";
import { removingWorktrees } from "../agents/worktrees";
import { removeWorktree as dbRemoveWorktree } from "../db/queries";
import { countLiveAgentsInWorktree } from "../db/queries/agents";
import { getAppSettings } from "../db/queries/settings";
import {
  type GitRunner,
  isLockedOrUnknown,
  pruneWorktrees,
  runGit,
  worktreeSafety,
} from "../lib/worktree-safety";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A verified worktree moved aside before deletion; a sweep that died mid-delete finishes it */
const TRASH_PREFIX = ".exegol-trash-";

export interface WorktreeSweepResult {
  removed: number;
  droppedRows: number;
  /** Orphaned but not provably safe (dirty, unpushed, locked, unreadable): left in place */
  kept: number;
}

interface Row {
  id: string;
  path: string;
  branch_name: string;
  alias: string | null;
  repo: string;
  created_at: number;
  agents: number;
  archived: number;
  last_archived: number | null;
}

const norm = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
const isDir = (path: string) => lstatSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

/** Worktrees an active pipeline or a race still needs, by path or by agent */
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
  // A completed race with no promoted agent still waits for the user's pick
  const races = db
    .prepare(
      "SELECT agent_ids FROM parallel_runs WHERE status = 'running' OR (status = 'completed' AND promoted_agent_id IS NULL)",
    )
    .all() as { agent_ids: string }[];
  for (const r of races) {
    try {
      for (const id of JSON.parse(r.agent_ids) as unknown[]) {
        if (typeof id === "string") agents.add(id);
      }
    } catch {
      /* unreadable run: its rows stay protected by the archived-only rule */
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
 * Registered project, not locked, safe by worktreeSafety. Then it is taken out of spawn's reach
 * (removingWorktrees), re-checked, moved to a trash sibling on the same volume, its registration
 * pruned, and the trash deleted off the main thread. The branch stays
 */
async function removeIfSafe(
  path: string,
  repos: Set<string>,
  stillFree: () => boolean,
  git: GitRunner,
  save: Omit<SaveTarget, "dir"> | null,
): Promise<boolean> {
  const repo = repoOf(path);
  if (!repo || !repos.has(norm(repo))) return false;
  if (await isLockedOrUnknown(repo, path, git)) return false;
  // Dirty or unpushed work goes to its branch's remote first, then the rule is checked again
  if (save && stillFree()) announceSave(await saveWorktreeWork({ dir: path, ...save }, git), save);
  if (!(await worktreeSafety(path, git)).removable) return false;
  removingWorktrees.add(path);
  try {
    if (!stillFree()) return false;
    const trash = join(dirname(path), `${TRASH_PREFIX}${basename(path)}-${Date.now()}`);
    await rename(path, trash);
    await pruneWorktrees(repo, git);
    await rm(trash, { recursive: true, force: true });
    return true;
  } catch {
    return !isDir(path);
  } finally {
    removingWorktrees.delete(path);
  }
}

/**
 * Orphaned Exegol worktrees: a row whose folder is gone (row dropped, registration pruned), a
 * row whose agents are all archived for over a day, and a folder under `roots` with no row. The
 * last two go only under removeIfSafe. Resumable agents (stopped, crashed, suspended, not
 * archived) keep their worktree, so do live agents, active pipelines and races awaiting a pick
 */
export async function sweepOrphanWorktrees(
  db: Database.Database,
  roots: readonly string[],
  now = Date.now(),
  git: GitRunner = runGit,
  saveWork = getAppSettings(db).saveWorktreeWork,
): Promise<WorktreeSweepResult> {
  const result: WorktreeSweepResult = { removed: 0, droppedRows: 0, kept: 0 };
  const busy = inUse(db);
  const rows = db
    .prepare(
      `SELECT w.id, w.path, w.branch_name, w.created_at, p.path AS repo,
              MAX(a.alias) AS alias,
              COUNT(a.id) AS agents, COUNT(a.archived_at) AS archived,
              MAX(a.archived_at) AS last_archived,
              SUM(CASE WHEN a.id IN (${[...busy.agents].map(() => "?").join(",") || "NULL"}) THEN 1 ELSE 0 END) AS racing
       FROM worktrees w JOIN projects p ON p.id = w.project_id
       LEFT JOIN agents a ON a.worktree_id = w.id OR a.id = w.agent_id
       GROUP BY w.id`,
    )
    .all(...busy.agents) as (Row & { racing: number })[];
  const projectRepos = new Set(
    (db.prepare("SELECT path FROM projects").all() as { path: string }[]).map((p) => norm(p.path)),
  );

  for (const row of rows) {
    if (countLiveAgentsInWorktree(db, row.id) > 0 || row.racing > 0) continue;
    if (busy.paths.has(norm(row.path))) continue;
    if (!lstatSync(row.path, { throwIfNoEntry: false })) {
      dbRemoveWorktree(db, row.id);
      await pruneWorktrees(row.repo, git);
      result.droppedRows++;
      continue;
    }
    // Only archived sessions: a stopped or crashed one can still be resumed into this tree
    if (row.archived < row.agents) continue;
    const since = row.agents > 0 ? (row.last_archived ?? 0) * 1000 : row.created_at * 1000;
    if (now - since < DAY_MS) continue;
    const free = () => countLiveAgentsInWorktree(db, row.id) === 0;
    const save = saveWork
      ? { expectedBranch: row.branch_name, alias: row.alias || row.branch_name }
      : null;
    if (await removeIfSafe(row.path, projectRepos, free, git, save)) {
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
        if (!isDir(path)) continue;
        if (name.startsWith(TRASH_PREFIX)) {
          await rm(path, { recursive: true, force: true }).catch(() => {});
          continue;
        }
        if (known.has(norm(path)) || busy.paths.has(norm(path))) continue;
        const gitFile = lstatSync(join(path, ".git"), { throwIfNoEntry: false });
        // A day old at least: a spawn creates the directory a moment before its row
        if (gitFile && now - gitFile.mtimeMs < DAY_MS) continue;
        const free = () => !db.prepare("SELECT 1 FROM worktrees WHERE path = ?").get(path);
        const save = saveWork ? { expectedBranch: null, alias: name } : null;
        if (await removeIfSafe(path, projectRepos, free, git, save)) result.removed++;
        else result.kept++;
      }
    }
  }
  return result;
}
