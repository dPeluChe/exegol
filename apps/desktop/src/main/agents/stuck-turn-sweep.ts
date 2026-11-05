import type Database from "libsql";
import { getAppSettings } from "../db/queries/settings";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { getNotificationBus } from "../notifications/bus";
import { getPtyHost } from "../terminal/pty-host";
import { isAgentAwaitingApproval, msSinceAgentOutput } from "./agent-messaging";
import { displayName } from "./idle-suspend-sweep";
import { getAgentManager } from "./manager";
import { firstAlert, type StuckContext, stuckTitle, stuckVerdict } from "./stuck-turn";

const CHECK_MS = 60_000;
const since = Date.now();
const turnStarts = new Map<string, number>();
const alerted = new Map<string, number>();
let timer: ReturnType<typeof setInterval> | null = null;

/** A turn_started signal: a new prompt in a session that never left running */
export function noteStuckTurnStart(agentId: string): void {
  turnStarts.set(agentId, Date.now());
}

type Row = {
  id: string;
  project_id: string;
  alias: string | null;
  cli_type: string;
  muted: number | null;
  started_at: number;
  status_changed_at: number | null;
  parallel_run_id: string | null;
};

function runningSessions(db: Database.Database) {
  const rows = db
    .prepare(
      `SELECT id, project_id, alias, cli_type, muted, started_at, status_changed_at,
              parallel_run_id
       FROM agents
       WHERE archived_at IS NULL AND suspended_at IS NULL AND status = 'running'`,
    )
    .all() as Row[];
  const manager = getAgentManager();
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    alias: r.alias,
    cliType: r.cli_type,
    muted: r.muted === 1,
    driven: r.parallel_run_id != null || manager.hasCompletionCallback(r.id),
    startedAt: r.started_at,
    statusChangedAt: r.status_changed_at,
  }));
}

export function checkStuckTurns(db: Database.Database, now = Date.now()): void {
  const limitMinutes = getAppSettings(db).stuckTurnAlertMinutes;
  if (limitMinutes <= 0) {
    alerted.clear();
    turnStarts.clear();
    return;
  }
  const host = getPtyHost();
  const live = runningSessions(db).filter((s) => host.isAlive(s.id));
  const liveIds = new Set(live.map((s) => s.id));
  for (const map of [alerted, turnStarts])
    for (const id of map.keys()) if (!liveIds.has(id)) map.delete(id);

  const ctx: StuckContext = {
    now,
    limitMinutes,
    since,
    turnStartedAt: (id) => turnStarts.get(id),
    msSinceOutput: msSinceAgentOutput,
    needsUser: (id) => isAgentAwaitingApproval(id) || host.screenDialog(id) != null,
  };
  for (const s of live) {
    const verdict = stuckVerdict(s, ctx);
    if (!verdict || !firstAlert(alerted, s.id, verdict.turnStart)) continue;
    const minutes = Math.floor(verdict.runningMs / 60_000);
    logger.info(`[StuckTurn] ${s.id} ${s.cliType} running ${minutes}m (${verdict.reason})`);
    const title = stuckTitle(displayName(s), verdict);
    getNotificationBus().emit({
      type: "agent:attention",
      title,
      body: verdict.reason === "limit" ? "Longer than your alert limit" : "It may be frozen",
      agentId: s.id,
      projectId: s.projectId,
      at: now,
    });
    broadcast("agent:stuck-turn", { agentId: s.id, projectId: s.projectId, reason: title });
  }
}

export function startStuckTurnSweep(db: Database.Database): void {
  if (timer) return;
  timer = setInterval(() => {
    try {
      checkStuckTurns(db);
    } catch (err) {
      logger.warn("[StuckTurn] check failed:", err);
    }
  }, CHECK_MS);
  timer.unref?.();
}
