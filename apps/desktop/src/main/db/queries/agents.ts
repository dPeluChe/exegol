import {
  type Agent,
  type AgentCreate,
  type AgentStatus,
  agentRowSchema,
  LIVE_STATUSES,
} from "@exegol/shared";
import type Database from "libsql";
import { pickAgentCodename } from "../../agents/agent-names";
import { resolveTaskLabel } from "../../agents/task-label";
import { mapAgentRow, nanoid } from "./helpers";

export type ActiveAgent = Agent & { projectName: string; groupColor: string | null };

/** Placeholders for `...LIVE_STATUSES` in an `IN (...)` */
export const liveIn = () => [...LIVE_STATUSES].map(() => "?").join(",");

/** What `mapAgentRow` reads, over `agents a` + `worktrees w`. Never final_output: up to 16 KB per
 *  row that only `getAgentFinalOutput` needs */
export const AGENT_COLUMNS = Object.keys(agentRowSchema.shape)
  .map((c) => (c === "branch_name" ? "w.branch_name" : `a.${c}`))
  .join(", ");
const AGENT_FROM = "FROM agents a LEFT JOIN worktrees w ON w.id = a.worktree_id";

/** T156: every non-terminal agent across ALL projects, with project name +
 *  group color — the renderer store only knows projects opened this session. */
export function listActiveAgents(db: Database.Database): ActiveAgent[] {
  const statuses = [...LIVE_STATUSES];
  const rows = db
    .prepare(
      `SELECT ${AGENT_COLUMNS}, p.name as project_name, g.color as group_color
       ${AGENT_FROM}
       JOIN projects p ON p.id = a.project_id
       LEFT JOIN project_groups g ON g.id = p.group_id
       WHERE a.status IN (${statuses.map(() => "?").join(",")})
       ORDER BY a.started_at DESC`,
    )
    .all(...statuses) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...mapAgentRow(r),
    projectName: r.project_name as string,
    groupColor: (r.group_color as string | null) ?? null,
  }));
}

export function listAgents(db: Database.Database, projectId: string): Agent[] {
  const rows = db
    .prepare(
      `SELECT ${AGENT_COLUMNS}
       ${AGENT_FROM}
       WHERE a.project_id = ? AND a.archived_at IS NULL
       ORDER BY a.started_at DESC`,
    )
    .all(projectId);
  return (rows as Record<string, unknown>[]).map(mapAgentRow);
}

/** T160: set/clear the session alias (addressing name for agent_send + UI). */
export function setAgentMuted(db: Database.Database, id: string, muted: boolean): void {
  db.prepare("UPDATE agents SET muted = ? WHERE id = ?").run(muted ? 1 : 0, id);
}

/** `pr_watch`: 0 = off, else the feedback cursor (ms): review comments from then on are news */
export function setAgentPrWatch(db: Database.Database, id: string, since: number | null): void {
  db.prepare("UPDATE agents SET pr_watch = ? WHERE id = ?").run(since ?? 0, id);
}

export function advancePrWatchCursor(db: Database.Database, id: string, since: number): void {
  db.prepare("UPDATE agents SET pr_watch = ? WHERE id = ? AND pr_watch > 0 AND pr_watch < ?").run(
    since,
    id,
    since,
  );
}

export interface PrWatchedAgent {
  id: string;
  projectId: string;
  cwd: string;
  defaultBranch: string;
  since: number;
}

/** Live agents that opted into PR watch, with the folder they work in */
export function listPrWatchedAgents(db: Database.Database): PrWatchedAgent[] {
  const statuses = [...LIVE_STATUSES];
  return db
    .prepare(
      `SELECT a.id, a.project_id AS projectId, COALESCE(w.path, p.path) AS cwd,
              p.default_branch AS defaultBranch, a.pr_watch AS since
       FROM agents a
       JOIN projects p ON p.id = a.project_id
       LEFT JOIN worktrees w ON w.id = a.worktree_id
       WHERE a.pr_watch > 0 AND a.cli_type != 'shell' AND a.status IN (${statuses.map(() => "?").join(",")})`,
    )
    .all(...statuses) as unknown as PrWatchedAgent[];
}

