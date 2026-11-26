import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AgentCliType,
  type AgentSignalType,
  type AgentStatus,
  CLAUDE_ATTENTION_NOTIFICATIONS,
  CLAUDE_IDLE_NOTIFICATIONS,
  CLAUDE_SESSION_READY_SOURCES,
  LIVE_STATUSES,
} from "@exegol/shared";
import type Database from "libsql";
import { getDb } from "../db/client";
import { createOplogEntry, getAgent, insertActivity, isAgentQuiet, stopAgent } from "../db/queries";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { resolveClaimGuardPath } from "../mcp/exegol-mcp-config";
import { getNotificationBus } from "../notifications/bus";
import { getApiKey } from "../security/keystore";
import { type NodeLaunch, nodeLaunch, nodeShellCommand } from "../system/node-launch";
import { refreshTray } from "../system/tray";
import { noteApprovalStatus } from "./agent-message-queue";
import { deliverPendingAgentMessages, fireAgentLinks } from "./agent-messaging";
import { followCliName } from "./cli-name";
import { scoreAgent } from "./scoring";
import { bashPath, HOOKS_DIR, type NotifyEvent, notifyCommand } from "./wrappers";

/** Claude runs hooks through Git Bash on Windows, which wants forward-slash paths */
function gitBashLaunch(launch: NodeLaunch): NodeLaunch {
  return { command: bashPath(launch.command), args: launch.args.map((a) => bashPath(a)) };
}
export interface AgentContext {
  id: string;
  /** Mutable: a CLI typed in a terminal promotes the live session (shell-promotion.ts) */
  cliType: AgentCliType;
  projectId: string;
  taskDescription: string;
  launchedInShell?: boolean;
}

// ─── Push event types ────────────────────────────────────────────────────

interface AgentStatusEvent {
  agentId: string;
  projectId: string;
  status: AgentStatus;
  currentStep: string | null;
  cliType: string;
  timestamp: number;
  /** Claude session ID, set once when first parsed from startup output (T101). */
  claudeSessionId?: string;
  /** unix epoch ms — set when a hook/OSC signal reports a new turn boundary (T123). */
  turnStarted?: number;
  /** unix epoch ms — set when a hook/OSC signal reports a turn completed (T123). */
  turnEnded?: number;
  /** True when the agent is waiting on the user (T123 `attention` signal / T141 inbox). */
  needsAttention?: boolean;
  /** At its prompt without having finished a turn (`idle` signal): delivers messages, fires no links */
  idleOnly?: boolean;
  /** From the CLI's own signal (hook or terminal report), not scraped: a turn end there is no question */
  reported?: boolean;
  /** Pending question text extracted from an `attention` signal's detail, if any. */
  attentionDetail?: string;
  /** Set when a terminal's session became an agent (or went back to its prompt) */
  alias?: string | null;
  launchedInShell?: boolean;
  /** When the status last changed (ms); the DB's value for the first event after a restart */
  statusChangedAt?: number;
}

// Last status we broadcast per agent — turn-boundary side effects fire on the
// EDGE into waiting_input, never on the level. Without this: the scraper
// re-emits waiting_input per PTY frame (flapping) → repeated delivery + link
// SELECTs; and reattach synthesizes waiting_input at startup → premature link
// firing. Undefined prev (first event, incl. reattach) is NOT an edge.
const lastBroadcastStatus = new Map<string, AgentStatus>();
const statusSince = new Map<string, number>();

export function forgetBroadcastStatus(agentId: string): void {
  lastBroadcastStatus.delete(agentId);
  statusSince.delete(agentId);
}

function statusChangedAt(
  agentId: string,
  prev: AgentStatus | undefined,
  next: AgentStatus,
): number {
  const known = statusSince.get(agentId);
  if (prev === next && known !== undefined) return known;
  let at = Date.now();
  if (prev === undefined) {
    try {
      const row = getAgent(getDb(), agentId);
      // Startup reattach reports waiting_input over a row saying running: a live row keeps its stamp
      if (row?.statusChangedAt && LIVE_STATUSES.has(row.status)) at = row.statusChangedAt;
    } catch {
      // db not ready during early startup: now is the best guess
    }
  }
  statusSince.set(agentId, at);
  return at;
}

/** A closed shell's row is gone: every window drops it, not only the one that closed it */
export function broadcastShellClosed(agent: { id: string; projectId: string }): void {
  broadcastAgentStatus({
    agentId: agent.id,
    projectId: agent.projectId,
    status: "stopped",
    currentStep: null,
    cliType: "shell",
    timestamp: Date.now(),
  });
}

