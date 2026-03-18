import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Agent, AgentCreate, AgentStatus } from "@exegol/shared";
import { BrowserWindow } from "electron";
import type Database from "libsql";
import type { IPty } from "node-pty";
import * as pty from "node-pty";
import {
  createOplogEntry,
  createWorktree as dbCreateWorktree,
  removeWorktree as dbRemoveWorktree,
  getAgent,
  insertActivity,
  setAgentPid,
  setAgentWorktree,
  stopAgent,
  updateAgentStatus,
} from "../db/queries";
import { getScrollbackPath } from "../ipc/procedures/scrollback";
import { logger } from "../lib/logger";
import { getMcpHost } from "../mcp/host";
import { extractAndStoreMemories } from "../memory/extractor";
import { buildMemoryContext, getMemoriesForInjection } from "../memory/store";
import { getApiKey } from "../security/keystore";
import { discoverSkills } from "../skills/discovery";
import { createHandoff, generateHandoffFromScrollback } from "./handoff";
import { getProviderRegistry } from "./registry";
import { scoreAgent } from "./scoring";
import { AgentStatusParser } from "./status-parser";

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
function broadcastAgentStatus(event: AgentStatusEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("agent:status-changed", event);
  }
}

// ─── Rust native module (git2 worktree ops) ──────────────────────────────

let coreRust: typeof import("@exegol/core-rust") | null = null;
try {
  coreRust = require("@exegol/core-rust");
} catch {
  logger.warn("[AgentManager] @exegol/core-rust native module not available — worktrees disabled");
}

// ─── Scrollback constants ────────────────────────────────────────────────

const MAX_SCROLLBACK_BYTES = 1024 * 1024; // 1MB per agent
const SCROLLBACK_FLUSH_INTERVAL_MS = 30_000; // 30s periodic flush
const SHELL_PATH_TIMEOUT_MS = 5_000;
const DEFAULT_PTY_COLS = 120;
const DEFAULT_PTY_ROWS = 30;
const STOP_POLL_INTERVAL_MS = 100;
const STOP_TIMEOUT_MS = 5_000;

// ─── Shell PATH resolution ────────────────────────────────────────────────

/**
 * Get the full user shell PATH. Electron doesn't inherit the full PATH
 * from the user's shell on macOS/Linux.
 */