export function setAgentLastActivity(db: Database.Database, id: string, at: number): void {
  db.prepare("UPDATE agents SET last_activity_at = ? WHERE id = ?").run(at, id);
}

/** Shells are terminal tabs with nothing to keep: closing one deletes its row */
export function deleteShellRow(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM agents WHERE id = ? AND cli_type = 'shell'").run(id);
}

export function setAgentResumedFrom(db: Database.Database, id: string, from: string): void {
  db.prepare("UPDATE agents SET resumed_from = ? WHERE id = ?").run(from, id);
}

/** The grid a session last ran at (a pane's fit), if it was ever sized */
export function agentPtySize(
  db: Database.Database,
  id: string,
): { cols: number; rows: number } | null {
  const row = db.prepare("SELECT pty_cols, pty_rows FROM agents WHERE id = ?").get(id) as
    | { pty_cols: number | null; pty_rows: number | null }
    | undefined;
  return row?.pty_cols && row.pty_rows ? { cols: row.pty_cols, rows: row.pty_rows } : null;
}

/** The newest row that resumed `id` */
export function resumedInto(db: Database.Database, id: string): string | undefined {
  const row = db
    .prepare(
      "SELECT id FROM agents WHERE resumed_from = ? ORDER BY started_at DESC, rowid DESC LIMIT 1",
    )
    .get(id) as { id: string } | undefined;
  return row?.id;
}

export interface WatchedInfo {
  id: string;
  alias: string | null;
  cliType: string;
  projectId: string;
  projectName: string | null;
  status: string;
  statusChangedAt: number | null;
  taskDescription: string;
  branchName: string | null;
}

