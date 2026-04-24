import { execSync } from "node:child_process";
import type { AgentCliType, AgentStatus } from "@exegol/shared";
import type Database from "libsql";
import { createOplogEntry, getAgent, insertActivity, stopAgent } from "../db/queries";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { getApiKey } from "../security/keystore";
import { showAgentNotification } from "../system/notifications";
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
}

/** Broadcast an agent status event to all renderer windows + refresh tray badge */
export function broadcastAgentStatus(event: AgentStatusEvent): void {
  broadcast("agent:status-changed", event);
  refreshTray();
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
    showAgentNotification(statusEvent, db);

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
