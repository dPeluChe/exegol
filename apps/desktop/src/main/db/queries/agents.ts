import { type Agent, type AgentCreate, type AgentStatus, LIVE_STATUSES } from "@exegol/shared";
import type Database from "libsql";
import { pickAgentCodename } from "../../agents/agent-names";
import { logger } from "../../lib/logger";
import { mapAgentRow, nanoid } from "./helpers";

export type ActiveAgent = Agent & { projectName: string; groupColor: string | null };

/** T156: every non-terminal agent across ALL projects, with project name +
 *  group color — the renderer store only knows projects opened this session. */
export function listActiveAgents(db: Database.Database): ActiveAgent[] {
  const statuses = [...LIVE_STATUSES];
  const rows = db
    .prepare(
      `SELECT a.*, w.branch_name, p.name as project_name, g.color as group_color
       FROM agents a
       LEFT JOIN worktrees w ON w.id = a.worktree_id
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
      `SELECT a.*, w.branch_name
       FROM agents a
       LEFT JOIN worktrees w ON w.id = a.worktree_id
       WHERE a.project_id = ?
       ORDER BY a.started_at DESC`,
    )
    .all(projectId);
  return (rows as Record<string, unknown>[]).map(mapAgentRow);
}

/** T160: set/clear the session alias (addressing name for agent_send + UI). */
export function setAgentAlias(db: Database.Database, id: string, alias: string | null): void {
  db.prepare("UPDATE agents SET alias = ? WHERE id = ?").run(alias, id);
}

/** T160: live agents whose alias matches (case-insensitive) — for name addressing. */
export function findLiveAgentsByAlias(db: Database.Database, alias: string): Agent[] {
  const statuses = [...LIVE_STATUSES];
  const rows = db
    .prepare(
      `SELECT a.*, w.branch_name
       FROM agents a
       LEFT JOIN worktrees w ON w.id = a.worktree_id
       WHERE LOWER(a.alias) = LOWER(?)
         AND a.status IN (${statuses.map(() => "?").join(",")})`,
    )
    .all(alias, ...statuses);
  return (rows as Record<string, unknown>[]).map(mapAgentRow);
}

export function getAgent(db: Database.Database, id: string): Agent | null {
  const row = db
    .prepare(
      `SELECT a.*, w.branch_name
       FROM agents a
       LEFT JOIN worktrees w ON w.id = a.worktree_id
       WHERE a.id = ?`,
    )
    .get(id);
  return row ? mapAgentRow(row as Record<string, unknown>) : null;
}

export function createAgent(db: Database.Database, data: AgentCreate): Agent {
  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);
  const accessMode = data.accessMode ?? "write";

  // T167: a session without a name shows up as its provider ("opencode"), so
  // two of the same CLI are indistinguishable in the UI and un-addressable by
  // agent_send. Shells are excluded — they're not messaging participants.
  const alias = data.cliType === "shell" ? null : pickAgentCodename(db);

  db.prepare(
    `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at, access_mode, alias)
     VALUES (?, ?, ?, 'spawning', ?, ?, ?, ?)`,
  ).run(id, data.projectId, data.cliType, data.taskDescription, now, accessMode, alias);

  // biome-ignore lint/style/noNonNullAssertion: row was just inserted
  return getAgent(db, id)!;
}

export function updateAgentStatus(
  db: Database.Database,
  id: string,
  status: AgentStatus,
  currentStep?: string,
): void {
  if (currentStep !== undefined) {
    db.prepare("UPDATE agents SET status = ?, current_step = ? WHERE id = ?").run(
      status,
      currentStep,
      id,
    );
  } else {
    db.prepare("UPDATE agents SET status = ? WHERE id = ?").run(status, id);
  }
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

export function clearAgentWorktree(db: Database.Database, agentId: string): void {
  db.prepare("UPDATE agents SET worktree_id = NULL WHERE id = ?").run(agentId);
}

/**
 * Single-query post-spawn activation: sets pid, session_id, and status = "running"
 * in one round-trip, replacing the three separate UPDATEs previously issued after
 * ptyHost.createSession() resolves.
 */
export function activateAgent(db: Database.Database, agentId: string, pid: number): void {
  db.prepare("UPDATE agents SET pid = ?, session_id = ?, status = 'running' WHERE id = ?").run(
    pid,
    agentId,
    agentId,
  );
}

// ---------------------------------------------------------------------------
// Recent Sessions
// ---------------------------------------------------------------------------

export interface RecentSessionRow {
  id: string;
  taskDescription: string;
  cliType: string;
  status: string;
  startedAt: number | null;
  stoppedAt: number | null;
  projectName: string;
  projectId: string;
}

export function listRecentSessions(db: Database.Database, limit = 10): RecentSessionRow[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.task_description, a.cli_type, a.status, a.started_at, a.stopped_at,
              p.name as project_name, p.id as project_id
       FROM agents a
       JOIN projects p ON a.project_id = p.id
       WHERE a.status IN ('completed', 'failed', 'stopped')
         AND a.archived_at IS NULL
       ORDER BY a.stopped_at DESC
       LIMIT ?`,
    )
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    taskDescription: r.task_description as string,
    cliType: r.cli_type as string,
    status: r.status as string,
    startedAt: (r.started_at as number) ?? null,
    stoppedAt: (r.stopped_at as number) ?? null,
    projectName: r.project_name as string,
    projectId: r.project_id as string,
  }));
}