/** What a session was, archived or not, for a Watching card whose session is gone */
export function watchedInfo(db: Database.Database, id: string): WatchedInfo | null {
  const r = db
    .prepare(
      `SELECT a.id, a.alias, a.cli_type, a.project_id, p.name AS project_name, a.status,
              a.status_changed_at, a.task_description, w.branch_name
       FROM agents a LEFT JOIN projects p ON p.id = a.project_id
       LEFT JOIN worktrees w ON w.id = a.worktree_id WHERE a.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: r.id as string,
    alias: (r.alias as string | null) ?? null,
    cliType: r.cli_type as string,
    projectId: r.project_id as string,
    projectName: (r.project_name as string | null) ?? null,
    status: r.status as string,
    statusChangedAt: (r.status_changed_at as number | null) ?? null,
    taskDescription: (r.task_description as string) ?? "",
    branchName: (r.branch_name as string | null) ?? null,
  };
}

export function setAgentLastCwd(db: Database.Database, id: string, cwd: string): void {
  db.prepare("UPDATE agents SET last_cwd = ? WHERE id = ?").run(cwd, id);
}

export function getAgentLastCwd(db: Database.Database, id: string): string | null {
  const row = db.prepare("SELECT last_cwd FROM agents WHERE id = ?").get(id) as
    | { last_cwd: string | null }
    | undefined;
  return row?.last_cwd ?? null;
}

export function setAgentSuspended(db: Database.Database, id: string, at: number | null): void {
  db.prepare("UPDATE agents SET suspended_at = ? WHERE id = ?").run(at, id);
}

/** Stopped and suspended in one statement: the pane shows Resume, not the crash */
export function suspendStoppedAgents(
  db: Database.Database,
  ids: readonly string[],
  step: string,
  at: number,
  onlyStatus?: AgentStatus,
): void {
  if (ids.length === 0) return;
  db.prepare(
    `UPDATE agents SET suspended_at = ?, status = 'stopped', current_step = ?
     WHERE id IN (${ids.map(() => "?").join(",")})${onlyStatus ? " AND status = ?" : ""}`,
  ).run(at, step, ...ids, ...(onlyStatus ? [onlyStatus] : []));
}

/** Muted or suspended: it must not ask for attention */
export function isAgentQuiet(db: Database.Database, id: string): boolean {
  try {
    const row = db.prepare("SELECT muted, suspended_at FROM agents WHERE id = ?").get(id) as
      | { muted: number; suspended_at: number | null }
      | undefined;
    return !!row && (row.muted === 1 || row.suspended_at != null);
  } catch {
    return false; // never let this check swallow an attention event
  }
}

export function setAgentYolo(db: Database.Database, id: string, yolo: boolean): void {
  db.prepare("UPDATE agents SET yolo = ? WHERE id = ?").run(yolo ? 1 : 0, id);
}

export function setAgentModel(db: Database.Database, id: string, model: string): void {
  db.prepare("UPDATE agents SET model = ? WHERE id = ?").run(model, id);
}

export function setAgentModelRoles(
  db: Database.Database,
  id: string,
  roles: Record<string, string>,
): void {
  db.prepare("UPDATE agents SET model_roles = ? WHERE id = ?").run(JSON.stringify(roles), id);
}

export function setAgentCliVersion(db: Database.Database, id: string, version: string): void {
  db.prepare("UPDATE agents SET cli_version = ? WHERE id = ?").run(version, id);
}

export function setAgentAlias(db: Database.Database, id: string, alias: string | null): void {
  db.prepare("UPDATE agents SET alias = ? WHERE id = ?").run(alias, id);
}

export function setAgentCliName(db: Database.Database, id: string, name: string): void {
  db.prepare("UPDATE agents SET cli_name = ? WHERE id = ?").run(name, id);
}

/** T160: live agents whose alias matches (case-insensitive) — for name addressing. */
export function findLiveAgentsByAlias(db: Database.Database, alias: string): Agent[] {
  const statuses = [...LIVE_STATUSES];
  const rows = db
    .prepare(
      `SELECT ${AGENT_COLUMNS}
       ${AGENT_FROM}
       WHERE LOWER(a.alias) = LOWER(?)
         AND a.status IN (${statuses.map(() => "?").join(",")})`,
    )
    .all(alias, ...statuses);
  return (rows as Record<string, unknown>[]).map(mapAgentRow);
}

// Open, as the renderer's session lists read it: live and not archived
export const OPEN_SESSION_SQL = `archived_at IS NULL AND status IN (${[...LIVE_STATUSES].map((s) => `'${s}'`).join(",")})`;

/** The names of a project's open sessions; a plain shell has none */
export function liveSessionNames(db: Database.Database, projectId: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT alias FROM agents
       WHERE project_id = ? AND alias IS NOT NULL AND ${OPEN_SESSION_SQL}`,
    )
    .all(projectId) as { alias: string }[];
  return rows.map((r) => r.alias);
}

export function getAgent(db: Database.Database, id: string): Agent | null {
  const row = db
    .prepare(
      `SELECT ${AGENT_COLUMNS}
       ${AGENT_FROM}
       WHERE a.id = ?`,
    )
    .get(id);
  return row ? mapAgentRow(row as Record<string, unknown>) : null;
}

