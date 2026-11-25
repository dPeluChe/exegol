import { type AgentStatus, LIVE_STATUSES } from "@exegol/shared";
import type Database from "libsql";
import { setAgentFinalOutput } from "../db/queries/agent-history";
import { getAgent, getAgentCwd } from "../db/queries/agents";
import { releasePaths } from "../db/queries/path-claims";
import { broadcast } from "../lib/event-bus";
import { createLogLimiter, suppressedNote } from "../lib/log-limiter";
import { logger } from "../lib/logger";
import { removeAgentMcpConfig, removePerAgentMcpConfig } from "../mcp/exegol-mcp-config";
import { revokeAgentMcpToken } from "../mcp/exegol-server";
import { forgetTerminalLogs } from "../terminal/mount-log";
import { getPtyHost } from "../terminal/pty-host";
import {
  forgetTerminalViewers,
  hasVisibleViewer,
  noteOutputDropped,
} from "../terminal/pty-visibility";
import { noteAgentOutput } from "./agent-message-sweep";
import { clearAgentLinks, clearAgentMessageQueue, isEchoingInjection } from "./agent-messaging";
import { handleParallelAgentExit } from "./agent-parallel-orchestration";
import { applyAgentSignals, oscDeliveredAgents } from "./agent-signals";
import { detectCliSelfUpdate } from "./cli-self-update";
import { handleLostSession } from "./lost-session-exit";
import { detachOutputPipeline } from "./output-pipeline";
import { noteSessionActivity } from "./session-activity";
import type { SessionMaps } from "./session-maps";
import {
  type AgentContext,
  broadcastAgentStatus,
  finalizeAgentStatus,
  forgetBroadcastStatus,
  scoreAndRecordOplog,
} from "./spawn-env";
import { stripAnsi, stripOscSequences } from "./status-parser";
import { writeAgentStatus } from "./status-writes";
import {
  forgetTermStatus,
  PROGRAM_STATUS_REPLY,
  restsAtPrompt,
  START_IDLE_MS,
  takeTermStatus,
} from "./term-status";
import { forgetTurns } from "./turn-snapshots";

/** The parser re-reports the same status on every redraw (agy: each keystroke): a change always
 *  logs, a repeat once per 10 s with its count */
const loggedStatus = new Map<string, string>();
const statusLogLimit = createLogLimiter(10_000);

/** Shells and full-screen TUIs: their escape sequences and status-like text read as "failed"/"waiting_input" */
const SKIP_PARSING = new Set(["shell", "crush", "opencode", "kiro", "grok"]);

/** T181: what the session last said, kept with the row. A score with no output
 *  is a number nobody can check, and the ring buffer dies with the process. */
const FINAL_OUTPUT_TAIL_CHARS = 16_000;

/** Keep the LAST maxScrollbackBytes: attention tails, final output and scoring read the end */
export function appendScrollback(
  maps: SessionMaps,
  agentId: string,
  data: string,
  maxScrollbackBytes: number,
): void {
  const chunks = maps.scrollbackBuffers.get(agentId);
  if (!chunks) return;
  chunks.push(data);
  let size = (maps.scrollbackSizes.get(agentId) ?? 0) + data.length;
  while (size > maxScrollbackBytes && chunks.length > 1) size -= chunks.shift()?.length ?? 0;
  maps.scrollbackSizes.set(agentId, size);
}