/**
 * Recover agents from a previous session.
 * Agents already reattached to a sidecar (via AgentManager.reattachSidecarAgents)
 * are skipped — they have a live PtyHost session.
 * Remaining agents are marked as "crashed".
 *
 * @param skipIds - agent IDs to skip (already recovered via sidecar).
 *                  IMPORTANT: this must only contain agents whose PTY is
 *                  ACTUALLY alive, not just agents whose sidecar session
 *                  exists. Dead sidecar sessions should be left out so
 *                  they get marked as crashed here.
 */
export function recoverStaleAgents(
  db: Database.Database,
  skipIds?: Set<string>,
): { crashed: number; alive: number } {
  const stale = db
    .prepare(
      "SELECT id, cli_type, status, pid FROM agents WHERE status IN ('running', 'spawning', 'waiting_input')",
    )
    .all() as Array<{ id: string; cli_type: string; status: string; pid: number | null }>;

  let crashed = 0;
  const alive = skipIds?.size ?? 0;
  const now = Math.floor(Date.now() / 1000);

  if (stale.length > 0) {
    logger.info(`[Recovery] Crash sweep: ${stale.length} stale agent(s), ${alive} in skip set`);
  }

  for (const agent of stale) {
    if (skipIds?.has(agent.id)) {
      logger.info(`[Recovery] Skip ${agent.id} (${agent.cli_type}) — alive via sidecar`);
      continue;
    }

    logger.info(
      `[Recovery] Mark crashed: ${agent.id} (${agent.cli_type}, status=${agent.status}, pid=${agent.pid ?? "null"})`,
    );
    db.prepare(
      "UPDATE agents SET status = 'crashed', stopped_at = ?, current_step = 'Session interrupted — app exited unexpectedly', pid = NULL WHERE id = ?",
    ).run(now, agent.id);
    crashed++;
  }

  return { crashed, alive };
}

/** T176: hide an ended session from the dashboard. Live agents are refused —
 *  archiving one would make a running session invisible. */
export function archiveAgent(db: Database.Database, id: string): boolean {
  const statuses = [...LIVE_STATUSES];
  const info = db
    .prepare(
      `UPDATE agents SET archived_at = unixepoch()
       WHERE id = ? AND archived_at IS NULL
         AND status NOT IN (${statuses.map(() => "?").join(",")})`,
    )
    .run(id, ...statuses);
  return Number(info.changes ?? 0) > 0;
}

/** Archive every ended session, optionally scoped to one project. */
export function archiveEndedAgents(db: Database.Database, projectId?: string): number {
  const statuses = [...LIVE_STATUSES];
  const info = db
    .prepare(
      `UPDATE agents SET archived_at = unixepoch()
       WHERE archived_at IS NULL
         AND status NOT IN (${statuses.map(() => "?").join(",")})
         ${projectId ? "AND project_id = ?" : ""}`,
    )
    .run(...statuses, ...(projectId ? [projectId] : []));
  return Number(info.changes ?? 0);
}