function getShellPath(): string {
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
function _getFullPath(): string {
  if (!resolvedPath) {
    resolvedPath = getShellPath();
  }
  return resolvedPath;
}

// ─── Worktree helpers ─────────────────────────────────────────────────────

function slugifyBranchName(description: string): string {
  return `exegol/${description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50)
    .replace(/-$/, "")}`;
}

// ─── AgentManager Singleton ───────────────────────────────────────────────

let instance: AgentManager | null = null;

export function getAgentManager(): AgentManager {
  if (!instance) {
    instance = new AgentManager();
  }
  return instance;
}

interface WorktreeRecord {
  dbId: string;
  worktreeName: string;
  worktreePath: string;
  repoPath: string;
}

export class AgentManager {
  private processes: Map<string, IPty> = new Map();
  private statusParsers: Map<string, AgentStatusParser> = new Map();
  private worktrees: Map<string, WorktreeRecord> = new Map();
  private scrollbackBuffers: Map<string, string[]> = new Map();
  private scrollbackSizes: Map<string, number> = new Map();
  private scrollbackTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private completionCallbacks: Map<string, (exitCode: number) => void> = new Map();
  /** Track initial HEAD SHA per agent for oplog commit detection */
  private initialSnapshots: Map<string, { headSha: string; cwd: string; projectId: string }> =
    new Map();
  private tokenLimitDetected: Set<string> = new Set();

  /**
   * Spawn an agent process with the configured CLI tool.
   */
  async spawn(db: Database.Database, agent: Agent, config: AgentCreate): Promise<void> {
    const registry = getProviderRegistry();
    const cliConfig = registry.resolveCliConfig(agent.cliType);
    if (!cliConfig) {
      throw new Error(`No CLI configuration found for agent type: ${agent.cliType}`);
    }

    // Resolve the project path for the working directory
    const project = db.prepare("SELECT path FROM projects WHERE id = ?").get(agent.projectId) as
      | { path: string }
      | undefined;

    if (!project) {
      throw new Error(`Project ${agent.projectId} not found`);
    }

    let cwd = project.path;

    // ── Worktree creation ──────────────────────────────────────────────
    if (config.useWorktree && coreRust) {
      const branchName = config.branchName?.trim() || slugifyBranchName(agent.taskDescription);
      // Use branch name without prefix as worktree directory name
      const worktreeName = branchName.replace(/\//g, "-");

      try {
        const wtInfo = coreRust.createWorktree(project.path, worktreeName, branchName);
        cwd = wtInfo.path;

        // Record in DB
        const dbWt = dbCreateWorktree(db, {
          projectId: agent.projectId,
          agentId: agent.id,
          path: wtInfo.path,
          branchName,
          autoCleanup: true,
        });
        setAgentWorktree(db, agent.id, dbWt.id);

        this.worktrees.set(agent.id, {
          dbId: dbWt.id,
          worktreeName,
          worktreePath: wtInfo.path,
          repoPath: project.path,
        });

        // Record in oplog
        try {
          const snapshot = coreRust.getRepoSnapshot(project.path);
          createOplogEntry(db, {
            agentId: agent.id,
            projectId: agent.projectId,
            operation: "worktree_create",
            refBefore: snapshot.headSha,
            refAfter: snapshot.headSha,
            description: `Created worktree '${worktreeName}' on branch '${branchName}'`,
          });
        } catch {
          // Non-fatal oplog recording
        }

        logger.info("[AgentManager] Created worktree:", {
          branch: branchName,
          path: wtInfo.path,
        });
      } catch (err) {
        logger.error(
          "[AgentManager] Failed to create worktree, falling back to project root:",
          err,
        );
        // Continue without worktree — don't fail the spawn
      }
    }

    // ── Memory context injection ─────────────────────────────────────────
    const relevantMemories = getMemoriesForInjection(db, agent.projectId);
    const memoryContext = buildMemoryContext(relevantMemories);

    // ── MCP tool context injection ──────────────────────────────────────
    const mcpContext = getMcpHost().buildToolContext();

    // ── Skill context injection ───────────────────────────────────────────
    let skillContext = "";
    if (config.skillNames && config.skillNames.length > 0) {
      const allSkills = discoverSkills(cwd);
      const selectedSkills = allSkills.filter(
        (s) => config.skillNames?.includes(s.name) && s.available,
      );
      if (selectedSkills.length > 0) {
        const sections = selectedSkills.map(
          (s) => `## ${s.name}${s.role ? ` — ${s.role}` : ""}\n\n${s.content}`,
        );
        skillContext = `# Active Skills\n\n${sections.join("\n\n---\n\n")}\n\n---\n\n`;
        logger.info(
          "[AgentManager] Injecting skills:",
          selectedSkills.map((s) => s.name),
        );
      }
    }

    // Build the full command string to run through the user's shell
    const cmdParts = [cliConfig.command, ...cliConfig.args];
    // Only pass task description as argument if it looks like an actual task
    // (not just the CLI name used as a label for quick-launch)
    const isQuickLaunch = registry.isQuickLaunchLabel(agent.taskDescription);
    if (agent.taskDescription && !isQuickLaunch) {
      // Prepend memory + MCP + skill context to the task description
      const contextPrefix = [memoryContext, mcpContext, skillContext].filter(Boolean).join("\n");
      const fullPrompt = contextPrefix
        ? `${contextPrefix}# Task\n\n${agent.taskDescription}`
        : agent.taskDescription;
      // Shell-escape the full prompt
      const escaped = fullPrompt.replace(/'/g, "'\\''");
      cmdParts.push(`'${escaped}'`);
    } else {
      // Quick-launch with context: inject memory/MCP/skill context if available
      const contextPrefix = [memoryContext, mcpContext, skillContext].filter(Boolean).join("\n");
      if (contextPrefix) {
        const escaped = contextPrefix.replace(/'/g, "'\\''");
        cmdParts.push(`'${escaped}'`);
      }
    }
    const fullCommand = cmdParts.join(" ");

    // Inject API keys from keystore as environment variables
    const apiKeyEnv: Record<string, string> = {};
    const keyMappings = [
      { provider: "anthropic", envVar: "ANTHROPIC_API_KEY" },
      { provider: "openai", envVar: "OPENAI_API_KEY" },
      { provider: "google", envVar: "GOOGLE_API_KEY" },
    ];
    for (const { provider, envVar } of keyMappings) {
      const key = getApiKey(db, provider);
      if (key) {
        apiKeyEnv[envVar] = key;
      }
    }

    // Capture initial HEAD snapshot for oplog
    if (coreRust) {
      try {
        const snapshot = coreRust.getRepoSnapshot(cwd);
        this.initialSnapshots.set(agent.id, {
          headSha: snapshot.headSha,
          cwd,
          projectId: agent.projectId,
        });
      } catch {
        // Non-fatal
      }
    }

    // Spawn through the user's login shell so PATH, nvm, etc. are resolved
    const userShell = process.env.SHELL || "/bin/zsh";
    logger.info("[AgentManager] Spawning:", {
      userShell,
      fullCommand,
      cwd,
      shellExists: require("node:fs").existsSync(userShell),
    });
    const proc = pty.spawn(userShell, ["-ilc", fullCommand], {
      name: "xterm-256color",
      cols: DEFAULT_PTY_COLS,
      rows: DEFAULT_PTY_ROWS,
      cwd,
      env: {
        ...process.env,
        ...apiKeyEnv,
        ...cliConfig.env,
        TERM: "xterm-256color",
      } as Record<string, string>,
    });

    this.processes.set(agent.id, proc);

    // Update DB with PID and running status
    setAgentPid(db, agent.id, proc.pid);
    updateAgentStatus(db, agent.id, "running");

    // Push status event to renderer
    broadcastAgentStatus({
      agentId: agent.id,
      projectId: agent.projectId,
      status: "running",
      currentStep: null,
      cliType: agent.cliType,
      timestamp: Date.now(),
    });

    // T20: Log activity
    try {
      insertActivity(db, {
        type: "agent_spawned",
        entityType: "agent",
        entityId: agent.id,
        projectId: agent.projectId,
        description: `${agent.cliType} agent spawned: ${agent.taskDescription.slice(0, 80)}`,
      });
    } catch (err) {
      logger.warn("[AgentManager] Failed to log activity:", err);
    }

    // Create status parser
    const parser = new AgentStatusParser(agent.id, agent.cliType);
    this.statusParsers.set(agent.id, parser);

    // Initialize scrollback buffer + periodic flush timer
    this.scrollbackBuffers.set(agent.id, []);
    this.scrollbackSizes.set(agent.id, 0);
    const flushTimer = setInterval(() => {
      this.flushScrollback(agent.id, true);
    }, SCROLLBACK_FLUSH_INTERVAL_MS);
    this.scrollbackTimers.set(agent.id, flushTimer);

    // Listen to stdout for status updates and forward to renderer
    proc.onData((data: string) => {
      // Forward terminal data to all renderer windows
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        win.webContents.send("terminal:data", agent.id, data);
      }

      // Capture scrollback
      const currentSize = this.scrollbackSizes.get(agent.id) ?? 0;
      if (currentSize < MAX_SCROLLBACK_BYTES) {
        const buffer = this.scrollbackBuffers.get(agent.id);
        buffer?.push(data);
        this.scrollbackSizes.set(agent.id, currentSize + data.length);
      }

      // Parse for status updates
      const statusUpdate = parser.parse(data);
      if (statusUpdate) {
        if (statusUpdate.status) {
          updateAgentStatus(db, agent.id, statusUpdate.status, statusUpdate.currentStep);
          broadcastAgentStatus({
            agentId: agent.id,
            projectId: agent.projectId,
            status: statusUpdate.status as AgentStatus,
            currentStep: statusUpdate.currentStep ?? null,
            cliType: agent.cliType,
            timestamp: Date.now(),
          });
        } else if (statusUpdate.currentStep) {
          updateAgentStatus(db, agent.id, "running", statusUpdate.currentStep);
          broadcastAgentStatus({
            agentId: agent.id,
            projectId: agent.projectId,
            status: "running",
            currentStep: statusUpdate.currentStep,
            cliType: agent.cliType,
            timestamp: Date.now(),
          });
        }

        // Detect token limit warning — generate handoff and notify renderer
        if (statusUpdate.tokenLimitWarning && !this.tokenLimitDetected.has(agent.id)) {
          this.tokenLimitDetected.add(agent.id);
          try {
            const scrollback = this.scrollbackBuffers.get(agent.id)?.join("") ?? "";
            const summary = generateHandoffFromScrollback(agent.taskDescription, scrollback);
            const handoff = createHandoff(db, { agentId: agent.id, ...summary });
            // Notify renderer of handoff availability
            for (const win of BrowserWindow.getAllWindows()) {
              win.webContents.send("agent:handoff-ready", agent.id, handoff.id);
            }
            logger.info(
              `[AgentManager] Token limit detected for ${agent.id}, handoff created: ${handoff.id}`,
            );
          } catch (err) {
            logger.error(`[AgentManager] Failed to create handoff for ${agent.id}:`, err);
          }
        }
      }
    });

    // Handle process exit
    proc.onExit(({ exitCode }) => {
      // Stop periodic flush timer
      const timer = this.scrollbackTimers.get(agent.id);
      if (timer) {
        clearInterval(timer);
        this.scrollbackTimers.delete(agent.id);
      }

      // Capture scrollback for scoring BEFORE flush deletes the buffer
      const scrollbackForScoring = this.scrollbackBuffers.get(agent.id)?.join("") ?? "";

      // ── Memory extraction on completion (before flush clears buffer) ──
      const scrollbackForMemory = this.scrollbackBuffers.get(agent.id)?.join("") ?? "";
      if (scrollbackForMemory.length > 0) {
        extractAndStoreMemories(db, agent.id, agent.projectId, scrollbackForMemory);
      }

      // Final flush scrollback to disk
      this.flushScrollback(agent.id, false);

      this.processes.delete(agent.id);
      this.statusParsers.delete(agent.id);
      this.tokenLimitDetected.delete(agent.id);

      const currentAgent = getAgent(db, agent.id);
      if (currentAgent && currentAgent.status !== "completed" && currentAgent.status !== "failed") {
        const finalStatus = exitCode === 0 ? "completed" : "failed";
        stopAgent(db, agent.id, finalStatus);
        broadcastAgentStatus({
          agentId: agent.id,
          projectId: agent.projectId,
          status: finalStatus,
          currentStep: null,
          cliType: agent.cliType,
          timestamp: Date.now(),
        });

        // T20: Log activity
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
      }

      // ── Quality scoring (non-fatal) ──────────────────────────────────
      const currentAgentForScoring = getAgent(db, agent.id);
      scoreAgent(
        db,
        agent.id,
        exitCode,
        currentAgentForScoring?.status ?? "unknown",
        scrollbackForScoring,
      );

      // ── Oplog: detect commits made by the agent ─────────────────────
      const initSnapshot = this.initialSnapshots.get(agent.id);
      if (initSnapshot && coreRust) {
        try {
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
        } catch {
          // Non-fatal oplog recording
        }
        this.initialSnapshots.delete(agent.id);
      }

      // ── Worktree cleanup on exit ──────────────────────────────────────
      this.cleanupWorktree(db, agent.id);

      // ── Fire completion callback if registered ─────────────────────────
      const completionCb = this.completionCallbacks.get(agent.id);
      if (completionCb) {
        this.completionCallbacks.delete(agent.id);
        completionCb(exitCode);
      }
    });
  }

  /**
   * Stop a running agent process gracefully.
   */
  async stop(db: Database.Database, agentId: string): Promise<void> {
    const proc = this.processes.get(agentId);

    if (proc) {
      // Send SIGTERM first for graceful shutdown
      proc.kill();

      // Wait up to 5 seconds for the process to exit, then force kill.
      // The existing onExit listener from spawn() handles cleanup.
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.processes.has(agentId)) {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            resolve();
          }
        }, STOP_POLL_INTERVAL_MS);

        const timeout = setTimeout(() => {
          clearInterval(checkInterval);
          // Force kill if still running
          try {
            process.kill(proc.pid, "SIGKILL");
          } catch {
            // Process already exited
          }
          resolve();
        }, STOP_TIMEOUT_MS);
      });
    } else {
      // No process found but ensure DB is updated
      stopAgent(db, agentId, "completed");

      // T20: Log activity for manual stop
      try {
        const stoppedAgent = getAgent(db, agentId);
        if (stoppedAgent) {
          insertActivity(db, {
            type: "agent_stopped",
            entityType: "agent",
            entityId: agentId,
            projectId: stoppedAgent.projectId,
            description: `${stoppedAgent.cliType} agent stopped manually`,
          });
        }
      } catch (err) {
        logger.warn("[AgentManager] Failed to log activity:", err);
      }
    }
  }

  /**
   * Get the PTY process for an agent (for terminal forwarding).
   */
  getProcess(agentId: string): IPty | undefined {
    return this.processes.get(agentId);
  }

  /**
   * List all currently running agent IDs.
   */
  listRunning(): string[] {
    return Array.from(this.processes.keys());
  }

  /**
   * Write data to an agent's terminal.
   */
  write(agentId: string, data: string): void {
    const proc = this.processes.get(agentId);
    if (proc) {
      proc.write(data);
    }
  }

  /**
   * Resize an agent's terminal.
   */
  resize(agentId: string, cols: number, rows: number): void {
    const proc = this.processes.get(agentId);
    if (proc) {
      proc.resize(cols, rows);
    }
  }

  /**
   * Register a one-shot callback that fires when an agent process exits.
   */
  onAgentComplete(agentId: string, callback: (exitCode: number) => void): void {
    this.completionCallbacks.set(agentId, callback);
  }

  /**
   * Flush in-memory scrollback buffer to disk for an agent.
   * @param keepBuffer - if true, keeps buffer in memory (periodic flush); if false, cleans up (final flush)
   */
  private flushScrollback(agentId: string, keepBuffer: boolean): void {
    const buffer = this.scrollbackBuffers.get(agentId);
    if (!buffer || buffer.length === 0) return;

    try {
      const filePath = getScrollbackPath(agentId);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, buffer.join(""), "utf-8");
    } catch (err) {
      logger.error(`[AgentManager] Failed to write scrollback for ${agentId}:`, err);
    }

    if (!keepBuffer) {
      this.scrollbackBuffers.delete(agentId);
      this.scrollbackSizes.delete(agentId);
    }
  }

  /**
   * Clean up a worktree after an agent exits.
   * If no changes, remove worktree + branch. If changes exist, keep it.
   */
  private cleanupWorktree(db: Database.Database, agentId: string): void {
    const wt = this.worktrees.get(agentId);
    if (!wt || !coreRust) return;

    try {
      const hasChanges = coreRust.worktreeHasChanges(wt.worktreePath);
      if (hasChanges) {
        logger.info(
          `[AgentManager] Worktree '${wt.worktreeName}' has changes — keeping at ${wt.worktreePath}`,
        );
      } else {
        coreRust.removeWorktree(wt.repoPath, wt.worktreeName, false);
        dbRemoveWorktree(db, wt.dbId);
        logger.info(`[AgentManager] Cleaned up empty worktree '${wt.worktreeName}'`);
      }
    } catch (err) {
      logger.error(`[AgentManager] Failed to clean up worktree '${wt.worktreeName}':`, err);
    }

    this.worktrees.delete(agentId);
  }
}
