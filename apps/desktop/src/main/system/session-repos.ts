import type Database from "libsql";
import { hookCwdOf } from "../agents/hook-cwd";
import { listLiveProjectSessions } from "../db/queries/agents";
import {
  type ProjectRepo,
  repoOfSessions,
  type SessionFolder,
  sessionsByRepo,
} from "../integrations/github/repos";
import { pathKey } from "../lib/worktree-safety";

type Repos = readonly Pick<ProjectRepo, "folder" | "path">[];

/** Where each live session of the project works now: its hooks' folder, else its start folder */
const liveFolders = (db: Database.Database, projectId: string): SessionFolder[] =>
  listLiveProjectSessions(db, projectId).map(({ id, cwd, worktreeRepo }) => ({
    id,
    cwd: pathKey(hookCwdOf(id) ?? cwd),
    worktreeRepo: worktreeRepo ? pathKey(worktreeRepo) : null,
  }));

const keyed = (repos: Repos) => repos.map((r) => ({ folder: r.folder, path: pathKey(r.path) }));

/** A project's live session ids per repo folder */
export const liveSessionsByRepo = (db: Database.Database, projectId: string, repos: Repos) =>
  sessionsByRepo(liveFolders(db, projectId), keyed(repos));

/** The repo folder each live session of the project works in */
export const liveSessionRepos = (db: Database.Database, projectId: string, repos: Repos) =>
  repoOfSessions(liveFolders(db, projectId), keyed(repos));
