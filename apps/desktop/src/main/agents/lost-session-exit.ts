// A session the sidecar took with it while the app ran: crashed and resumable, like after a
// restart. No finalize as failed, no scoring, no worktree save or cleanup, the row stays.
import type Database from "libsql";
import { logger } from "../lib/logger";
import { revokeAgentMcpToken } from "../mcp/exegol-server";
import { forgetTerminalViewers } from "../terminal/pty-visibility";
import type { SessionMaps } from "./agent-session-callbacks";
import { lastActiveOf } from "./auto-resume";
import { addLost } from "./lost-sessions";
import { detachOutputPipeline } from "./output-pipeline";
import { type AgentContext, broadcastAgentStatus, forgetBroadcastStatus } from "./spawn-env";
import { forgetTurns } from "./turn-snapshots";

export const lostStep = (reason: string) => `Session interrupted: sidecar stopped (${reason})`;

/** `persist` false: the app relaunches and startup recovery marks it (status left as it was) */
export function handleLostSession(
  db: Database.Database,
  agent: AgentContext,
  maps: SessionMaps,
  reason: string,
  persist: boolean,
): void {
  detachOutputPipeline(maps, agent.id);
  maps.sessionIdsCaptured.delete(agent.id);
  maps.dataCallbacks.delete(agent.id);
  maps.contexts.delete(agent.id);
  maps.initialSnapshots.delete(agent.id);
  maps.stopRequested.delete(agent.id);
  revokeAgentMcpToken(agent.id);
  forgetBroadcastStatus(agent.id);
  forgetTerminalViewers(agent.id);
  forgetTurns(agent.id);
  if (!persist) return;

  const row = db
    .prepare("SELECT last_activity_at, status_changed_at, started_at FROM agents WHERE id = ?")
    .get(agent.id) as Parameters<typeof lastActiveOf>[0] | undefined;
  const step = lostStep(reason);
  db.prepare(
    "UPDATE agents SET status = 'crashed', stopped_at = unixepoch(), current_step = ?, pid = NULL WHERE id = ?",
  ).run(step, agent.id);
  addLost([{ id: agent.id, lastActiveAt: row ? lastActiveOf(row) : 0 }]);
  broadcastAgentStatus({
    agentId: agent.id,
    projectId: agent.projectId,
    status: "crashed",
    currentStep: step,
    cliType: agent.cliType,
    timestamp: Date.now(),
  });
  logger.info(`[Recovery] ${agent.id} (${agent.cliType}): crashed, sidecar stopped (${reason})`);
}
