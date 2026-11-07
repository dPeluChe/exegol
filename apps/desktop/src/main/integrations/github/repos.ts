import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { mapWithConcurrency } from "../../lib/concurrency";
import { AsyncLruCache } from "../../lib/lru-cache";
import { isPathInside } from "../../security/path-guard";
import { SKIP_DIRS } from "../../system/scripts";

const MAX_DEPTH = 4;
const MAX_DIRS = 2000;
const MAX_REPOS = 60;
const FS_CONCURRENCY = 8;
const SCAN_TTL_MS = 30 * 60_000;

export interface ProjectRepo {
  /** owner/repo */
  name: string;
  /** Relative to the project, "" for its root */
  folder: string;
  path: string;
}

const GITHUB_REMOTE =
  /^(?:[a-z+]+:\/\/)?(?:[^@/\s]+@)?(?:ssh\.)?github\.com(?:-[\w-]+)?(?::\d+)?[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

/** owner/repo of a GitHub remote: HTTPS, SSH, or an SSH host alias (`github.com-work`) */
export function parseGitHubRemote(url: string): string | null {
  const [, owner, repo] = GITHUB_REMOTE.exec(url.trim()) ?? [];
  if (!owner || !repo || /^\.+$/.test(owner) || /^\.+$/.test(repo)) return null;
  return `${owner}/${repo}`;
}

/** The GitHub repo a `.git/config` points at: origin, else its first GitHub remote */
export function githubRepoInConfig(config: string): string | null {
  const remotes = new Map<string, string>();
  let remote: string | null = null;
  for (const raw of config.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) remote = /^\[remote "(.+)"\]$/.exec(line)?.[1] ?? null;
    const url = remote && !remotes.has(remote) ? /^url\s*=\s*(.+)$/.exec(line)?.[1] : null;
    const name = url ? parseGitHubRemote(url) : null;
    if (remote && name) remotes.set(remote, name);
  }
  return remotes.get("origin") ?? remotes.values().next().value ?? null;
}

async function gitConfig(dir: string): Promise<string | null> {
  const git = join(dir, ".git");
  const direct = await readFile(join(git, "config"), "utf8").catch(() => null);
  if (direct !== null) return direct;
  // Linked worktree or submodule: `.git` is a file naming the real git dir
  const pointer = await readFile(git, "utf8").catch(() => "");
  const gitdir = /^gitdir:\s*(.+?)\s*$/m.exec(pointer)?.[1];
  if (!gitdir) return null;
  const real = resolve(dir, gitdir);
  const common = await readFile(join(real, "commondir"), "utf8").catch(() => "");
  return readFile(join(resolve(real, common.trim()), "config"), "utf8").catch(() => null);
}

/** Git repos under `root`, shallowest first. Stops at a repo, so nested ones cost nothing;
 *  a Dirent of a link is never a directory, so links are not followed */
export async function findRepoFolders(root: string): Promise<string[]> {
  const found: string[] = [];
  let level = [""];
  let visited = 0;
  for (let depth = 0; depth <= MAX_DEPTH && level.length > 0; depth++) {
    const next: string[] = [];
    const repos: string[] = [];
    await mapWithConcurrency(level, FS_CONCURRENCY, async (rel) => {
      const entries = await readdir(join(root, rel), { withFileTypes: true }).catch(() => []);
      if (rel && entries.some((e) => e.name === ".git" && !e.isSymbolicLink())) {
        repos.push(rel);
        return;
      }
      if (depth === MAX_DEPTH) return;
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) {
          next.push(join(rel, e.name));
        }
      }
    });
    found.push(...repos.sort());
    visited += level.length;
    level = next.slice(0, Math.max(0, MAX_DIRS - visited));
  }
  return found;
}

const foldersCache = new AsyncLruCache<string, string[]>(256, SCAN_TTL_MS);

/** `findRepoFolders`, cached: the GitHub menu and the Projects view walk the same folders */
export function repoFoldersOf(path: string): Promise<string[]> {
  return foldersCache.getOrCompute(path, () => findRepoFolders(path));
}

async function discover(path: string): Promise<ProjectRepo[]> {
  const rootConfig = await gitConfig(path);
  const rootRepo = rootConfig ? githubRepoInConfig(rootConfig) : null;
  if (rootRepo) return [{ name: rootRepo, folder: "", path }];

  const folders = await repoFoldersOf(path);
  const named = await mapWithConcurrency(folders, FS_CONCURRENCY, async (folder) => {
    const config = await gitConfig(join(path, folder));
    return { folder, name: config ? githubRepoInConfig(config) : null };
  });
  // Two clones of one repo list the same PRs: the shallowest speaks for both
  const repos = new Map<string, ProjectRepo>();
  for (const { folder, name } of named) {
    if (name && !repos.has(name)) repos.set(name, { name, folder, path: join(path, folder) });
  }
  return [...repos.values()].slice(0, MAX_REPOS);
}

const reposCache = new AsyncLruCache<string, ProjectRepo[]>(64, SCAN_TTL_MS);

/** The project's GitHub repos: its root when that has a GitHub remote, else the repos inside.
 *  Read from disk: `projects.git_remote` is set once at import and misses later remotes */
export function projectRepos(projectPath: string): Promise<ProjectRepo[]> {
  return reposCache.getOrCompute(projectPath, () => discover(projectPath));
}

/** The menu opened: the next read walks the disk again, background polls need not */
export function forgetProjectRepos(projectPath: string): void {
  reposCache.invalidateWhere((key) => key === projectPath);
  foldersCache.invalidateWhere((key) => key === projectPath);
}

export interface SessionFolder {
  id: string;
  cwd: string;
  /** The repo of its worktree: the folder alone says nothing, worktrees live under ~/.exegol */
  worktreeRepo: string | null;
}

/** Live session ids per repo folder, for paths compared as given */
export function sessionsByRepo(
  sessions: readonly SessionFolder[],
  repos: readonly Pick<ProjectRepo, "folder" | "path">[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const session of sessions) {
    const where = session.worktreeRepo ?? session.cwd;
    const repo = repos.find((r) => isPathInside(r.path, where));
    if (repo) out.set(repo.folder, [...(out.get(repo.folder) ?? []), session.id]);
  }
  return out;
}
