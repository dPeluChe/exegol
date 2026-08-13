import {
  type AgentSignalEvent,
  type AgentStatus,
  isKnownSignalType,
  LIVE_STATUSES,
} from "@exegol/shared";
import type Database from "libsql";
import { updateAgentStatus } from "../db/queries";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { removeAgentMcpConfig, removePerAgentMcpConfig } from "../mcp/exegol-mcp-config";
import { revokeAgentMcpToken } from "../mcp/exegol-server";
import { getNotificationBus } from "../notifications/bus";
import { getPtyHost } from "../terminal/pty-host";
import { clearAgentLinks, clearAgentMessageQueue, isEchoingInjection } from "./agent-messaging";
import type { OutputProcessor } from "./agent-output-processor";
import { handleParallelAgentExit } from "./agent-parallel-orchestration";
import { createHandoff, generateHandoffFromScrollback } from "./handoff";
import {
  type AgentContext,
  broadcastAgentStatus,
  deriveStatusFromSignal,
  finalizeAgentStatus,
  forgetBroadcastStatus,
  scoreAndRecordOplog,
} from "./spawn-env";
import { stripAnsi, stripOscSequences } from "./status-parser";

/** Tail length (chars) of scrollback used as the attention notification body. */
const ATTENTION_TAIL_CHARS = 240;

export interface SessionMaps {
  outputProcessors: Map<string, OutputProcessor>;
  titleTrackers: Map<string, (data: string) => void>;
  scrollbackBuffers: Map<string, string[]>;
  scrollbackSizes: Map<string, number>;
  tokenLimitDetected: Set<string>;
  completionCallbacks: Map<string, (exitCode: number) => void>;
  initialSnapshots: Map<string, { headSha: string; cwd: string; projectId: string }>;
  dataCallbacks: Map<string, (data: string) => void>;
  /** Agents whose Claude session ID has already been captured + stored (T101). */
  sessionIdsCaptured: Set<string>;
}

/** Agents that have received ≥1 OSC-777 signal through the PTY. When the OSC
 *  path is alive for an agent it owns signal delivery — file-based hook events
 *  are skipped so the same lifecycle signal is never applied twice. */
const oscDeliveredAgents = new Set<string>();

