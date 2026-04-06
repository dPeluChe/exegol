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

export async function reattachSidecarAgents(
  db: Database.Database,
  sidecarSessionIds: string[],
  maps: SessionMaps,
  worktrees: Map<string, WorktreeRecord>,
  maxScrollbackBytes: number,
): Promise<number> {
  const stale = db
    .prepare("SELECT * FROM agents WHERE status IN ('running', 'spawning', 'waiting_input')")
    .all() as Array<Record<string, unknown>>;

  let reattached = 0;
  const ptyHost = getPtyHost();

  for (const row of stale) {
    const agentId = row.id as string;
    const cliType = row.cli_type as AgentCliType;
    const projectId = row.project_id as string;
    const isShell = cliType === "shell";

    if (!sidecarSessionIds.includes(agentId)) continue;

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
      if (!ptyHost.isAlive(agentId)) {
        logger.info(`[AgentManager] Skipping dead sidecar session: ${agentId} (${cliType})`);
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

      reattached++;
      logger.info(`[AgentManager] Reattached to sidecar session: ${agentId} (${cliType})`);
    } catch (err) {
      maps.outputProcessors.delete(agentId);
      maps.scrollbackBuffers.delete(agentId);
      maps.scrollbackSizes.delete(agentId);
      logger.warn(`[AgentManager] Failed to reattach ${agentId}: ${err}`);
    }
  }

  return reattached;
}
