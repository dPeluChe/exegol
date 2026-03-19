import { execSync } from "node:child_process";
import type { Agent, AgentStatus } from "@exegol/shared";
import { BrowserWindow } from "electron";
import type Database from "libsql";
import { createOplogEntry, getAgent, insertActivity, stopAgent } from "../db/queries";
import { logger } from "../lib/logger";
import { getApiKey } from "../security/keystore";
import { scoreAgent } from "./scoring";

// ─── Push event types ────────────────────────────────────────────────────

export interface AgentStatusEvent {
  agentId: string;
  projectId: string;
  status: AgentStatus;
  currentStep: string | null;
  cliType: string;
  timestamp: number;
}

/** Broadcast an agent status event to all renderer windows */
export function broadcastAgentStatus(event: AgentStatusEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("agent:status-changed", event);
  }
}

// ─── Rust native module (git2 worktree ops) ──────────────────────────────

export let coreRust: typeof import("@exegol/core-rust") | null = null;
try {
  coreRust = require("@exegol/core-rust");
} catch {
  logger.warn("[AgentManager] @exegol/core-rust native module not available — worktrees disabled");
}

// ─── Scrollback / PTY constants ─────────────────────────────────────────

export const MAX_SCROLLBACK_BYTES = 1024 * 1024; // 1MB per agent
export const SCROLLBACK_FLUSH_INTERVAL_MS = 30_000; // 30s periodic flush
export const SHELL_PATH_TIMEOUT_MS = 5_000;
export const DEFAULT_PTY_COLS = 120;
export const DEFAULT_PTY_ROWS = 30;
export const STOP_POLL_INTERVAL_MS = 100;
export const STOP_TIMEOUT_MS = 5_000;

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
  agent: Agent,
  exitCode: number,
): AgentStatus | null {
  try {
    const currentAgent = getAgent(db, agent.id);
    if (!currentAgent || currentAgent.status === "completed" || currentAgent.status === "failed") {
      return null;
    }

    const finalStatus: AgentStatus = exitCode === 0 ? "completed" : "failed";
    stopAgent(db, agent.id, finalStatus);
    broadcastAgentStatus({
      agentId: agent.id,
      projectId: agent.projectId,
      status: finalStatus,
      currentStep: null,
      cliType: agent.cliType,
      timestamp: Date.now(),
    });

    const actType = finalStatus === "completed" ? "agent_completed" : "agent_failed";
    try {
      insertActivity(db, {
        type: actType as "agent_completed" | "agent_failed",
        entityType: "agent",
        entityId: agent.id,
        projectId: agent.projectId,
        description: `${agent.cliType} agent ${finalStatus}: ${agent.taskDescription.slice(0, 80)}`,
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
  agent: Agent,
  exitCode: number,
  scrollback: string,
  initSnapshot: { headSha: string; cwd: string; projectId: string } | undefined,
): void {
  try {
    const currentAgentForScoring = getAgent(db, agent.id);
    scoreAgent(db, agent.id, exitCode, currentAgentForScoring?.status ?? "unknown", scrollback);

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
