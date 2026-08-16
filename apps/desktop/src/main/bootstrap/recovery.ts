import { getAgentManager } from "../agents/manager";
import { getDb } from "../db/client";
import { recoverStaleAgents } from "../db/queries";
import { markStaleQueuedUndeliverable } from "../db/queries/messages";
import { logger } from "../lib/logger";
import { getPtyHost } from "../terminal/pty-host";
import { ensureSidecar } from "../terminal/pty-sidecar-discovery";

// Background: stale data cleanup (not needed before first paint)
export function cleanupStaleData(): void {
  try {
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    const staleCleanup = getDb()
      .prepare(
        `DELETE FROM agents WHERE
          cli_type = 'shell'
          OR (status = 'crashed' AND stopped_at < ?)
          OR (status IN ('completed', 'failed', 'stopped') AND stopped_at < ?)`,
      )
      .run(oneHourAgo, oneDayAgo);
    if (staleCleanup.changes > 0) {
      logger.info(`[Startup] Cleaned ${staleCleanup.changes} stale agent(s)`);
    }
  } catch {
    /* table may not exist */
  }
  try {
    const cleaned = getDb()
      .prepare(
        `DELETE FROM memories WHERE
          content LIKE '%' || X'1B' || '%'
          OR content LIKE '%' || X'0D' || '%'
          OR content LIKE '%bun install%'
          OR content LIKE '%npm install%'
          OR content LIKE '%yarn add%'
          OR content LIKE '%pip install%'
          OR content LIKE '%packages installed%'
          OR content LIKE '%Update now%'
          OR content LIKE '%Skip until next%'`,
      )
      .run();
    if (cleaned.changes > 0) {
      logger.info(`[Startup] Cleaned ${cleaned.changes} ANSI-contaminated memories`);
    }
  } catch {
    /* table may not exist yet */
  }
}