/** Broadcast an agent status event to all renderer windows + refresh tray badge */
export function broadcastAgentStatus(event: AgentStatusEvent): void {
  const prev = lastBroadcastStatus.get(event.agentId);
  lastBroadcastStatus.set(event.agentId, event.status);
  broadcast("agent:status-changed", {
    ...event,
    statusChangedAt: statusChangedAt(event.agentId, prev, event.status),
  });
  refreshTray();

  // needsAttention is transient (never persisted), so messaging can't read it
  // from the DB — mirror it here so a sender can't inject into a permission
  // dialog and confirm it with the trailing Enter.
  noteApprovalStatus(event.agentId, event);

  // T157/T162: turn boundary = a real transition INTO waiting_input that is NOT
  // an attention prompt. Delivering on `needsAttention` would inject (with a
  // trailing Enter) into a permission dialog and could auto-confirm it — the
  // exact trust boundary the attribution header defends (simplify A2/A3/A4).
  const enteredIdleBoundary =
    event.status === "waiting_input" &&
    prev !== undefined &&
    prev !== "waiting_input" &&
    !event.needsAttention;
  if (enteredIdleBoundary) {
    try {
      const db = getDb();
      deliverPendingAgentMessages(db, event.agentId);
      if (!event.idleOnly) fireAgentLinks(db, event.agentId);
      void followCliName(db, { id: event.agentId, cliType: event.cliType }, "turn_end");
    } catch (err) {
      // db not ready during early startup — non-fatal, but never silent: a
      // swallowed delivery failure looks exactly like "nobody wrote to me".
      logger.warn(`[AgentMsg] Turn-boundary delivery failed for ${event.agentId}:`, err);
    }
  }
}

// ─── Deterministic signal → status mapping (T123) ────────────────────────

/**
 * Maps a hook/OSC-777 `AgentSignalType` to the status-event fields it implies.
 * `null` fields mean "no change" — callers should merge onto the existing event.
 */
export function deriveStatusFromSignal(event: string): {
  status?: AgentStatus;
  turnStarted?: number;
  turnEnded?: number;
  needsAttention?: boolean;
  idleOnly?: boolean;
} {
  const now = Date.now();
  switch (event as AgentSignalType) {
    case "started":
    case "working":
      return { status: "running" };
    case "turn_started":
      return { status: "running", turnStarted: now };
    case "turn_ended":
      return { turnEnded: now };
    case "attention":
      // The Notification hook fires when the CLI genuinely needs the user
      // (permission prompt, question) — the only per-turn attention signal.
      return { status: "waiting_input", turnEnded: now, needsAttention: true };
    case "finished":
      // Stop fires at the end of EVERY assistant turn in an interactive
      // session — it is a turn boundary, not an attention event. Notifying
      // here would ping the user once per reply (and double-notify on exit,
      // where finalizeAgentStatus already emits agent:finished).
      return { status: "waiting_input", turnEnded: now };
    case "idle":
      // Spawn and resume set running, and an interrupted turn sends no Stop: without this the
      // session stays running at its prompt. No turn ended, so no snapshot and no link
      return { status: "waiting_input", idleOnly: true };
    case "exited":
      return {};
    default:
      return {};
  }
}

// ─── Claude Code hook injection (T123) ───────────────────────────────────

/** Shell command a Claude Code hook runs to emit an OSC-777 notify signal.
 *  Written to /dev/tty, NOT stdout: Claude Code captures hook stdout (it only
 *  surfaces it in transcript mode), so bytes on stdout never reach the PTY
 *  stream our FSM scans. /dev/tty is the controlling terminal = our PTY.
 *  Falls back to stdout for environments without a controlling tty, except
 *  where Claude adds hook stdout to the model context (SessionStart). */
function oscNotifyCommand(agentId: string, event: AgentSignalType, stdoutFallback = true): string {
  const seq = `\\033]777;notify;Exegol;${agentId};${event}\\007`;
  const tty = `printf '${seq}' > /dev/tty 2>/dev/null`;
  return stdoutFallback ? `${tty} || printf '${seq}'` : `${tty} || true`;
}

/**
 * Write a per-agent Claude Code hooks settings file that emits OSC-777 notify
 * signals on Stop/Notification/PreToolUse/SessionStart so the PTY stream carries
 * deterministic lifecycle events instead of relying on scraped output, plus the
 * notify.sh file events (NotifyHandler) the global settings.json used to send.
 * Returns the settings file path, or null if it couldn't be written
 * (non-fatal — the scraping parser remains the fallback).
 */