export function applyAgentSignals(
  db: Database.Database,
  agent: AgentContext,
  maps: SessionMaps,
  signals: Array<{ agentId: string; event: string }>,
  currentStep: string | null,
): void {
  let signalStatus: AgentStatus | undefined;
  let turnStarted: number | undefined;
  let turnEnded: number | undefined;
  let needsAttention: boolean | undefined;

  for (const sig of signals) {
    if (sig.agentId !== agent.id) continue;
    // Whitelist at the boundary: the event string comes from PTY bytes —
    // anything the agent prints (or cats) could otherwise flow through
    // the shared contract as a typed AgentSignalEvent.
    if (!isKnownSignalType(sig.event)) {
      logger.warn(`[AgentCallback] Ignoring unknown signal type '${sig.event}'`);
      continue;
    }
    const derived = deriveStatusFromSignal(sig.event);
    if (derived.status) signalStatus = derived.status;
    if (derived.turnStarted) turnStarted = derived.turnStarted;
    if (derived.turnEnded) turnEnded = derived.turnEnded;
    if (derived.needsAttention) needsAttention = true;

    const signalEvent: AgentSignalEvent = {
      agentId: agent.id,
      projectId: agent.projectId,
      type: sig.event,
      at: Date.now(),
      source: "hook",
    };
    broadcast("agent:signal", signalEvent);
  }

  if (signalStatus || turnStarted || turnEnded || needsAttention) {
    if (signalStatus) {
      updateAgentStatus(db, agent.id, signalStatus, currentStep ?? undefined);
    }
    logger.info(
      `[AgentCallback] Signal: ${agent.id} (${agent.cliType}) → status=${signalStatus ?? "unchanged"} needsAttention=${!!needsAttention}`,
    );
    if (needsAttention) {
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
};

const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped", "crashed"]);

export function dispatchAgentFileEvent(
  db: Database.Database,
  maps: SessionMaps,
  event: { type: string; agentId: string },
): void {
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

export function createSpawnCallbacks(
  db: Database.Database,
  agent: AgentContext,
  maps: SessionMaps,
  onCleanupWorktree: (db: Database.Database, agentId: string) => void | Promise<void>,
  maxScrollbackBytes: number,
) {
  return {
    onData: (data: string) => {
      broadcast("terminal:data", agent.id, data);
      maps.dataCallbacks.get(agent.id)?.(data);
      maps.titleTrackers.get(agent.id)?.(data);

      // Skip output processing for shells and interactive TUI CLIs
      // (their output contains TUI escape sequences and status-like text that
      // the parser misinterprets as "failed"/"waiting_input")
      const SKIP_PARSING: Set<string> = new Set(["shell", "crush", "opencode", "kiro"]);
      if (SKIP_PARSING.has(agent.cliType)) return;

      const currentSize = maps.scrollbackSizes.get(agent.id) ?? 0;
      if (currentSize < maxScrollbackBytes) {
        maps.scrollbackBuffers.get(agent.id)?.push(data);
        maps.scrollbackSizes.set(agent.id, currentSize + data.length);
      }

      const processor = maps.outputProcessors.get(agent.id);
      if (!processor) return;
      const result = processor.process(data);

      // T123: deterministic hook/OSC-777 signals take priority over scraped status.
      if (result.signals?.length) {
        oscDeliveredAgents.add(agent.id);
        applyAgentSignals(db, agent, maps, result.signals, result.currentStep ?? null);
      }

      // Everything below is SCRAPED from terminal output — and our own injected
      // messages are echoed back into that same stream. While the echo window
      // is open, no scraped signal about this agent can be trusted: a wrapped
      // line starting with "error" failed a live session, a quoted resume
      // command would overwrite the real one, and a trailing "?" would fake a
      // turn boundary and flush the whole queue at once (2026-08-12).
      const echoingOwnMessage = isEchoingInjection(agent.id);

      // T101: store session ID (claude startup) or resume command (all CLIs shutdown)
      // Both use sessionIdsCaptured to avoid redundant DB writes per agent.
      const sessionPayload = echoingOwnMessage ? null : (result.resumeCommand ?? result.sessionId);
      if (sessionPayload && !maps.sessionIdsCaptured.has(agent.id)) {
        maps.sessionIdsCaptured.add(agent.id);
        try {
          if (result.resumeCommand) {
            db.prepare("UPDATE agents SET resume_command = ? WHERE id = ?").run(
              result.resumeCommand,
              agent.id,
            );
            logger.info(
              `[AgentCallback] Captured resume command for ${agent.id}: ${result.resumeCommand}`,
            );
          } else if (result.sessionId) {
            db.prepare("UPDATE agents SET claude_session_id = ? WHERE id = ?").run(
              result.sessionId,
              agent.id,
            );
            logger.info(
              `[AgentCallback] Captured Claude session ID for ${agent.id}: ${result.sessionId}`,
            );
          }
        } catch (err) {
          logger.warn(`[AgentCallback] Failed to store session info for ${agent.id}:`, err);
        }
        broadcastAgentStatus({
          agentId: agent.id,
          projectId: agent.projectId,
          status: "running",
          currentStep: result.currentStep ?? null,
          cliType: agent.cliType,
          timestamp: Date.now(),
          claudeSessionId: result.sessionId,
        });
      }

      // `failed` kills the session; `waiting_input` fakes a turn boundary and
      // flushes the pending queue in one burst. Both are common in prose.
      let scrapedStatus = result.status;
      if (echoingOwnMessage && (scrapedStatus === "failed" || scrapedStatus === "waiting_input")) {
        logger.info(
          `[AgentCallback] Ignoring scraped "${scrapedStatus}" for ${agent.id} — matches our just-injected message echo`,
        );
        scrapedStatus = undefined;
      }
      // A CLI printing an error line is NOT a dead session: claude and codex
      // both print "Error: …" / "rejected due to unacceptable risk" and keep
      // going. Only the process exit decides failure (onExit → finalize), so a
      // scraped `failed` on a LIVE pty would strand a working agent behind an
      // "Ended" card with no way back (live 2026-08-12).
      if (scrapedStatus === "failed" && getPtyHost().isAlive(agent.id)) {
        logger.info(
          `[AgentCallback] ${agent.id} printed an error but its PTY is alive — keeping the session (was: ${result.currentStep ?? "no detail"})`,
        );
        scrapedStatus = undefined;
      }
      if (scrapedStatus || result.currentStep) {
        if (scrapedStatus) {
          logger.info(
            `[AgentCallback] Status change: ${agent.id} (${agent.cliType}) → ${scrapedStatus}${result.currentStep ? ` [${result.currentStep}]` : ""}`,
          );
          updateAgentStatus(db, agent.id, scrapedStatus as AgentStatus, result.currentStep);
          broadcastAgentStatus({
            agentId: agent.id,
            projectId: agent.projectId,
            status: scrapedStatus as AgentStatus,
            currentStep: result.currentStep ?? null,
            cliType: agent.cliType,
            timestamp: Date.now(),
          });
        } else if (result.currentStep) {
          updateAgentStatus(db, agent.id, "running", result.currentStep);
          broadcastAgentStatus({
            agentId: agent.id,
            projectId: agent.projectId,
            status: "running",
            currentStep: result.currentStep,
            cliType: agent.cliType,
            timestamp: Date.now(),
          });
        }
      }

      if (
        result.tokenLimitWarning &&
        !echoingOwnMessage &&
        !maps.tokenLimitDetected.has(agent.id)
      ) {
        maps.tokenLimitDetected.add(agent.id);
        try {
          const scrollback = maps.scrollbackBuffers.get(agent.id)?.join("") ?? "";
          const summary = generateHandoffFromScrollback(agent.taskDescription, scrollback);
          const handoff = createHandoff(db, { agentId: agent.id, ...summary });
          broadcast("agent:handoff-ready", agent.id, handoff.id);
          logger.info(
            `[AgentManager] Token limit detected for ${agent.id}, handoff created: ${handoff.id}`,
          );
        } catch (err) {
          logger.error(`[AgentManager] Failed to create handoff for ${agent.id}:`, err);
        }
      }
    },

    onExit: (exitCode: number) => {
      logger.info(`[AgentCallback] onExit: ${agent.id} (${agent.cliType}) exitCode=${exitCode}`);
      const isShell = agent.cliType === "shell";
      const scrollbackForScoring = isShell
        ? ""
        : (maps.scrollbackBuffers.get(agent.id)?.join("") ?? "");

      maps.outputProcessors.delete(agent.id);
      maps.titleTrackers.delete(agent.id);
      maps.tokenLimitDetected.delete(agent.id);
      maps.sessionIdsCaptured.delete(agent.id);
      maps.scrollbackBuffers.delete(agent.id);
      maps.scrollbackSizes.delete(agent.id);
      maps.dataCallbacks.delete(agent.id);

      finalizeAgentStatus(db, agent, exitCode);

      // T145: dead agents must not stay live credentials — revoke the MCP
      // token; a committed/leaked .mcp.json then authorizes nothing.
      revokeAgentMcpToken(agent.id);
      // The token also lives on disk (codex sanitizes env) — it must not
      // outlive the agent in the user's repo.
      if (!isShell) {
        removePerAgentMcpConfig(agent.id);
        try {
          const row = db
            .prepare(
              `SELECT COALESCE(w.path, p.path) AS cwd
               FROM agents a
               LEFT JOIN worktrees w ON w.id = a.worktree_id
               JOIN projects p ON p.id = a.project_id
               WHERE a.id = ?`,
            )
            .get(agent.id) as { cwd?: string } | undefined;
          if (row?.cwd) {
            // The config file is per-DIRECTORY: agents sharing a cwd share it.
            // Deleting on exit would strip a LIVE sibling's server entry and
            // leave it with no MCP at all (live incident 2026-08-12).
            const statuses = [...LIVE_STATUSES];
            const sibling = db
              .prepare(
                `SELECT a.id FROM agents a
                 LEFT JOIN worktrees w ON w.id = a.worktree_id
                 JOIN projects p ON p.id = a.project_id
                 WHERE COALESCE(w.path, p.path) = ?
                   AND a.id != ?
                   AND a.status IN (${statuses.map(() => "?").join(",")})
                 LIMIT 1`,
              )
              .get(row.cwd, agent.id, ...statuses) as { id?: string } | undefined;
            if (sibling?.id) {
              logger.info(
                `[AgentCallback] Keeping MCP config in ${row.cwd} — agent ${sibling.id} still lives there`,
              );
            } else {
              removeAgentMcpConfig(row.cwd);
            }
          }
        } catch (err) {
          logger.warn(`[AgentCallback] MCP config cleanup failed for ${agent.id}:`, err);
        }
      }
      clearAgentMessageQueue(agent.id);
      clearAgentLinks(db, agent.id);
      forgetBroadcastStatus(agent.id);

      // T65: if this agent was part of a parallel run, check if the run is done.
      handleParallelAgentExit(db, agent.id);

      if (!isShell) {
        scoreAndRecordOplog(
          db,
          agent,
          exitCode,
          scrollbackForScoring,
          maps.initialSnapshots.get(agent.id),
        );
      }
      maps.initialSnapshots.delete(agent.id);

      try {
        onCleanupWorktree(db, agent.id);
      } catch {
        /* DB closed during shutdown — non-fatal */
      }

      const completionCb = maps.completionCallbacks.get(agent.id);
      if (completionCb) {
        maps.completionCallbacks.delete(agent.id);
        completionCb(exitCode);
      }
    },

    onError: (message: string) => {
      logger.error(`[AgentManager] PTY error for ${agent.id}: ${message}`);
    },
  };
}
