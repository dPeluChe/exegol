import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Agent, AgentCliType, AgentCreate, AgentStatus } from "@exegol/shared";
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

/** Unified output processor — Rust AgentOutputStream if available, JS fallback */
type ProcessResult = { status?: string; currentStep?: string; tokenLimitWarning: boolean };
type OutputProcessor = { process(data: string): ProcessResult };

const useRustProcessor = !!coreRust?.AgentOutputStream;
if (useRustProcessor) {
  logger.info("[AgentManager] Rust processing pipeline available — using native output processor");
}

function createOutputProcessor(_agentId: string, cliType: AgentCliType): OutputProcessor {
  if (useRustProcessor) {
    try {
      // biome-ignore lint/style/noNonNullAssertion: guarded by useRustProcessor check above
      const stream = new coreRust!.AgentOutputStream(cliType);
      return {
        process(data: string) {
          const r = stream.processChunk(data);
          return {
            status: r.status ?? undefined,
            currentStep: r.currentStep ?? undefined,
            tokenLimitWarning: r.tokenLimitWarning,
          };
        },
      };
    } catch {
      // Fall through to JS on instantiation error
    }
  }

  const parser = new AgentStatusParser(_agentId, cliType);
  return {
    process(data: string) {
      const u = parser.parse(data);
      return {
        status: u?.status,
        currentStep: u?.currentStep,
        tokenLimitWarning: u?.tokenLimitWarning ?? false,
      };
    },
  };
}

export class AgentManager {
  private processes: Map<string, IPty> = new Map();
  private outputProcessors: Map<string, OutputProcessor> = new Map();
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

    // ── Plain shell mode (no agent CLI, just $SHELL) ───────────────────
    const isPlainShell = agent.cliType === "shell";
    const userShell = process.env.SHELL || "/bin/zsh";

    let proc: IPty;
    if (isPlainShell) {
      // Interactive login shell in project directory — no command, no context injection
      proc = pty.spawn(userShell, ["-il"], {
        name: "xterm-256color",
        cols: DEFAULT_PTY_COLS,
        rows: DEFAULT_PTY_ROWS,
        cwd,
        env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
      });
    } else {
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

      logger.info("[AgentManager] Spawning:", {
        userShell,
        fullCommand,
        cwd,
        shellExists: require("node:fs").existsSync(userShell),
      });
      proc = pty.spawn(userShell, ["-ilc", fullCommand], {
        name: "xterm-256color",
        cols: DEFAULT_PTY_COLS,
        rows: DEFAULT_PTY_ROWS,
        cwd,
        env: { ...process.env, ...apiKeyEnv, ...cliConfig.env, TERM: "xterm-256color" } as Record<
          string,
          string
        >,
      });
    }

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

    // Shell terminals: no output processing, no scrollback buffering
    if (!isPlainShell) {
      const processor = createOutputProcessor(agent.id, agent.cliType);
      this.outputProcessors.set(agent.id, processor);
      this.scrollbackBuffers.set(agent.id, []);
      this.scrollbackSizes.set(agent.id, 0);
      this.scrollbackTimers.set(
        agent.id,
        setInterval(() => {
          this.flushScrollback(agent.id, true);
        }, SCROLLBACK_FLUSH_INTERVAL_MS),
      );
    }

    // ── PTY data handler ──────────────────────────────────────────────
    proc.onData((data: string) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("terminal:data", agent.id, data);
      }

      // Skip processing for plain shells — just forward terminal data
      if (isPlainShell) return;

      const currentSize = this.scrollbackSizes.get(agent.id) ?? 0;
      if (currentSize < MAX_SCROLLBACK_BYTES) {
        this.scrollbackBuffers.get(agent.id)?.push(data);
        this.scrollbackSizes.set(agent.id, currentSize + data.length);
      }

      const processor = this.outputProcessors.get(agent.id);
      if (!processor) return;
      const result = processor.process(data);
      if (result.status || result.currentStep) {
        if (result.status) {
          updateAgentStatus(db, agent.id, result.status as AgentStatus, result.currentStep);
          broadcastAgentStatus({
            agentId: agent.id,
            projectId: agent.projectId,
            status: result.status as AgentStatus,
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

      if (result.tokenLimitWarning && !this.tokenLimitDetected.has(agent.id)) {
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
    });

    // ── PTY exit handler ──────────────────────────────────────────────
    proc.onExit(({ exitCode }) => {
      // Clean up timers and in-memory state (always safe, no DB)
      const timer = this.scrollbackTimers.get(agent.id);
      if (timer) {
        clearInterval(timer);
        this.scrollbackTimers.delete(agent.id);
      }

      const isShell = agent.cliType === "shell";
      const scrollbackForScoring = isShell
        ? ""
        : (this.scrollbackBuffers.get(agent.id)?.join("") ?? "");

      // Memory extraction + scoring: skip for plain shells (no useful knowledge)
      if (!isShell) {
        try {
          const scrollbackForMemory = this.scrollbackBuffers.get(agent.id)?.join("") ?? "";
          if (scrollbackForMemory.length > 0) {
            extractAndStoreMemories(db, agent.id, agent.projectId, scrollbackForMemory);
          }
        } catch {
          /* DB closed during shutdown — non-fatal */
        }
      }

      this.flushScrollback(agent.id, false);
      this.processes.delete(agent.id);
      this.outputProcessors.delete(agent.id);
      this.tokenLimitDetected.delete(agent.id);

      finalizeAgentStatus(db, agent, exitCode);

      // Scoring + oplog: skip for plain shells
      if (!isShell) {
        scoreAndRecordOplog(
          db,
          agent,
          exitCode,
          scrollbackForScoring,
          this.initialSnapshots.get(agent.id),
        );
      }
      this.initialSnapshots.delete(agent.id);

      try {
        this.cleanupWorktree(db, agent.id);
      } catch {
        /* DB closed during shutdown — non-fatal */
      }

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