export function buildClaudeCodeHooksFile(
  agentId: string,
  opts: { enforceClaims?: boolean; platform?: NodeJS.Platform } = {},
): string | null {
  try {
    mkdirSync(HOOKS_DIR, { recursive: true });
    const path = join(HOOKS_DIR, `${agentId}.json`);
    // Claude Code runs hooks in Git Bash on Windows, which has no /dev/tty into our ConPTY:
    // there the file events alone carry the status
    const osc = (opts.platform ?? process.platform) !== "win32";
    // The file event rides along: it carries Claude's session id (OSC has none) and was the
    // global settings.json's job, which now skips sessions that have this file
    const fileEvent = (event: NotifyEvent) => ({
      type: "command",
      command: notifyCommand(event, "agent"),
    });
    const hookEntry = (event: AgentSignalType, stdoutFallback = true, file?: NotifyEvent) => ({
      hooks: [
        ...(osc
          ? [{ type: "command", command: oscNotifyCommand(agentId, event, stdoutFallback) }]
          : []),
        ...(file ? [fileEvent(file)] : []),
      ],
    });
    // T175: the claim guard runs on write-shaped tools only, and BEFORE the
    // write — the one moment where "which agent touched this" is still known.
    // It fails open, so a missing socket or token costs the check, not the turn.
    // Skipped for an isolated worktree: separate trees genuinely cannot
    // collide (claims are absolute paths), so every check there is pure cost.
    const guardPath = opts.enforceClaims === false ? null : resolveClaimGuardPath();
    const settings = {
      hooks: {
        PreToolUse: [
          // OSC only: PostToolUse's tool_use file event reports working
          ...(osc ? [hookEntry("working")] : []),
          ...(guardPath
            ? [
                {
                  // Anchored: an unanchored alternation also matches any MCP
                  // tool whose name merely CONTAINS "Write", paying a process
                  // spawn to find no file path and allow.
                  matcher: "^(Edit|Write|MultiEdit|NotebookEdit)$",
                  hooks: [
                    {
                      type: "command",
                      command: nodeShellCommand(gitBashLaunch(nodeLaunch(guardPath))),
                      timeout: 5,
                    },
                  ],
                },
              ]
            : []),
        ],
        Notification: [
          {
            matcher: CLAUDE_ATTENTION_NOTIFICATIONS,
            ...hookEntry("attention", true, "permission_needed"),
          },
          { matcher: CLAUDE_IDLE_NOTIFICATIONS, ...hookEntry("idle", true, "session_ready") },
        ],
        SessionStart: [
          { matcher: CLAUDE_SESSION_READY_SOURCES, ...hookEntry("idle", false, "session_ready") },
        ],
        Stop: [hookEntry("finished", true, "stop")],
        PostToolUse: [{ matcher: "*", hooks: [fileEvent("tool_use")] }],
        UserPromptSubmit: [{ hooks: [fileEvent("prompt_submit")] }],
      },
    };
    writeFileSync(path, JSON.stringify(settings, null, 2), "utf-8");
    return path;
  } catch (err) {
    logger.warn(`[AgentManager] Failed to write hooks settings file for ${agentId}:`, err);
    return null;
  }
}

// ─── Rust native module (git2 worktree ops) ──────────────────────────────
//
// Resolution order:
// 1. Normal require (dev mode + any classic node_modules install).
// 2. `process.resourcesPath/core-rust` — packaged app via electron-builder's
//    extraResources. This is where we land in production because
//    @exegol/core-rust is a bun workspace symlink that lives at the repo
//    root's node_modules and electron-builder doesn't resolve it through
//    the usual apps/desktop node_modules collection.

