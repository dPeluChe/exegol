import type { AgentCliType } from "@exegol/shared";
import type Database from "libsql";
import { updateAgentStatus } from "../db/queries";
import { getScrollbackPath } from "../ipc/procedures/scrollback";
import { logger } from "../lib/logger";
import { readAgentMcpToken, readPerAgentMcpToken } from "../mcp/exegol-mcp-config";
import { ensureExegolMcpServerStarted, restoreAgentMcpToken } from "../mcp/exegol-server";
import { getPtyHost } from "../terminal/pty-host";
import { createOutputProcessor } from "./agent-output-processor";
import { createSpawnCallbacks, type SessionMaps } from "./agent-session-callbacks";
import { cleanupWorktree, hydrateTrackedWorktree, type WorktreeRecord } from "./agent-worktree-ops";
import { getProviderRegistry } from "./registry";
import {
  type AgentContext,
  broadcastAgentStatus,
  DEFAULT_PTY_COLS,
  DEFAULT_PTY_ROWS,
} from "./spawn-env";
import { parseResumeCommandFromPattern, stripAnsi, stripOscSequences } from "./status-parser";

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
  const updateResumeCommand = db.prepare("UPDATE agents SET resume_command = ? WHERE id = ?");

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

    const resumePattern = getProviderRegistry().get(cliType)?.capabilities?.resumeCommandPattern;

    try {
      hydrateTrackedWorktree(db, agentId, worktrees);
      if (!isShell) {
        maps.outputProcessors.set(agentId, createOutputProcessor(agentId, cliType, resumePattern));
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

      // T145 restart continuity: the MCP server only started on SPAWN, so a
      // restart with only reattached agents left the socket dead and the
      // in-memory token registry empty (verify session 2026-08-11 — shim
      // timeouts). Start the server and re-arm the on-disk token.
      if (!isShell) {
        try {
          ensureExegolMcpServerStarted(db);
          const wt = worktrees.get(agentId);
          const projectPath = (
            db.prepare("SELECT path FROM projects WHERE id = ?").get(projectId) as
              | { path?: string }
              | undefined
          )?.path;
          const cwd = wt?.worktreePath ?? projectPath;
          // Per-agent file first (no cwd guessing, no sibling collision).
          const token = readPerAgentMcpToken(agentId) ?? (cwd ? readAgentMcpToken(cwd) : null);
          if (token) {
            const rearmed = restoreAgentMcpToken(agentId, projectId, token);
            logger.info(
              rearmed
                ? `[Reattach] MCP token re-armed for ${agentId}`
                : `[Reattach] MCP token NOT re-armed for ${agentId} (shared with another agent) — its MCP calls will be unauthorized until the session restarts`,
            );
          }
        } catch (err) {
          logger.warn(`[Reattach] MCP re-arm failed for ${agentId}:`, err);
        }
      }

      // T101 gap (verify round 3): a TUI that died while the app was closed
      // printed its resume banner into the ring with no parser attached —
      // the session browser then respawned a bare CLI with no session id.
      // Scan the ring tail on reattach so the resume handle isn't lost.
      if (!isShell && resumePattern && !row.resume_command) {
        try {
          const snap = ptyHost.getSnapshot(agentId);
          if (snap) {
            // Slice before stripping: only the tail matters, no need to
            // regex-clean the whole ring.
            const tail = stripAnsi(stripOscSequences(snap.slice(-16_000))).slice(-4000);
            const resumeCommand = parseResumeCommandFromPattern(resumePattern, tail);
            if (resumeCommand) {
              updateResumeCommand.run(resumeCommand, agentId);
              logger.info(`[Reattach] Captured resume command from ring for ${agentId}`);
            }
          }
        } catch {
          /* non-fatal */
        }
      }

      // Reattach lands as IDLE, not running: an agent that survived a restart
      // is almost always sitting at its prompt — blanket "running" left stale
      // spinners on providers without live signals (codex, verify round 3).
      // Real activity self-promotes via the first signal/scrape instantly.
      updateAgentStatus(db, agentId, "waiting_input");
      broadcastAgentStatus({
        agentId,
        projectId,
        status: "waiting_input",
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
