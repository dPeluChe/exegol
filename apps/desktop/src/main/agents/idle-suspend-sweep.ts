import { userInfo } from "node:os";
import { type AgentStatus, LIVE_STATUSES } from "@exegol/shared";
import type Database from "libsql";
import {
  deleteShellRow,
  liveIn,
  setAgentLastActivity,
  setAgentSuspended,
} from "../db/queries/agents";
import { getAppSettings } from "../db/queries/settings";
import { runNative } from "../lib/concurrency";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { listTcpListeners } from "../system/ports";
import { type ProcRow, readProcessTable } from "../system/shell-clis";
import { getPtyHost } from "../terminal/pty-host";
import { isAgentAwaitingApproval, msSinceAgentOutput } from "./agent-messaging";
import { keepWorktreeOnExit } from "./agent-worktree-ops";
import { idleExempt, idleExemptReported } from "./idle-exempt";
import {
  agentBusy,
  type IdleContext,
  type IdleSession,
  type IdleVerdict,
  idleVerdict,
  shellAtRest,
  treeRssMb,
  typedCliBusy,
} from "./idle-suspend";
import { getAgentManager } from "./manager";
import { getProviderRegistry } from "./registry";
import { lastInputOf, pruneSessionActivity, setActivityPersister } from "./session-activity";
import { broadcastShellClosed, coreRust } from "./spawn-env";

const SWEEP_MS = 10 * 60_000;
/** One skipped line per session and reason, not one every sweep */
const skipLogged = new Map<string, string>();
let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;

type LiveRow = IdleSession & {
  projectId: string;
  projectName: string;
  alias: string | null;
  pid: number | null;
  worktreePath: string | null;
};

type Row = Record<string, unknown> & {
  id: string;
  cli_type: string;
  status: AgentStatus;
  started_at: number;
};

