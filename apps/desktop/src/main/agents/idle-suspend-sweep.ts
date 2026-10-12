import { type AgentStatus, LIVE_STATUSES } from "@exegol/shared";
import type Database from "libsql";
import { setAgentSuspended } from "../db/queries/agents";
import { getAppSettings } from "../db/queries/settings";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { readProcessTable } from "../system/shell-clis";
import { getPtyHost } from "../terminal/pty-host";
import { isAgentAwaitingApproval } from "./agent-messaging";
import {
  type IdleSession,
  idleVerdict,
  pruneSessionActivity,
  shellAtRest,
  treeRssMb,
} from "./idle-suspend";
import { getAgentManager } from "./manager";
import { broadcastAgentStatus } from "./spawn-env";

const SWEEP_MS = 10 * 60_000;

let exempt: ReadonlySet<string> = new Set();
/** One skipped line per session and reason, not one every sweep */
const skipLogged = new Map<string, string>();
let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;

export function setIdleExempt(ids: string[]): void {
  exempt = new Set(ids);
}

type LiveRow = IdleSession & {
  projectId: string;
  projectName: string;
  alias: string | null;
  pid: number | null;
};

function liveSessions(db: Database.Database): LiveRow[] {
  const statuses = [...LIVE_STATUSES];
  const rows = db
    .prepare(
      `SELECT a.id, a.project_id, p.name AS project_name, a.alias, a.cli_type, a.status, a.pid,
              a.started_at, a.status_changed_at, a.pr_watch, a.launched_in_shell
       FROM agents a JOIN projects p ON p.id = a.project_id
       WHERE a.archived_at IS NULL AND a.suspended_at IS NULL
         AND a.status IN (${statuses.map(() => "?").join(",")})`,
    )
    .all(...statuses) as {
    id: string;
    project_id: string;
    project_name: string;
    alias: string | null;
    cli_type: string;
    status: AgentStatus;
    pid: number | null;
    started_at: number;
    status_changed_at: number | null;
    pr_watch: number | null;
    launched_in_shell: number | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    alias: r.alias,
    cliType: r.cli_type,
    status: r.status,
    pid: r.pid,
    startedAt: r.started_at,
    statusChangedAt: r.status_changed_at,
    prWatch: (r.pr_watch ?? 0) > 0,
    launchedInShell: r.launched_in_shell === 1,
  }));
}

/** A shell is a terminal tab with nothing to keep: its row goes and every window drops it */
export function deleteShellRow(db: Database.Database, agent: { id: string; projectId: string }) {
  db.prepare("DELETE FROM agents WHERE id = ?").run(agent.id);
  broadcastAgentStatus({
    agentId: agent.id,
    projectId: agent.projectId,
    status: "stopped",
    currentStep: null,
    cliType: "shell",
    timestamp: Date.now(),
  });
}

type Outcome = "suspended" | "closed" | "skipped";

export async function sweepIdleSessions(db: Database.Database, now = Date.now()): Promise<void> {
  const days = getAppSettings(db).idleSuspendDays;
  const host = getPtyHost();
  const live = liveSessions(db).filter((s) => host.isAlive(s.id));
  const liveIds = new Set(live.map((s) => s.id));
  pruneSessionActivity(liveIds);
  for (const id of skipLogged.keys()) if (!liveIds.has(id)) skipLogged.delete(id);
  if (!days) return;
  const ctx = { now, days, exempt, awaitingApproval: isAgentAwaitingApproval };
  const idle = live.filter((s) => idleVerdict(s, ctx));
  if (idle.length === 0) return;

  // One read for the whole sweep: shells' foreground jobs and every tree's memory
  const rows = await readProcessTable().catch(() => []);
  const plan: { s: LiveRow; outcome: Exclude<Outcome, "skipped"> }[] = [];
  for (const s of idle) {
    // Again after the ps: typing meanwhile keeps the session
    const verdict = idleVerdict(s, ctx);
    if (!verdict) continue;
    const pid = host.getPid(s.id) ?? s.pid;
    let outcome: Outcome = "suspended";
    let reason = "";
    if (verdict.kind === "skip") {
      outcome = "skipped";
      reason = verdict.reason;
    } else if (verdict.kind === "shell") {
      if (rows.length === 0) [outcome, reason] = ["skipped", "no process table"];
      else if (!pid || !shellAtRest(pid, rows)) [outcome, reason] = ["skipped", "busy"];
      // A CLI that exited to its prompt keeps its row for Resume
      else if (s.cliType === "shell") outcome = "closed";
    }
    if (outcome === "skipped" && skipLogged.get(s.id) === reason) continue;
    if (outcome === "skipped") skipLogged.set(s.id, reason);
    else plan.push({ s, outcome });
    const hours = Math.floor(verdict.idleMs / 3_600_000);
    logger.info(
      `[IdleSuspend] ${s.id} ${s.cliType} project ${s.projectId} idle ${hours}h, rss ${treeRssMb(pid, rows)} MB -> ${outcome}${reason ? ` (${reason})` : ""}`,
    );
  }
  if (plan.length === 0) return;

  const ids = (o: Outcome) => plan.filter((p) => p.outcome === o).map((p) => p.s.id);
  const suspended = ids("suspended");
  const closed = ids("closed");
  const at = Math.floor(now / 1000);
  for (const id of suspended) setAgentSuspended(db, id, at);
  // Before the stops: the renderer marks them suspended, so their exits stay quiet
  broadcast("agent:idle-suspended", {
    days,
    sessions: plan.map(({ s, outcome }) => ({
      agentId: s.id,
      projectId: s.projectId,
      projectName: s.projectName,
      name: s.alias ?? s.cliType,
      cliType: s.cliType,
      action: outcome,
    })),
  });
  const manager = getAgentManager();
  for (const { s, outcome } of plan) {
    try {
      await manager.stop(db, s.id);
      if (outcome === "closed") deleteShellRow(db, s);
    } catch (err) {
      logger.warn(`[IdleSuspend] ${s.id} stop failed:`, err);
    }
  }
  logger.info(
    `[IdleSuspend] sweep: ${suspended.length} suspended, ${closed.length} closed (idle ${days}+ days)`,
  );
}

export function startIdleSuspend(db: Database.Database): void {
  if (timer) return;
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    sweepIdleSessions(db)
      .catch((err) => logger.warn("[IdleSuspend] sweep failed:", err))
      .finally(() => {
        busy = false;
      });
  }, SWEEP_MS);
  timer.unref?.();
}