export function createSpawnCallbacks(
  db: Database.Database,
  agent: AgentContext,
  maps: SessionMaps,
  onCleanupWorktree: (db: Database.Database, agentId: string) => void | Promise<void>,
  maxScrollbackBytes: number,
) {
  maps.contexts.set(agent.id, agent);
  return {
    onData: (data: string, seq?: number) => {
      // T178: the renderer only needs bytes it can draw. Everything below this
      // line runs regardless — the model, the parser and the delivery clock
      // must never depend on whether a pane happens to be on screen.
      if (hasVisibleViewer(agent.id)) broadcast("terminal:data", agent.id, data, seq);
      else noteOutputDropped(agent.id);
      noteAgentOutput(agent.id);
      noteSessionActivity(agent.id, "output");
      maps.dataCallbacks.get(agent.id)?.(data);
      maps.titleTrackers.get(agent.id)?.(data);

      appendScrollback(maps, agent.id, data, maxScrollbackBytes);

      if (agent.cliType === "shell") return;

      const processor = maps.outputProcessors.get(agent.id);
      if (!processor) return;
      const result = processor.process(data);

      // T123: deterministic hook/OSC-777 signals take priority over scraped status.
      if (result.signals?.length) {
        oscDeliveredAgents.add(agent.id);
        applyAgentSignals(db, agent, maps, result.signals, result.currentStep ?? null);
      }
      if (result.termReports?.length) {
        const term = takeTermStatus(agent.id, agent.cliType, result.termReports);
        // Sync, before the pane's DA reply can come back: Claude Code ends its probe on DA
        if (term.reply) getPtyHost().write(agent.id, PROGRAM_STATUS_REPLY);
        const signals = term.signals.map((event) => ({ agentId: agent.id, event }));
        if (signals.length) {
          applyAgentSignals(db, agent, maps, signals, null, "terminal", term.everyTurn);
        }
        if (term.startedIdle) {
          // A resumed session ends no turn, so nothing else says it is at its prompt. The wait
          // leaves a prompt given at launch time to start its turn
          setTimeout(() => {
            const rests = restsAtPrompt(agent.id) && maps.outputProcessors.has(agent.id);
            if (!rests || getAgent(db, agent.id)?.status !== "running") return;
            applyAgentSignals(
              db,
              agent,
              maps,
              [{ agentId: agent.id, event: "idle" }],
              null,
              "terminal",
            );
          }, START_IDLE_MS).unref();
        }
      }
      // Full-screen TUIs: their own status reports above are deterministic, the scrape is not
      if (SKIP_PARSING.has(agent.cliType)) return;

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
          // The step is raw agent output: it stays out of the log (and bug reports)
          `[AgentCallback] ${agent.id} printed an error but its PTY is alive — keeping the session`,
        );
        scrapedStatus = undefined;
      }
      if (scrapedStatus || result.currentStep) {
        if (scrapedStatus) {
          const changed = loggedStatus.get(agent.id) !== scrapedStatus;
          const skipped = statusLogLimit.take(agent.id, Date.now(), changed);
          if (skipped !== null) {
            loggedStatus.set(agent.id, scrapedStatus);
            logger.info(
              `[AgentCallback] Status change: ${agent.id} (${agent.cliType}) → ${scrapedStatus}${suppressedNote(skipped)}`,
            );
          }
          writeAgentStatus(db, agent.id, scrapedStatus as AgentStatus, result.currentStep);
          broadcastAgentStatus({
            agentId: agent.id,
            projectId: agent.projectId,
            status: scrapedStatus as AgentStatus,
            currentStep: result.currentStep ?? null,
            cliType: agent.cliType,
            timestamp: Date.now(),
          });
        } else if (result.currentStep) {
          writeAgentStatus(db, agent.id, "running", result.currentStep);
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
    },

    onExit: (exitCode: number) => {
      logger.info(`[AgentCallback] onExit: ${agent.id} (${agent.cliType}) exitCode=${exitCode}`);
      const isShell = agent.cliType === "shell";
      const scrollbackForScoring = isShell
        ? ""
        : (maps.scrollbackBuffers.get(agent.id)?.join("") ?? "");

      detachOutputPipeline(maps, agent.id);
      maps.sessionIdsCaptured.delete(agent.id);
      loggedStatus.delete(agent.id);
      statusLogLimit.forget(agent.id);
      forgetTermStatus(agent.id);
      maps.dataCallbacks.delete(agent.id);
      maps.contexts.delete(agent.id);

      if (!isShell) {
        try {
          const tail = stripAnsi(stripOscSequences(scrollbackForScoring))
            .trimEnd()
            .slice(-FINAL_OUTPUT_TAIL_CHARS);
          if (tail) setAgentFinalOutput(db, agent.id, tail);
        } catch (err) {
          logger.warn(`[AgentCallback] Could not store final output for ${agent.id}:`, err);
        }
      }

      const stoppedByUser = maps.stopRequested.delete(agent.id);
      finalizeAgentStatus(db, agent, exitCode, stoppedByUser);
      if (!isShell && !stoppedByUser && !agent.launchedInShell) {
        detectCliSelfUpdate(db, agent, exitCode).catch(() => {});
      }

      // T145: dead agents must not stay live credentials — revoke the MCP
      // token; a committed/leaked .mcp.json then authorizes nothing.
      revokeAgentMcpToken(agent.id);
      // The token also lives on disk (codex sanitizes env) — it must not
      // outlive the agent in the user's repo.
      if (!isShell) {
        removePerAgentMcpConfig(agent.id);
        try {
          const cwd = getAgentCwd(db, agent.id);
          if (cwd) {
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
              .get(cwd, agent.id, ...statuses) as { id?: string } | undefined;
            if (sibling?.id) {
              logger.info(
                `[AgentCallback] Keeping MCP config in ${cwd} — agent ${sibling.id} still lives there`,
              );
            } else {
              removeAgentMcpConfig(cwd);
            }
          }
        } catch (err) {
          logger.warn(`[AgentCallback] MCP config cleanup failed for ${agent.id}:`, err);
        }
      }
      clearAgentMessageQueue(db, agent.id);
      clearAgentLinks(db, agent.id);
      // T172: a dead agent must not keep files reserved — the next one would be
      // blocked by a claim nobody is working on.
      try {
        releasePaths(db, agent.id);
      } catch (err) {
        logger.warn(`[AgentCallback] Failed to release path claims for ${agent.id}:`, err);
      }
      forgetBroadcastStatus(agent.id);
      forgetTerminalViewers(agent.id);
      forgetTerminalLogs(agent.id);
      forgetTurns(agent.id);

      // T65: if this agent was part of a parallel run, check if the run is done.
      handleParallelAgentExit(db, agent.id);

      // Typed in a terminal: Exegol did not run a task there, so there is nothing to score
      if (!isShell && !agent.launchedInShell) {
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

    onLost: (reason: string, persist: boolean) =>
      handleLostSession(db, agent, maps, reason, persist),
  };
}
