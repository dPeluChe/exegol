import type { AgentCliType } from "@exegol/shared";
import type Database from "libsql";
import { updateAgentStatus } from "../db/queries";
import { getScrollbackPath } from "../ipc/procedures/scrollback";
import { logger } from "../lib/logger";
import { getPtyHost } from "../terminal/pty-host";
import { createOutputProcessor } from "./agent-output-processor";
import { createSpawnCallbacks, type SessionMaps } from "./agent-session-callbacks";
import { cleanupWorktree, hydrateTrackedWorktree, type WorktreeRecord } from "./agent-worktree-ops";
import {
  type AgentContext,
  broadcastAgentStatus,
  DEFAULT_PTY_COLS,
  DEFAULT_PTY_ROWS,
} from "./spawn-env";

export interface ReattachResult {
  /** Number of agents successfully reattached AND confirmed alive. */
  reattached: number;
  /** IDs of agents that were alive after reattach (safe to skip from crash sweep). */
  aliveIds: Set<string>;
  /** IDs of agents whose sidecar session exists but the PTY is dead — must be marked crashed. */
  deadIds: Set<string>;
  /** IDs that threw during reattach — must also be marked crashed. */
  failedIds: Set<string>;
}

export async function reattachSidecarAgents(
  db: Database.Database,
  sidecarSessionIds: string[],
  maps: SessionMaps,
  worktrees: Map<string, WorktreeRecord>,
  maxScrollbackBytes: number,
): Promise<ReattachResult> {
  const stale = db
    .prepare("SELECT * FROM agents WHERE status IN ('running', 'spawning', 'waiting_input')")
    .all() as Array<Record<string, unknown>>;

  logger.info(
    `[Reattach] Starting: ${stale.length} stale DB agent(s), ${sidecarSessionIds.length} live sidecar session(s)`,
  );

  if (stale.length > 0) {
    const byStatus = stale.reduce<Record<string, number>>((acc, r) => {
      const s = (r.status as string) ?? "unknown";
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});
    logger.info(`[Reattach] Stale agents by status: ${JSON.stringify(byStatus)}`);
  }

  const result: ReattachResult = {
    reattached: 0,
    aliveIds: new Set(),
    deadIds: new Set(),
    failedIds: new Set(),
  };
  const ptyHost = getPtyHost();
  const sidecarSet = new Set(sidecarSessionIds);

  for (const row of stale) {
    const agentId = row.id as string;
    const cliType = row.cli_type as AgentCliType;
    const projectId = row.project_id as string;
    const isShell = cliType === "shell";
    const hasSession = sidecarSet.has(agentId);

    logger.info(
      `[Reattach] Inspecting ${agentId} (${cliType}, status=${row.status}, sidecar=${hasSession ? "yes" : "NO"})`,
    );

    if (!hasSession) {
      // No session in sidecar → the crash sweep will mark as crashed
      continue;
    }

    try {
      hydrateTrackedWorktree(db, agentId, worktrees);
      if (!isShell) {
        maps.outputProcessors.set(agentId, createOutputProcessor(agentId, cliType));
        maps.scrollbackBuffers.set(agentId, []);
        maps.scrollbackSizes.set(agentId, 0);
      }

      const scrollbackPath = isShell ? undefined : getScrollbackPath(agentId);

      const agent: AgentContext = {
        id: agentId,
        cliType,
        projectId,
        taskDescription: (row.task_description as string) ?? "",
      };

      const callbacks = createSpawnCallbacks(
        db,
        agent,
        maps,
        (db2, id) => cleanupWorktree(db2, id, worktrees),
        maxScrollbackBytes,
      );

      await ptyHost.reattachSession(
        agentId,
        { cols: DEFAULT_PTY_COLS, rows: DEFAULT_PTY_ROWS },
        callbacks,
        { scrollbackPath },
      );

      // Only mark as running if the PTY process is actually alive
      // (sidecar may hold a dead session whose exit event fires immediately)
      const alive = ptyHost.isAlive(agentId);
      if (!alive) {
        // Clean up the half-initialized runtime state and mark as dead so
        // the caller knows to treat this agent as crashed (NOT as alive).
        // Previously this was a silent `continue`, which left the agent in
        // DB as "running" with no PTY, producing a broken pane that the
        // renderer couldn't recover from.
        maps.outputProcessors.delete(agentId);
        maps.scrollbackBuffers.delete(agentId);
        maps.scrollbackSizes.delete(agentId);
        result.deadIds.add(agentId);
        logger.warn(
          `[Reattach] Dead sidecar session for ${agentId} (${cliType}) — PTY not alive after reattach, will be marked crashed`,
        );
        continue;
      }

      updateAgentStatus(db, agentId, "running");
      broadcastAgentStatus({
        agentId,
        projectId,
        status: "running",
        currentStep: row.current_step as string | null,
        cliType,
        timestamp: Date.now(),
      });

      result.reattached++;
      result.aliveIds.add(agentId);
      logger.info(`[Reattach] OK — reattached ${agentId} (${cliType}), PTY alive`);
    } catch (err) {
      maps.outputProcessors.delete(agentId);
      maps.scrollbackBuffers.delete(agentId);
      maps.scrollbackSizes.delete(agentId);
      result.failedIds.add(agentId);
      logger.warn(`[Reattach] FAILED ${agentId} (${cliType}): ${err}`);
    }
  }

  logger.info(
    `[Reattach] Done — alive=${result.reattached}, dead=${result.deadIds.size}, failed=${result.failedIds.size}`,
  );
  return result;
}
