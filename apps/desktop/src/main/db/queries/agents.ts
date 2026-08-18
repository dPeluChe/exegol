import {
  type Agent,
  type AgentCreate,
  type AgentStatus,
  type HistoryEntry,
  LIVE_STATUSES,
} from "@exegol/shared";
import type Database from "libsql";
import { pickAgentCodename } from "../../agents/agent-names";
import { providerSessionId } from "../../agents/provider-session-id";
import { resolveTaskLabel } from "../../agents/task-label";
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
       WHERE a.project_id = ? AND a.archived_at IS NULL
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
  const task = resolveTaskLabel(data.cliType, data.taskDescription);

  db.prepare(
    `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at, access_mode, alias)
     VALUES (?, ?, ?, 'spawning', ?, ?, ?, ?)`,
  ).run(id, data.projectId, data.cliType, task, now, accessMode, alias);

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

// ---------------------------------------------------------------------------
// Session history (T181)
// ---------------------------------------------------------------------------

/** The tail of what a session last said, stored at exit. The ring buffer dies
 *  with the process, so without this a past session has a score and no evidence. */
export function setAgentFinalOutput(db: Database.Database, id: string, output: string): void {
  db.prepare("UPDATE agents SET final_output = ? WHERE id = ?").run(output, id);
}

/**
 * Every session this repo has seen, newest first — closed, crashed and archived
 * alike. The dashboard answers "what is running"; this answers "what did I run,
 * with which agent, and how did it go", which is the question you ask the day
 * after (Antonio, 2026-08-18).
 *
 * Token sums come from a grouped join rather than correlated subqueries: a
 * session with twelve token rows must stay ONE row, and summing inside the join
 * gets all three totals in a single pass over token_usage.
 */
export function listSessionHistory(
  db: Database.Database,
  filters: {
    projectId: string;
    cliType?: string;
    /** Epoch seconds; rows older than this are excluded. */
    since?: number;
    limit?: number;
    offset?: number;
  },
): HistoryEntry[] {
  const conditions = ["a.project_id = ?", "a.cli_type != 'shell'"];
  const values: unknown[] = [filters.projectId];

  if (filters.cliType) {
    conditions.push("a.cli_type = ?");
    values.push(filters.cliType);
  }
  if (filters.since !== undefined) {
    // started_at is the fallback: a session killed with the app never stopped.
    conditions.push("COALESCE(a.stopped_at, a.started_at) >= ?");
    values.push(filters.since);
  }
  values.push(filters.limit ?? 50, filters.offset ?? 0);

  // The aggregates hang off the PAGE, not off every matching session. Ordering
  // by COALESCE(stopped_at, started_at) cannot use an index, so SQLite sorts
  // into a temp b-tree — and evaluates the result columns into it. Filtering
  // and limiting first turned 44ms into 2ms on a 5k-session database, and the
  // table only grows now that ended sessions are no longer purged.
  const rows = db
    .prepare(
      `WITH page AS (
         SELECT a.id, a.alias, a.cli_type, a.task_description, a.status,
                a.started_at, a.stopped_at, a.archived_at,
                a.claude_session_id, a.resume_command, a.worktree_id,
                a.final_output IS NOT NULL AND a.final_output != '' AS has_final_output
         FROM agents a
         WHERE ${conditions.join(" AND ")}
         ORDER BY COALESCE(a.stopped_at, a.started_at) DESC
           LIMIT ? OFFSET ?
       )
       SELECT page.*, w.branch_name, s.overall_score,
              COALESCE(t.input_tokens, 0) AS input_tokens,
              COALESCE(t.output_tokens, 0) AS output_tokens,
              COALESCE(t.cost_usd, 0) AS cost_usd,
              (SELECT COUNT(*) FROM oplog o WHERE o.agent_id = page.id) AS oplog_entries
       FROM page
       LEFT JOIN worktrees w ON w.id = page.worktree_id
       LEFT JOIN agent_scores s ON s.agent_id = page.id
       LEFT JOIN (
         SELECT agent_id,
                SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(estimated_cost_usd) AS cost_usd
         FROM token_usage GROUP BY agent_id
       ) t ON t.agent_id = page.id
       ORDER BY COALESCE(page.stopped_at, page.started_at) DESC`,
    )
    .all(...values) as Record<string, unknown>[];

  return rows.map((r) => ({
    origin: "exegol" as const,
    id: r.id as string,
    provider: r.cli_type as string,
    label: (r.alias as string) ?? (r.task_description as string),
    task: r.task_description as string,
    branch: (r.branch_name as string) ?? null,
    startedAt: (r.started_at as number) ?? null,
    endedAt: (r.stopped_at as number) ?? null,
    status: r.status as string,
    score: (r.overall_score as number) ?? null,
    inputTokens: (r.input_tokens as number) ?? 0,
    outputTokens: (r.output_tokens as number) ?? 0,
    costUsd: (r.cost_usd as number) ?? 0,
    oplogEntries: (r.oplog_entries as number) ?? 0,
    hasFinalOutput: Boolean(r.has_final_output),
    archived: r.archived_at !== null,
    // Every provider's own id, not just claude's — otherwise a codex session
    // Exegol launched shows up twice in the timeline.
    sessionId: providerSessionId(
      r.cli_type as string,
      (r.claude_session_id as string) ?? null,
      (r.resume_command as string) ?? null,
    ),
    version: null,
    sizeBytes: 0,
  }));
}

/** Which providers this repo has actually been worked with — the filter list is
 *  the repo's own history, not the full provider registry. */
export function listHistoryCliTypes(db: Database.Database, projectId: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT cli_type FROM agents
       WHERE project_id = ? AND cli_type != 'shell' ORDER BY cli_type`,
    )
    .all(projectId) as Array<{ cli_type: string }>;
  return rows.map((r) => r.cli_type);
}

export function getAgentFinalOutput(db: Database.Database, id: string): string | null {
  const row = db.prepare("SELECT final_output FROM agents WHERE id = ?").get(id) as
    | { final_output: string | null }
    | undefined;
  return row?.final_output ?? null;
}