export let coreRust: typeof import("@exegol/core-rust") | null = null;
try {
  coreRust = require("@exegol/core-rust");
} catch {
  try {
    const electron = require("electron") as { app?: { isPackaged?: boolean } } | undefined;
    if (electron?.app?.isPackaged && process.resourcesPath) {
      const path = require("node:path") as typeof import("node:path");
      const fallbackPath = path.join(process.resourcesPath, "core-rust");
      coreRust = require(fallbackPath);
      logger.info("[AgentManager] Loaded @exegol/core-rust from resourcesPath fallback");
    } else {
      throw new Error("not packaged, no fallback");
    }
  } catch (err) {
    logger.warn(
      `[AgentManager] @exegol/core-rust native module not available — worktrees + Rust git/diff disabled: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ─── PTY constants ──────────────────────────────────────────────────────

export const DEFAULT_PTY_COLS = 120;
export const DEFAULT_PTY_ROWS = 30;

// ─── Worktree helpers ───────────────────────────────────────────────────

export function slugifyBranchName(description: string): string {
  return `exegol/${description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50)
    .replace(/-$/, "")}`;
}

// ─── API key injection ──────────────────────────────────────────────────

const API_KEY_MAPPINGS = [
  { provider: "anthropic", envVar: "ANTHROPIC_API_KEY" },
  { provider: "openai", envVar: "OPENAI_API_KEY" },
  { provider: "google", envVar: "GOOGLE_API_KEY" },
] as const;

/**
 * Build an env-var map of API keys from the keystore.
 */
export function buildApiKeyEnv(db: Database.Database): Record<string, string> {
  const apiKeyEnv: Record<string, string> = {};
  for (const { provider, envVar } of API_KEY_MAPPINGS) {
    const key = getApiKey(db, provider);
    if (key) {
      apiKeyEnv[envVar] = key;
    }
  }
  return apiKeyEnv;
}

// ─── Agent exit helpers ─────────────────────────────────────────────────

function endEvent(agent: AgentContext, status: AgentStatus): AgentStatusEvent {
  return {
    agentId: agent.id,
    projectId: agent.projectId,
    status,
    currentStep: null,
    cliType: agent.cliType,
    timestamp: Date.now(),
  };
}

/**
 * Finalize agent status on process exit: update DB, broadcast, log activity.
 * Returns the final status string, or null if the agent was already terminal.
 */
export function finalizeAgentStatus(
  db: Database.Database,
  agent: AgentContext,
  exitCode: number,
  stoppedByUser = false,
): AgentStatus | null {
  try {
    const currentAgent = getAgent(db, agent.id);
    if (!currentAgent || currentAgent.status === "completed" || currentAgent.status === "failed") {
      logger.info(
        `[Finalize] Skip ${agent.id} (${agent.cliType}) — already ${currentAgent?.status ?? "deleted"}`,
      );
      // Row deleted while live (backstop: agents.delete broadcasts too)
      if (!currentAgent) broadcastAgentStatus(endEvent(agent, "stopped"));
      return null;
    }

    const finalStatus: "completed" | "failed" | "stopped" = stoppedByUser
      ? "stopped"
      : exitCode === 0
        ? "completed"
        : "failed";
    logger.info(`[Finalize] ${agent.id} (${agent.cliType}) → ${finalStatus} (exit=${exitCode})`);
    stopAgent(db, agent.id, finalStatus);
    broadcastAgentStatus(endEvent(agent, finalStatus));
    // The user just pressed Stop: no desktop notification about it
    if (agent.cliType !== "shell" && !stoppedByUser && !isAgentQuiet(db, agent.id)) {
      getNotificationBus().emit({
        type: finalStatus === "completed" ? "agent:finished" : "agent:failed",
        title: `Agent ${finalStatus}`,
        body: (agent.taskDescription ?? "").slice(0, 100),
        agentId: agent.id,
        projectId: agent.projectId,
        at: Date.now(),
      });
    }

    const actType = `agent_${finalStatus}` as const;
    try {
      insertActivity(db, {
        type: actType,
        entityType: "agent",
        entityId: agent.id,
        projectId: agent.projectId,
        description: `${agent.cliType} agent ${finalStatus}: ${(agent.taskDescription ?? "").slice(0, 80)}`,
      });
    } catch (err) {
      logger.warn("[AgentManager] Failed to log activity:", err);
    }

    return finalStatus;
  } catch (err) {
    // DB may be closed during app shutdown — non-fatal
    logger.warn("[AgentManager] finalizeAgentStatus skipped (DB likely closed):", err);
    return null;
  }
}

/**
 * Score agent quality and record oplog commits (non-fatal).
 */
export function scoreAndRecordOplog(
  db: Database.Database,
  agent: AgentContext,
  exitCode: number,
  scrollback: string,
  initSnapshot: { headSha: string; cwd: string; projectId: string } | undefined,
): void {
  try {
    // Skip scoring if agent was already deleted (race condition with renderer delete)
    const currentAgentForScoring = getAgent(db, agent.id);
    if (!currentAgentForScoring) return;
    scoreAgent(db, agent.id, exitCode, currentAgentForScoring.status ?? "unknown", scrollback);

    if (initSnapshot && coreRust) {
      const afterSnapshot = coreRust.getRepoSnapshot(initSnapshot.cwd);
      if (afterSnapshot.headSha !== initSnapshot.headSha) {
        createOplogEntry(db, {
          agentId: agent.id,
          projectId: initSnapshot.projectId,
          operation: "commit",
          refBefore: initSnapshot.headSha,
          refAfter: afterSnapshot.headSha,
          description: `Agent made commits (${initSnapshot.headSha.slice(0, 8)} → ${afterSnapshot.headSha.slice(0, 8)})`,
        });
      }
    }
  } catch {
    // Non-fatal: DB may be closed during shutdown, oplog/scoring are best-effort
  }
}