function liveSessions(db: Database.Database, id?: string): LiveRow[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.project_id, p.name AS project_name, a.alias, a.cli_type, a.status, a.pid,
              a.started_at, a.status_changed_at, a.last_activity_at, a.pr_watch,
              a.launched_in_shell, a.parallel_run_id,
              COALESCE((SELECT path FROM worktrees WHERE id = a.worktree_id),
                       (SELECT path FROM worktrees WHERE agent_id = a.id LIMIT 1)) AS worktree_path
       FROM agents a JOIN projects p ON p.id = a.project_id
       WHERE a.archived_at IS NULL AND a.suspended_at IS NULL
         AND a.status IN (${liveIn()})${id ? " AND a.id = ?" : ""}`,
    )
    .all(...LIVE_STATUSES, ...(id ? [id] : [])) as Row[];
  const manager = getAgentManager();
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id as string,
    projectName: r.project_name as string,
    alias: (r.alias as string | null) ?? null,
    cliType: r.cli_type,
    status: r.status,
    pid: (r.pid as number | null) ?? null,
    startedAt: r.started_at,
    statusChangedAt: (r.status_changed_at as number | null) ?? null,
    lastActivityAt: (r.last_activity_at as number | null) ?? null,
    prWatch: ((r.pr_watch as number | null) ?? 0) > 0,
    launchedInShell: r.launched_in_shell === 1,
    driven: r.parallel_run_id != null || manager.hasCompletionCallback(r.id),
    worktreePath: (r.worktree_path as string | null) ?? null,
  }));
}

function freshContext(days: number): IdleContext {
  const now = Date.now();
  const host = getPtyHost();
  return {
    now,
    days,
    exempt: idleExempt(),
    awaitingApproval: isAgentAwaitingApproval,
    questionOnScreen: (id) => host.screenDialog(id) != null,
    activity: (id) => {
      const out = msSinceAgentOutput(id);
      const times = [lastInputOf(id), Number.isFinite(out) ? now - out : undefined];
      const seen = times.filter((t): t is number => t !== undefined);
      return seen.length > 0 ? Math.max(...seen) : undefined;
    },
  };
}

/** Any doubt (no table, no pid, check failed) keeps the session */
async function processReason(
  s: LiveRow,
  verdict: IdleVerdict,
  pid: number | null,
  rows: ProcRow[],
  listening: ReadonlySet<number> | null,
): Promise<string | null> {
  if (rows.length === 0 || !pid) return "no process info";
  if (verdict.kind === "shell") return shellAtRest(pid, rows) ? null : "busy";
  if (!listening) return "no port info";
  const isBusy = s.launchedInShell
    ? typedCliBusy(pid, rows, listening)
    : agentBusy(pid, rows, listening);
  if (isBusy) return "busy";
  if (!s.worktreePath) return null;
  const rust = coreRust;
  if (!rust) return "worktree check unavailable";
  const path = s.worktreePath;
  const dirty = await runNative(() => rust.worktreeHasChangesAsync(path)).catch(() => null);
  return dirty === false ? null : dirty ? "uncommitted changes" : "worktree check failed";
}

const displayName = (s: LiveRow) =>
  s.alias ?? getProviderRegistry().get(s.cliType)?.name ?? s.cliType;

type Outcome = "suspended" | "closed";

/** Stop one session for good only if it is still idle with the live exempt set and activity */
async function stopIdle(
  db: Database.Database,
  id: string,
  days: number,
  planned: IdleVerdict["kind"],
): Promise<Outcome | null> {
  const [s] = liveSessions(db, id);
  const verdict = s && idleVerdict(s, freshContext(days));
  // A CLI typed in a shell that started again was judged on the other rule: not this sweep
  if (!s || verdict?.kind !== planned || planned === "skip") return null;
  const host = getPtyHost();
  const shell = s.cliType === "shell";
  if (!shell) {
    setAgentSuspended(db, s.id, Math.floor(Date.now() / 1000));
    keepWorktreeOnExit(s.id);
    // Before its stop: the renderer marks it suspended, so the exit stays quiet
    broadcast("agent:idle-suspended", { type: "suspending", agentId: s.id });
  }
  await getAgentManager().stop(db, s.id);
  if (host.isAlive(s.id)) throw new Error("did not exit");
  if (shell) {
    deleteShellRow(db, s.id);
    broadcastShellClosed(s);
  }
  return shell ? "closed" : "suspended";
}

export async function sweepIdleSessions(db: Database.Database): Promise<void> {
  const days = getAppSettings(db).idleSuspendDays;
  const host = getPtyHost();
  const live = liveSessions(db).filter((s) => host.isAlive(s.id));
  const liveIds = new Set(live.map((s) => s.id));
  pruneSessionActivity(liveIds);
  for (const id of skipLogged.keys()) if (!liveIds.has(id)) skipLogged.delete(id);
  if (!days || !idleExemptReported()) return;

  const ctx = freshContext(days);
  const idle = live.flatMap((s) => {
    const verdict = idleVerdict(s, ctx);
    return verdict ? [{ s, verdict }] : [];
  });
  const needsPs = idle.some(({ verdict }) => verdict.kind !== "skip");
  const needsPorts = idle.some(({ verdict }) => verdict.kind === "agent");
  const rows = needsPs ? await readProcessTable().catch(() => []) : [];
  const listening = needsPorts
    ? await listTcpListeners(String(userInfo().uid), true)
        .then((l) => new Set(l.map((x) => x.pid)))
        .catch(() => null)
    : null;

  const plan: { s: LiveRow; line: string; kind: IdleVerdict["kind"] }[] = [];
  for (const { s, verdict } of idle) {
    const pid = host.getPid(s.id) ?? s.pid;
    const reason =
      verdict.kind === "skip"
        ? verdict.reason
        : await processReason(s, verdict, pid, rows, listening);
    const rss = needsPs ? `${treeRssMb(pid, rows)} MB` : "n/a";
    const line = `[IdleSuspend] ${s.id} ${s.cliType} project ${s.projectId} idle ${Math.floor(verdict.idleMs / 3_600_000)}h, rss ${rss}`;
    if (reason === null) plan.push({ s, line, kind: verdict.kind });
    else if (skipLogged.get(s.id) !== reason) {
      skipLogged.set(s.id, reason);
      logger.info(`${line} -> skipped (${reason})`);
    }
  }
  if (plan.length === 0) return;

  const sessions: { action: Outcome; [k: string]: unknown }[] = [];
  const failed: string[] = [];
  for (const { s, line, kind } of plan) {
    try {
      const action = await stopIdle(db, s.id, days, kind);
      logger.info(`${line} -> ${action ?? "skipped (active again)"}`);
      if (!action) continue;
      const { id: agentId, projectId, projectName, cliType } = s;
      sessions.push({ agentId, projectId, projectName, name: displayName(s), cliType, action });
    } catch (err) {
      if (s.cliType !== "shell") setAgentSuspended(db, s.id, null);
      failed.push(s.id);
      logger.warn(`${line} -> skipped (stop failed)`, err);
    }
  }
  broadcast("agent:idle-suspended", { type: "done", days, sessions, failed });
  const count = (a: Outcome) => sessions.filter((x) => x.action === a).length;
  logger.info(
    `[IdleSuspend] sweep: ${count("suspended")} suspended, ${count("closed")} closed, ${failed.length} failed (idle ${days}+ days)`,
  );
}

export function startIdleSuspend(db: Database.Database): void {
  if (timer) return;
  setActivityPersister((id, at) => setAgentLastActivity(db, id, at));
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
