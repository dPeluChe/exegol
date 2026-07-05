import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentCliType, AgentSignalType, AgentStatus } from "@exegol/shared";
import type Database from "libsql";
import { createOplogEntry, getAgent, insertActivity, stopAgent } from "../db/queries";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { getNotificationBus } from "../notifications/bus";
import { getApiKey } from "../security/keystore";
import { refreshTray } from "../system/tray";
import { scoreAgent } from "./scoring";

export interface AgentContext {
  id: string;
  cliType: AgentCliType;
  projectId: string;
  taskDescription: string;
}

// ─── Push event types ────────────────────────────────────────────────────

export interface AgentStatusEvent {
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
  /** Pending question text extracted from an `attention` signal's detail, if any. */
  attentionDetail?: string;
}

/** Broadcast an agent status event to all renderer windows + refresh tray badge */
export function broadcastAgentStatus(event: AgentStatusEvent): void {
  broadcast("agent:status-changed", event);
  refreshTray();
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
    case "exited":
      return {};
    default:
      return {};
  }
}

// ─── Claude Code hook injection (T123) ───────────────────────────────────

const HOOKS_DIR = join(homedir(), ".exegol", "hooks");

/** Shell command a Claude Code hook runs to emit an OSC-777 notify signal.
 *  Written to /dev/tty, NOT stdout: Claude Code captures hook stdout (it only
 *  surfaces it in transcript mode), so bytes on stdout never reach the PTY
 *  stream our FSM scans. /dev/tty is the controlling terminal = our PTY.
 *  Falls back to stdout for environments without a controlling tty. */
function oscNotifyCommand(agentId: string, event: AgentSignalType): string {
  const seq = `\\033]777;notify;Exegol;${agentId};${event}\\007`;
  return `printf '${seq}' > /dev/tty 2>/dev/null || printf '${seq}'`;
}

/**
 * Write a per-agent Claude Code hooks settings file that emits OSC-777 notify
 * signals on Stop/Notification/PreToolUse so the PTY stream carries
 * deterministic lifecycle events instead of relying on scraped output.
 * Returns the settings file path, or null if it couldn't be written
 * (non-fatal — the scraping parser remains the fallback).
 */
export function buildClaudeCodeHooksFile(agentId: string): string | null {
  try {
    mkdirSync(HOOKS_DIR, { recursive: true });
    const path = join(HOOKS_DIR, `${agentId}.json`);
    const hookEntry = (event: AgentSignalType) => ({
      hooks: [{ type: "command", command: oscNotifyCommand(agentId, event) }],
    });
    const settings = {
      hooks: {
        PreToolUse: [hookEntry("working")],
        Notification: [hookEntry("attention")],
        Stop: [hookEntry("finished")],
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

export const SHELL_PATH_TIMEOUT_MS = 5_000;
export const DEFAULT_PTY_COLS = 120;
export const DEFAULT_PTY_ROWS = 30;

// ─── Shell PATH resolution ──────────────────────────────────────────────

/**
 * Get the full user shell PATH. Electron doesn't inherit the full PATH
 * from the user's shell on macOS/Linux.
 */
export function getShellPath(): string {
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const result = execSync(`${shell} -ilc 'echo $PATH'`, {
      encoding: "utf-8",
      timeout: SHELL_PATH_TIMEOUT_MS,
    }).trim();
    return result || process.env.PATH || "";
  } catch {
    return process.env.PATH || "";
  }
}

let resolvedPath: string | null = null;
export function _getFullPath(): string {
  if (!resolvedPath) {
    resolvedPath = getShellPath();
  }
  return resolvedPath;
}

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

/**
 * Finalize agent status on process exit: update DB, broadcast, log activity.
 * Returns the final status string, or null if the agent was already terminal.
 */
export function finalizeAgentStatus(
  db: Database.Database,
  agent: AgentContext,
  exitCode: number,
): AgentStatus | null {
  try {
    const currentAgent = getAgent(db, agent.id);
    if (!currentAgent || currentAgent.status === "completed" || currentAgent.status === "failed") {
      logger.info(
        `[Finalize] Skip ${agent.id} (${agent.cliType}) — already ${currentAgent?.status ?? "deleted"}`,
      );
      return null;
    }

    const finalStatus: AgentStatus = exitCode === 0 ? "completed" : "failed";
    logger.info(`[Finalize] ${agent.id} (${agent.cliType}) → ${finalStatus} (exit=${exitCode})`);
    stopAgent(db, agent.id, finalStatus);
    const statusEvent: AgentStatusEvent = {
      agentId: agent.id,
      projectId: agent.projectId,
      status: finalStatus,
      currentStep: null,
      cliType: agent.cliType,
      timestamp: Date.now(),
    };
    broadcastAgentStatus(statusEvent);
    if (agent.cliType !== "shell") {
      getNotificationBus().emit({
        type: finalStatus === "completed" ? "agent:finished" : "agent:failed",
        title: `Agent ${finalStatus}`,
        body: (agent.taskDescription ?? "").slice(0, 100),
        agentId: agent.id,
        projectId: agent.projectId,
        at: Date.now(),
      });
    }

    const actType = finalStatus === "completed" ? "agent_completed" : "agent_failed";
    try {
      insertActivity(db, {
        type: actType as "agent_completed" | "agent_failed",
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