// Background: sidecar connection + agent recovery (non-blocking)
export async function runStartupRecovery(): Promise<void> {
  // Snapshot of DB agents at startup — helps diagnose recovery issues
  try {
    const db = getDb();
    const preRecoveryStats = db
      .prepare("SELECT status, COUNT(*) as count FROM agents GROUP BY status")
      .all() as Array<{ status: string; count: number }>;
    if (preRecoveryStats.length > 0) {
      logger.info(
        `[Startup] DB agent counts pre-recovery: ${preRecoveryStats
          .map((r) => `${r.status}=${r.count}`)
          .join(", ")}`,
      );
    }
  } catch (err) {
    logger.warn("[Startup] Could not snapshot DB agents:", err);
  }

  // T170.1: before ANY queue can exist again. The in-memory queue died with the
  // process, so a message still marked queued was never going to arrive — the
  // sender gets an answer instead of waiting on something that exists nowhere.
  try {
    const stranded = markStaleQueuedUndeliverable(getDb());
    if (stranded > 0) {
      logger.info(`[Recovery] ${stranded} queued message(s) marked undeliverable`);
    }
  } catch (err) {
    logger.warn("[Recovery] Could not sweep stranded messages:", err);
  }

  let aliveSessionIds: string[] = [];
  let sidecarConnected = false;
  try {
    const sidecarClient = await ensureSidecar();
    getPtyHost().connectToSidecar(sidecarClient);
    sidecarConnected = true;
  } catch (err) {
    logger.warn("[Startup] PTY sidecar unavailable, using legacy subprocess mode:", err);
  }

  // Query sessions AFTER connection succeeded, with a separate try/catch so
  // a listInfo failure (e.g., older sidecar missing the RPC) doesn't cause
  // us to abandon the connected sidecar and fall back to legacy subprocess.
  if (sidecarConnected) {
    try {
      const sessionInfo = await getPtyHost().listSidecarSessionsInfo();
      aliveSessionIds = sessionInfo.filter((s) => s.alive).map((s) => s.id);
      const deadInfo = sessionInfo.filter((s) => !s.alive);
      logger.info(
        `[Startup] Sidecar connected — ${sessionInfo.length} total, ${aliveSessionIds.length} alive, ${deadInfo.length} dead`,
      );
      if (aliveSessionIds.length > 0) {
        logger.info(`[Startup] Alive sidecar sessions: ${aliveSessionIds.join(", ")}`);
      }
      if (deadInfo.length > 0) {
        logger.warn(
          `[Startup] Dead sidecar sessions (in 60s grace period): ${deadInfo
            .map((s) => `${s.id}(exit=${s.exitCode ?? "?"}/sig=${s.signal ?? "?"})`)
            .join(", ")}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Unknown method")) {
        // Running against an older sidecar that doesn't have session.listInfo.
        // Fall back to session.list and treat all returned ids as alive.
        // Dead-session detection is lost for this run, but the sidecar stays
        // connected and new spawns work normally. The next restart will
        // reuse the new sidecar (version bump in pty-sidecar-protocol.ts
        // triggers a shutdown + respawn via ensureSidecar).
        logger.warn(
          "[Startup] Old sidecar detected (no session.listInfo). Dead-session detection disabled for this run — restart the app to auto-upgrade.",
        );
        try {
          aliveSessionIds = await getPtyHost().listSidecarSessions();
          logger.info(
            `[Startup] Fallback sidecar list — ${aliveSessionIds.length} session(s): ${aliveSessionIds.join(", ")}`,
          );
        } catch (fallbackErr) {
          logger.error("[Startup] Sidecar fallback listing failed:", fallbackErr);
        }
      } else {
        logger.error("[Startup] Sidecar listInfo failed:", err);
      }
    }
  }
  try {
    // Only agents that are ACTUALLY alive get skipped from the crash sweep.
    // Dead sidecar sessions (session map still populated during grace period
    // but PTY exited) fall through to recoverStaleAgents so they're marked
    // as crashed instead of sitting in DB as "running" with no live process.
    let aliveSkipIds = new Set<string>();
    if (aliveSessionIds.length > 0) {
      const result = await getAgentManager().reattachSidecarAgents(getDb(), aliveSessionIds);
      aliveSkipIds = result.aliveIds;
      logger.info(
        `[Startup] Reattach result: alive=${result.reattached}, dead=${result.deadIds.size}, failed=${result.failedIds.size}`,
      );
      if (result.deadIds.size > 0) {
        logger.warn(
          `[Startup] Dead sidecar sessions (will be marked crashed): ${Array.from(result.deadIds).join(", ")}`,
        );
      }
      if (result.failedIds.size > 0) {
        logger.warn(
          `[Startup] Failed reattach attempts (will be marked crashed): ${Array.from(result.failedIds).join(", ")}`,
        );
      }
      // Verify round 3: sidecar sessions whose DB agent is gone/terminal
      // (closed tabs) survived forever as zombies — 6 alive vs 3 real
      // agents observed. Kill anything the reattach didn't claim.
      const ptyHost = getPtyHost();
      for (const sessionId of aliveSessionIds) {
        if (result.aliveIds.has(sessionId) || result.deadIds.has(sessionId)) continue;
        try {
          ptyHost.killUnclaimed(sessionId);
          logger.info(`[Startup] Killed orphan sidecar session ${sessionId} (no live DB agent)`);
        } catch {
          /* non-fatal */
        }
      }
    }
    const recovery = recoverStaleAgents(getDb(), aliveSkipIds);
    logger.info(
      `[Startup] Crash sweep: marked ${recovery.crashed} agent(s) as crashed (${recovery.alive} alive)`,
    );

    // Final snapshot after recovery — verify nothing is stuck
    try {
      const postStats = getDb()
        .prepare("SELECT status, COUNT(*) as count FROM agents GROUP BY status")
        .all() as Array<{ status: string; count: number }>;
      logger.info(
        `[Startup] DB agent counts post-recovery: ${postStats
          .map((r) => `${r.status}=${r.count}`)
          .join(", ")}`,
      );
    } catch {
      /* non-fatal */
    }
  } catch (err) {
    logger.error("[Startup] Agent recovery failed (non-fatal):", err);
  }
}