export function listAgentsByIds(db: Database.Database, ids: string[]): Agent[] {
  if (ids.length === 0) return [];
  const rows = db
    .prepare(
      `SELECT ${AGENT_COLUMNS} ${AGENT_FROM} WHERE a.id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids);
  return (rows as Record<string, unknown>[]).map(mapAgentRow);
}

/** An agent's folder in SQL over `agents a`, `worktrees w`, `projects p`: the start folder the
 *  launcher gave it (a shell's last_cwd is its OSC 7 folder, not where it started), its worktree,
 *  else the project root */
export const AGENT_FOLDER_SQL =
  "COALESCE(CASE WHEN a.cli_type <> 'shell' THEN a.last_cwd END, w.path, p.path)";

/** The folder an agent works in: its start folder, its worktree, else the project root */
export function getAgentCwd(db: Database.Database, id: string): string | null {
  const row = db
    .prepare(
      `SELECT ${AGENT_FOLDER_SQL} AS cwd
       FROM agents a
       LEFT JOIN worktrees w ON w.id = a.worktree_id
       JOIN projects p ON p.id = a.project_id
       WHERE a.id = ?`,
    )
    .get(id) as { cwd?: string } | undefined;
  return row?.cwd ?? null;
}

export function createAgent(db: Database.Database, data: AgentCreate): Agent {
  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);
  const accessMode = data.accessMode ?? "write";

  // T167: a session without a name shows up as its provider ("opencode"), so
  // two of the same CLI are indistinguishable in the UI and un-addressable by
  // agent_send. Shells are excluded — they're not messaging participants.
  const alias = data.cliType === "shell" ? null : data.name || pickAgentCodename(db);
  const task = resolveTaskLabel(data.cliType, data.taskDescription);

  db.prepare(
    `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at, access_mode, alias, status_changed_at)
     VALUES (?, ?, ?, 'spawning', ?, ?, ?, ?, ?)`,
  ).run(id, data.projectId, data.cliType, task, now, accessMode, alias, Date.now());

  // biome-ignore lint/style/noNonNullAssertion: row was just inserted
  return getAgent(db, id)!;
}

const statusStatements = new WeakMap<
  Database.Database,
  { status: Database.Statement; statusStep: Database.Statement; stepIf: Database.Statement }
>();

function statusStatementsFor(db: Database.Database) {
  let s = statusStatements.get(db);
  if (!s) {
    s = {
      status: db.prepare("UPDATE agents SET status = ? WHERE id = ? AND status IS NOT ?"),
      statusStep: db.prepare(
        `UPDATE agents SET status = ?, current_step = ?
         WHERE id = ? AND (status IS NOT ? OR current_step IS NOT ?)`,
      ),
      stepIf: db.prepare(
        "UPDATE agents SET current_step = ? WHERE id = ? AND status = ? AND current_step IS NOT ?",
      ),
    };
    statusStatements.set(db, s);
  }
  return s;
}

/** An unchanged pair writes nothing (status_changed_at moves only on a new status). True if written */
export function updateAgentStatus(
  db: Database.Database,
  id: string,
  status: AgentStatus,
  currentStep?: string,
): boolean {
  const s = statusStatementsFor(db);
  const info =
    currentStep !== undefined
      ? s.statusStep.run(status, currentStep, id, status, currentStep)
      : s.status.run(status, id, status);
  return Number(info.changes ?? 0) > 0;
}

/** The step only while the row still holds `status`: a late write never undoes another writer's */
export function updateAgentStepIfStatus(
  db: Database.Database,
  id: string,
  status: AgentStatus,
  currentStep: string,
): boolean {
  const info = statusStatementsFor(db).stepIf.run(currentStep, id, status, currentStep);
  return Number(info.changes ?? 0) > 0;
}

export function stopAgent(
  db: Database.Database,
  id: string,
  status: AgentStatus = "completed",
): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    "UPDATE agents SET status = ?, stopped_at = ?, pid = NULL, current_step = NULL WHERE id = ?",
  ).run(status, now, id);
}

export function setAgentWorktree(db: Database.Database, agentId: string, worktreeId: string): void {
  db.prepare("UPDATE agents SET worktree_id = ? WHERE id = ?").run(worktreeId, agentId);
}

export function setAgentPtySize(
  db: Database.Database,
  id: string,
  size: { cols: number; rows: number },
): void {
  db.prepare("UPDATE agents SET pty_cols = ?, pty_rows = ? WHERE id = ?").run(
    size.cols,
    size.rows,
    id,
  );
}

export function clearAgentWorktree(db: Database.Database, agentId: string): void {
  db.prepare("UPDATE agents SET worktree_id = NULL WHERE id = ?").run(agentId);
}

/**
 * Single-query post-spawn activation: pid, session_id, status = "running" and the grid the
 * PTY was created at, which a reattach rebuilds the model at (a pane fitting to that same
 * grid sends no resize, so nothing else would record it).
 */
export function activateAgent(
  db: Database.Database,
  agentId: string,
  pid: number,
  size: { cols: number; rows: number },
): void {
  db.prepare(
    "UPDATE agents SET pid = ?, session_id = ?, status = 'running', pty_cols = ?, pty_rows = ? WHERE id = ?",
  ).run(pid, agentId, size.cols, size.rows, agentId);
}
