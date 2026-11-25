import type Database from "libsql";
import { lastActiveOf } from "../../agents/auto-resume";
import { logger } from "../../lib/logger";

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
  reasonFor: (id: string) => string = () => "no live session",
): {
  crashed: number;
  alive: number;
  crashedIds: string[];
  reasons: string[];
  /** Read before the sweep moves status_changed_at (auto-resume's 3-day rule) */
  lastActive: Map<string, number>;
} {
  const stale = db
    .prepare(
      `SELECT id, cli_type, status, pid, last_activity_at, status_changed_at, started_at FROM agents WHERE status IN ('running', 'spawning', 'waiting_input')
       OR (launched_in_shell = 1 AND status = 'idle')`,
    )
    .all() as Array<
    {
      id: string;
      cli_type: string;
      status: string;
      pid: number | null;
    } & Parameters<typeof lastActiveOf>[0]
  >;

  let crashed = 0;
  const crashedIds: string[] = [];
  const reasons: string[] = [];
  const lastActive = new Map<string, number>();
  const alive = skipIds?.size ?? 0;
  const now = Math.floor(Date.now() / 1000);

  if (stale.length > 0) {
    logger.info(`[Recovery] Crash sweep: ${stale.length} stale agent(s), ${alive} in skip set`);
  }

  for (const agent of stale) {
    if (skipIds?.has(agent.id)) {
      logger.info(`[Recovery] ${agent.id} (${agent.cli_type}): reattached, alive via sidecar`);
      continue;
    }

    const reason = reasonFor(agent.id);
    reasons.push(reason);
    logger.info(
      `[Recovery] ${agent.id} (${agent.cli_type}, status=${agent.status}, pid=${agent.pid ?? "null"}): crashed, ${reason}`,
    );
    crashed++;
    crashedIds.push(agent.id);
    lastActive.set(agent.id, lastActiveOf(agent));
  }
  if (crashedIds.length > 0) {
    db.prepare(
      `UPDATE agents SET status = 'crashed', stopped_at = ?, current_step = 'Session interrupted — app exited unexpectedly', pid = NULL
       WHERE id IN (${crashedIds.map(() => "?").join(",")})`,
    ).run(now, ...crashedIds);
  }

  return { crashed, alive, crashedIds, reasons, lastActive };
}
