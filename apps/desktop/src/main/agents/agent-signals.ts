import {
  type AgentSignalEvent,
  type AgentSignalType,
  type AgentStatus,
  isKnownSignalType,
} from "@exegol/shared";
import type Database from "libsql";
import { noteCommanderTurn } from "../commander/unread";
import { isAgentQuiet } from "../db/queries";
import { getAgentCwd } from "../db/queries/agents";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { getNotificationBus } from "../notifications/bus";
import { prepareCommanderReply } from "../speech/prepare";
import { noteTurnStarted } from "./agent-message-injection";
import { noteAgentBoundarySignal } from "./agent-message-sweep";
import { followCliName } from "./cli-name";
import { noteHookCwd, noteHookSession } from "./hook-cwd";
import { clearHookTool, noteHookTool } from "./hook-tool";
import { SESSION_ID_RE } from "./provider-session-id";
import { noteChatBoundary } from "./session-chat";
import type { SessionMaps } from "./session-maps";
import { type AgentContext, broadcastAgentStatus, deriveStatusFromSignal } from "./spawn-env";
import { stripAnsi, stripOscSequences } from "./status-parser";
import { writeAgentStatus } from "./status-writes";
import { noteStuckTurnStart } from "./stuck-turn-sweep";
import { noteHookSignal } from "./term-status";
import { endTurn, startTurn } from "./turn-snapshots";

/** Tail length (chars) of scrollback used as the attention notification body. */
const ATTENTION_TAIL_CHARS = 240;

/** Agents that have received ≥1 OSC-777 signal through the PTY. When the OSC
 *  path is alive for an agent it owns signal delivery — file-based hook events
 *  are skipped so the same lifecycle signal is never applied twice. */
export const oscDeliveredAgents = new Set<string>();

export function applyAgentSignals(
  db: Database.Database,
  agent: AgentContext,
  maps: SessionMaps,
  signals: Array<{ agentId: string; event: string }>,
  currentStep: string | null,
  source: AgentSignalEvent["source"] = "hook",
  everyTurn = source === "hook",
): void {
  let signalStatus: AgentStatus | undefined;
  let turnStarted: number | undefined;
  let turnEnded: number | undefined;
  let needsAttention: boolean | undefined;
  let idleOnly = false;

  for (const sig of signals) {
    if (sig.agentId !== agent.id) continue;
    // Whitelist at the boundary: the event string comes from PTY bytes —
    // anything the agent prints (or cats) could otherwise flow through
    // the shared contract as a typed AgentSignalEvent.
    if (!isKnownSignalType(sig.event)) {
      logger.warn(`[AgentCallback] Ignoring unknown signal type '${sig.event}'`);
      continue;
    }
    if (source === "hook") noteHookSignal(agent.id);
    const derived = deriveStatusFromSignal(sig.event);
    trackTurn(db, agent, maps, sig.event);
    if (sig.event === "turn_started") {
      noteTurnStarted(agent.id, everyTurn);
      noteStuckTurnStart(agent.id);
    }

    if (derived.status) signalStatus = derived.status;
    if (derived.turnStarted) turnStarted = derived.turnStarted;
    if (derived.turnEnded) turnEnded = derived.turnEnded;
    // The batch's last status wins: idle followed by turn_started is a running turn, and a
    // question followed by its turn end is no longer asked
    if (derived.status) {
      idleOnly = derived.idleOnly === true;
      needsAttention = derived.needsAttention === true;
    }
    // A permission prompt ends a turn too — latching on it would let an
    // attention signal disable the delivery fallback.
    if (derived.turnEnded && !derived.needsAttention) noteAgentBoundarySignal(agent.id);

    const signalEvent: AgentSignalEvent = {
      agentId: agent.id,
      projectId: agent.projectId,
      type: sig.event,
      at: Date.now(),
      source,
    };
    broadcast("agent:signal", signalEvent);
  }

  if (signalStatus || turnStarted || turnEnded || needsAttention) {
    if (signalStatus) {
      writeAgentStatus(db, agent.id, signalStatus, currentStep ?? undefined);
    }
    // Turn boundaries and attention only: a "running" per tool call was most of the log
    if (turnStarted || turnEnded || needsAttention || idleOnly) {
      logger.info(
        `[AgentCallback] Signal (${source}): ${agent.id} (${agent.cliType}) → status=${signalStatus ?? "unchanged"} needsAttention=${!!needsAttention}${idleOnly ? " idle" : ""}`,
      );
    }
    // Muted or suspended sessions stay quiet
    if (needsAttention && !isAgentQuiet(db, agent.id)) {
      // T124: include the agent's pending question (scrollback tail) so a
      // context switch isn't required just to find out why it's waiting.
      // stripOscSequences first: the attention moment coincides with our
      // own OSC-777 emission at the very end of the buffer, and stripAnsi
      // alone leaves the OSC payload as literal protocol text.
      const scrollback = maps.scrollbackBuffers.get(agent.id)?.join("") ?? "";
      const tail = stripAnsi(stripOscSequences(scrollback)).trim().slice(-ATTENTION_TAIL_CHARS);
      getNotificationBus().emit({
        type: "agent:attention",
        title: "Agent needs your attention",
        body: tail,
        agentId: agent.id,
        projectId: agent.projectId,
        at: Date.now(),
      });
    }

    // Only broadcast a status when the signal actually derived one — a
    // bare turn boundary must not flip a waiting_input agent back to
    // "running" in the renderer while the DB keeps the old status.
    if (signalStatus) {
      broadcastAgentStatus({
        agentId: agent.id,
        projectId: agent.projectId,
        status: signalStatus,
        currentStep: currentStep ?? null,
        cliType: agent.cliType,
        timestamp: Date.now(),
        needsAttention,
        turnStarted,
        turnEnded,
        ...(idleOnly && !turnEnded ? { idleOnly } : {}),
      });
    } else {
      broadcast("agent:turn-boundary", {
        agentId: agent.id,
        projectId: agent.projectId,
        turnStarted,
        turnEnded,
      });
    }
  }
}

