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
import { extractAndStoreMemories } from "../memory/extractor";
import { createHandoff, generateHandoffFromScrollback } from "./handoff";
import { getProviderRegistry } from "./registry";
import { buildShellCommand, buildSpawnContext } from "./spawn-context";
import {
  broadcastAgentStatus,
  buildApiKeyEnv,
  coreRust,
  DEFAULT_PTY_COLS,
  DEFAULT_PTY_ROWS,
  finalizeAgentStatus,
  MAX_SCROLLBACK_BYTES,
  SCROLLBACK_FLUSH_INTERVAL_MS,
  STOP_POLL_INTERVAL_MS,
  STOP_TIMEOUT_MS,
  scoreAndRecordOplog,
  slugifyBranchName,
} from "./spawn-env";
import { AgentStatusParser } from "./status-parser";

export type { AgentStatusEvent } from "./spawn-env";

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
  private initialSnapshots: Map<string, { headSha: string; cwd: string; projectId: string }> =
    new Map();
  private tokenLimitDetected: Set<string> = new Set();

  async spawn(db: Database.Database, agent: Agent, config: AgentCreate): Promise<void> {
    const registry = getProviderRegistry();
    const cliConfig = registry.resolveCliConfig(agent.cliType);
    if (!cliConfig) {
      throw new Error(`No CLI configuration found for agent type: ${agent.cliType}`);
    }

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
      const worktreeName = branchName.replace(/\//g, "-");

      try {
        const wtInfo = coreRust.createWorktree(project.path, worktreeName, branchName);
        cwd = wtInfo.path;

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
          /* Non-fatal oplog recording */
        }

        logger.info("[AgentManager] Created worktree:", { branch: branchName, path: wtInfo.path });
      } catch (err) {
        logger.error(
          "[AgentManager] Failed to create worktree, falling back to project root:",
          err,
        );
      }
    }

    // ── Build context + command + API keys ──────────────────────────────
    const { contextPrefix } = buildSpawnContext(db, agent.projectId, config, cwd);
    const fullCommand = buildShellCommand(registry, agent, cliConfig, contextPrefix);
    const apiKeyEnv = buildApiKeyEnv(db);

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
        /* Non-fatal */
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
      env: { ...process.env, ...apiKeyEnv, ...cliConfig.env, TERM: "xterm-256color" } as Record<
        string,
        string
      >,
    });

    this.processes.set(agent.id, proc);
    setAgentPid(db, agent.id, proc.pid);
    updateAgentStatus(db, agent.id, "running");
    broadcastAgentStatus({
      agentId: agent.id,
      projectId: agent.projectId,
      status: "running",
      currentStep: null,
      cliType: agent.cliType,
      timestamp: Date.now(),
    });

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

    const parser = new AgentStatusParser(agent.id, agent.cliType);
    this.statusParsers.set(agent.id, parser);
    this.scrollbackBuffers.set(agent.id, []);
    this.scrollbackSizes.set(agent.id, 0);
    this.scrollbackTimers.set(
      agent.id,
      setInterval(() => {
        this.flushScrollback(agent.id, true);
      }, SCROLLBACK_FLUSH_INTERVAL_MS),
    );

    // ── PTY data handler ──────────────────────────────────────────────
    proc.onData((data: string) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("terminal:data", agent.id, data);
      }

      const currentSize = this.scrollbackSizes.get(agent.id) ?? 0;
      if (currentSize < MAX_SCROLLBACK_BYTES) {
        this.scrollbackBuffers.get(agent.id)?.push(data);
        this.scrollbackSizes.set(agent.id, currentSize + data.length);
      }

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

        if (statusUpdate.tokenLimitWarning && !this.tokenLimitDetected.has(agent.id)) {
          this.tokenLimitDetected.add(agent.id);
          try {
            const scrollback = this.scrollbackBuffers.get(agent.id)?.join("") ?? "";
            const summary = generateHandoffFromScrollback(agent.taskDescription, scrollback);
            const handoff = createHandoff(db, { agentId: agent.id, ...summary });
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

    // ── PTY exit handler ──────────────────────────────────────────────
    proc.onExit(({ exitCode }) => {
      const timer = this.scrollbackTimers.get(agent.id);
      if (timer) {
        clearInterval(timer);
        this.scrollbackTimers.delete(agent.id);
      }

      const scrollbackForScoring = this.scrollbackBuffers.get(agent.id)?.join("") ?? "";

      const scrollbackForMemory = this.scrollbackBuffers.get(agent.id)?.join("") ?? "";
      if (scrollbackForMemory.length > 0) {
        extractAndStoreMemories(db, agent.id, agent.projectId, scrollbackForMemory);
      }

      this.flushScrollback(agent.id, false);
      this.processes.delete(agent.id);
      this.statusParsers.delete(agent.id);
      this.tokenLimitDetected.delete(agent.id);

      finalizeAgentStatus(db, agent, exitCode);

      const initSnapshot = this.initialSnapshots.get(agent.id);
      scoreAndRecordOplog(db, agent, exitCode, scrollbackForScoring, initSnapshot);
      this.initialSnapshots.delete(agent.id);

      this.cleanupWorktree(db, agent.id);

      const completionCb = this.completionCallbacks.get(agent.id);
      if (completionCb) {
        this.completionCallbacks.delete(agent.id);
        completionCb(exitCode);
      }
    });
  }

  async stop(db: Database.Database, agentId: string): Promise<void> {
    const proc = this.processes.get(agentId);
    if (proc) {
      proc.kill();
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
          try {
            process.kill(proc.pid, "SIGKILL");
          } catch {
            /* already exited */
          }
          resolve();
        }, STOP_TIMEOUT_MS);
      });
    } else {
      stopAgent(db, agentId, "completed");
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

  getProcess(agentId: string): IPty | undefined {
    return this.processes.get(agentId);
  }
  listRunning(): string[] {
    return Array.from(this.processes.keys());
  }

  write(agentId: string, data: string): void {
    this.processes.get(agentId)?.write(data);
  }

  resize(agentId: string, cols: number, rows: number): void {
    this.processes.get(agentId)?.resize(cols, rows);
  }

  onAgentComplete(agentId: string, callback: (exitCode: number) => void): void {
    this.completionCallbacks.set(agentId, callback);
  }

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
