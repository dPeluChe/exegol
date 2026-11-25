import { type DoneSession, LIVE_STATUSES } from "@exegol/shared";
import type Database from "libsql";
import { AGENT_FOLDER_SQL, liveIn } from "./agents";

export function countLiveAgentsInWorktree(
  db: Database.Database,
  worktreeId: string,
  excludeAgentId = "",
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM agents WHERE worktree_id = ? AND id != ? AND status IN (${liveIn()})`,
    )
    .get(worktreeId, excludeAgentId, ...LIVE_STATUSES) as { n: number };
  return row.n;
}

/** Each live agent with the folder it works in (`AGENT_FOLDER_SQL`) */
export function listLiveAgentFolderRows(
  db: Database.Database,
): { id: string; cwd: string | null }[] {
  return db
    .prepare(
      `SELECT a.id, ${AGENT_FOLDER_SQL} AS cwd
       FROM agents a
       LEFT JOIN worktrees w ON w.id = a.worktree_id
       JOIN projects p ON p.id = a.project_id
       WHERE a.status IN (${liveIn()})`,
    )
    .all(...LIVE_STATUSES) as { id: string; cwd: string | null }[];
}

/** Distinct folders live agents work in (`AGENT_FOLDER_SQL`) */
export function listLiveAgentFolders(db: Database.Database): string[] {
  return [...new Set(listLiveAgentFolderRows(db).flatMap((r) => (r.cwd ? [r.cwd] : [])))];
}

/** Sessions that finished on their own after `sinceMs`: a crash or a stop is not done */
export function listCompletedSince(db: Database.Database, sinceMs: number): DoneSession[] {
  const rows = db
    .prepare(
      `SELECT id, alias, task_description, cli_type FROM agents
       WHERE status = 'completed' AND status_changed_at > ? AND archived_at IS NULL
         AND cli_type != 'shell'
       ORDER BY status_changed_at DESC LIMIT 50`,
    )
    .all(sinceMs) as {
    id: string;
    alias: string | null;
    task_description: string;
    cli_type: DoneSession["cliType"];
  }[];
  return rows.map((r) => ({
    id: r.id,
    alias: r.alias,
    taskDescription: r.task_description,
    cliType: r.cli_type,
  }));
}

interface LiveProjectSession {
  id: string;
  cliType: string;
  cwd: string;
  worktreeRepo: string | null;
}

/** A project's live agents, each with its folder (`AGENT_FOLDER_SQL`) and its worktree's repo */
export function listLiveProjectSessions(
  db: Database.Database,
  projectId: string,
): LiveProjectSession[] {
  return db
    .prepare(
      `SELECT a.id, a.cli_type AS cliType, ${AGENT_FOLDER_SQL} AS cwd,
              CASE WHEN w.id IS NOT NULL THEN COALESCE(w.repo_path, p.path) END AS worktreeRepo
       FROM agents a
       LEFT JOIN worktrees w ON w.id = a.worktree_id
       JOIN projects p ON p.id = a.project_id
       WHERE a.project_id = ? AND a.status IN (${liveIn()})`,
    )
    .all(projectId, ...LIVE_STATUSES) as LiveProjectSession[];
}

/** Worktree paths a live agent, or one of `agentIds` (a race awaiting its pick), is bound to */
export function listBusyWorktreePaths(
  db: Database.Database,
  agentIds: readonly string[] = [],
): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT w.path FROM worktrees w
       JOIN agents a ON a.worktree_id = w.id OR a.id = w.agent_id
       WHERE a.status IN (${liveIn()}) OR a.id IN (${agentIds.map(() => "?").join(",") || "NULL"})`,
    )
    .all(...LIVE_STATUSES, ...agentIds) as { path: string }[];
  return rows.map((r) => r.path);
}

export function listLiveAgentIds(db: Database.Database, projectId: string): string[] {
  const rows = db
    .prepare(`SELECT id FROM agents WHERE project_id = ? AND status IN (${liveIn()})`)
    .all(projectId, ...LIVE_STATUSES) as { id: string }[];
  return rows.map((r) => r.id);
}

/** Live non-shell sessions and their CLI, for the MCP status map */
export function listLiveAgentClis(db: Database.Database): { id: string; cliType: string }[] {
  return db
    .prepare(
      `SELECT id, cli_type AS cliType FROM agents
       WHERE cli_type != 'shell' AND status IN (${liveIn()})`,
    )
    .all(...LIVE_STATUSES) as { id: string; cliType: string }[];
}

export interface LiveAgentSession {
  id: string;
  alias: string | null;
  cliType: string;
  taskDescription: string;
  projectName: string | null;
}

/** Live agent sessions with what names them, newest first (Settings > MCP Server) */
export function listLiveAgentSessions(db: Database.Database): LiveAgentSession[] {
  return db
    .prepare(
      `SELECT a.id, a.alias, a.cli_type AS cliType, a.task_description AS taskDescription,
              p.name AS projectName
       FROM agents a LEFT JOIN projects p ON p.id = a.project_id
       WHERE a.cli_type != 'shell' AND a.status IN (${liveIn()})
       ORDER BY a.started_at DESC, a.rowid DESC`,
    )
    .all(...LIVE_STATUSES) as LiveAgentSession[];
}

export interface LiveSessionProcess {
  id: string;
  pid: number;
  alias: string | null;
  taskDescription: string | null;
  cliType: string;
  projectId: string;
  projectName: string;
  projectPath: string | null;
}

/** Every live session with a process, shells too, across projects, with what names it */
export function listLiveSessionProcesses(db: Database.Database): LiveSessionProcess[] {
  return db
    .prepare(
      `SELECT a.id, a.pid, a.alias, a.task_description AS taskDescription, a.cli_type AS cliType,
              a.project_id AS projectId, COALESCE(p.name, '') AS projectName, p.path AS projectPath
       FROM agents a LEFT JOIN projects p ON p.id = a.project_id
       WHERE a.pid IS NOT NULL AND a.status IN (${liveIn()})`,
    )
    .all(...LIVE_STATUSES) as LiveSessionProcess[];
}