/** T200.5: hook turn boundaries snapshot the agent's folder; the async git work never
 *  holds up the output path */
function trackTurn(
  db: Database.Database,
  agent: AgentContext,
  maps: SessionMaps,
  event: AgentSignalType,
): void {
  const boundary = event === "turn_started" || event === "finished";
  if (boundary) noteChatBoundary(agent.id, agent.cliType);
  if (event === "finished") prepareCommanderReply(db, agent);
  if (boundary) noteCommanderTurn(db, agent, event);
  if (event === "turn_started") {
    void followCliName(db, agent, "turn_start");
    clearHookTool(agent.id);
    try {
      const cwd = maps.initialSnapshots.get(agent.id)?.cwd ?? getAgentCwd(db, agent.id);
      if (cwd) startTurn(agent.id, cwd);
    } catch (err) {
      logger.warn(`[Turns] No turn snapshot for ${agent.id}:`, err);
    }
  } else if (event === "finished") {
    void endTurn(agent.id, agent.projectId, agent.cliType);
  }
}

/** T123 second delivery path: Claude Code hooks also write lifecycle events as
 *  JSON files (~/.exegol/events → NotifyHandler). When the OSC-777 PTY path is
 *  not delivering for an agent (hook stdout captured by the CLI, no controlling
 *  tty), these events drive the same deterministic signal pipeline. */
const FILE_EVENT_SIGNALS: Record<string, string> = {
  session_start: "started",
  prompt_submit: "turn_started",
  tool_use: "working",
  permission_needed: "attention",
  stop: "finished",
  session_ready: "idle",
};

const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped", "crashed"]);

/**
 * Keep the latest Claude session id for resume. The startup-banner parse this
 * replaced stopped matching (Claude Code no longer prints the id), so crashed
 * sessions had nothing to resume from. /clear starts a new id: the latest wins.
 */
function storeHookSessionId(db: Database.Database, agentId: string, sessionId: string): void {
  if (!SESSION_ID_RE.test(sessionId)) return;
  try {
    const { changes } = db
      .prepare(
        "UPDATE agents SET claude_session_id = ? WHERE id = ? AND cli_type = 'claude-code' AND claude_session_id IS NOT ?",
      )
      .run(sessionId, agentId, sessionId);
    if (changes) logger.info(`[AgentCallback] Stored Claude session id from hook for ${agentId}`);
  } catch (err) {
    logger.warn(`[AgentCallback] Failed to store hook session id for ${agentId}:`, err);
  }
}

export function dispatchAgentFileEvent(
  db: Database.Database,
  maps: SessionMaps,
  event: { type: string; agentId: string; sessionId?: string; cwd?: string; tool?: string },
): void {
  // Before the OSC short-circuit: OSC carries no session id, folder or tool, hooks do
  if (event.sessionId) {
    storeHookSessionId(db, event.agentId, event.sessionId);
    noteHookSession(event.agentId, event.sessionId);
  }
  noteHookCwd(event.agentId, event.cwd);
  if (event.type === "tool_use") noteHookTool(event.agentId, event.tool);
  if (oscDeliveredAgents.has(event.agentId)) return;
  const sigType = FILE_EVENT_SIGNALS[event.type];
  if (!sigType) return;
  const row = db
    .prepare("SELECT cli_type, project_id, task_description, status FROM agents WHERE id = ?")
    .get(event.agentId) as
    | { cli_type: string; project_id: string; task_description: string | null; status: string }
    | undefined;
  // File events can race the exit finalizer — never resurrect a terminal agent.
  if (!row || row.cli_type === "shell" || TERMINAL_STATUSES.has(row.status)) return;
  const agent: AgentContext = {
    id: event.agentId,
    cliType: row.cli_type as AgentContext["cliType"],
    projectId: row.project_id,
    taskDescription: row.task_description ?? "",
  };
  applyAgentSignals(db, agent, maps, [{ agentId: event.agentId, event: sigType }], null);
}
