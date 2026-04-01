import type { Agent, AgentCliType, AgentCreate, AgentStatus } from "@exegol/shared";
import { BrowserWindow } from "electron";
import type Database from "libsql";
import {
  clearAgentWorktree,
  createOplogEntry,
  createWorktree as dbCreateWorktree,
  removeWorktree as dbRemoveWorktree,
  getAgent,
  getWorktreeByAgentId,
  insertActivity,
  listWorktrees,
  setAgentPid,
  setAgentWorktree,
  stopAgent,
  updateAgentStatus,
} from "../db/queries";
import { runSetupHook } from "../hooks/project-hooks";
import { getScrollbackPath } from "../ipc/procedures/scrollback";
import { logger } from "../lib/logger";
import { getPtyHost } from "../terminal/pty-host";
import { getBashRcfile, getZshWrapperDir, shellSupportsMarker } from "../terminal/shell-wrappers";
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
  scoreAndRecordOplog,
  slugifyBranchName,
} from "./spawn-env";
import { AgentStatusParser } from "./status-parser";
import { createTitleStatusTracker } from "./title-status";
import { createManagedWorktree, getWorktreeName, removeManagedWorktree } from "./worktrees";

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

const STOP_POLL_INTERVAL_MS = 100;
const STOP_TIMEOUT_MS = 5_000;

export class AgentManager {
  private outputProcessors: Map<string, OutputProcessor> = new Map();
  private worktrees: Map<string, WorktreeRecord> = new Map();
  private completionCallbacks: Map<string, (exitCode: number) => void> = new Map();
  private initialSnapshots: Map<string, { headSha: string; cwd: string; projectId: string }> =
    new Map();
  private tokenLimitDetected: Set<string> = new Set();
  /** Track scrollback text for scoring (status parsing produces clean text) */
  private scrollbackBuffers: Map<string, string[]> = new Map();
  private scrollbackSizes: Map<string, number> = new Map();
  private static readonly MAX_SCROLLBACK_BYTES = 1024 * 1024; // 1MB for scoring buffer
  /** Title-based status trackers (T56: detect agent state from terminal title) */
  private titleTrackers: Map<string, (data: string) => void> = new Map();

  async spawn(db: Database.Database, agent: Agent, config: AgentCreate): Promise<void> {
    const registry = getProviderRegistry();
    const cliConfig = registry.resolveCliConfig(agent.cliType);
    if (!cliConfig) {
      throw new Error(`No CLI configuration found for agent type: ${agent.cliType}`);
    }

    const project = db
      .prepare("SELECT path, name FROM projects WHERE id = ?")
      .get(agent.projectId) as { path: string; name: string } | undefined;
    if (!project) {
      throw new Error(`Project ${agent.projectId} not found`);
    }

    let cwd = project.path;

    // ── cwdOverride (e.g. pipeline shared worktree) — skip worktree creation
    if (config.cwdOverride) {
      cwd = config.cwdOverride;
      logger.info("[AgentManager] Using cwdOverride:", { cwd });
    }

    // ── Worktree creation / reuse ───────────────────────────────────────
    if (!config.cwdOverride && config.useWorktree && coreRust) {
      const requestedBranchName =
        config.branchName?.trim() || slugifyBranchName(agent.taskDescription);

      // Check for existing worktree with same branch (reuse on relaunch/handoff)
      const existingWts = listWorktrees(db, agent.projectId);
      const reuseWt = existingWts.find((w) => w.branchName === requestedBranchName);
      if (reuseWt) {
        cwd = reuseWt.path;
        setAgentWorktree(db, agent.id, reuseWt.id);
        this.worktrees.set(agent.id, {
          dbId: reuseWt.id,
          worktreeName: getWorktreeName(reuseWt.branchName),
          worktreePath: reuseWt.path,
          repoPath: project.path,
        });
        logger.info("[AgentManager] Reusing existing worktree:", {
          branch: requestedBranchName,
          path: reuseWt.path,
        });
      } else
        try {
          const wtInfo = createManagedWorktree(project.path, project.name, requestedBranchName);
          cwd = wtInfo.path;

          const dbWt = dbCreateWorktree(db, {
            projectId: agent.projectId,
            agentId: agent.id,
            path: wtInfo.path,
            branchName: wtInfo.branchName,
            autoCleanup: true,
          });
          setAgentWorktree(db, agent.id, dbWt.id);
          this.worktrees.set(agent.id, {
            dbId: dbWt.id,
            worktreeName: wtInfo.worktreeName,
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
              description: `Created worktree '${wtInfo.worktreeName}' on branch '${wtInfo.branchName}'`,
            });
          } catch {
            /* Non-fatal oplog recording */
          }

          logger.info("[AgentManager] Created worktree:", {
            requestedBranch: requestedBranchName,
            branch: wtInfo.branchName,
            path: wtInfo.path,
          });

          // Run project setup hook (T60: exegol.yaml) — non-blocking
          runSetupHook(project.path, wtInfo.path, wtInfo.branchName).catch(() => {});
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

    let shell: string;
    let args: string[];
    let env: Record<string, string>;

    if (isPlainShell) {
      shell = userShell;
      args = ["-il"];
      env = {
        ...process.env,
        TERM: "xterm-256color",
        EXEGOL_AGENT_ID: agent.id,
      } as Record<string, string>;
    } else {
      const { contextPrefix } = buildSpawnContext(db, agent.projectId, config, cwd);
      const fullCommand = buildShellCommand(registry, agent, cliConfig, contextPrefix);
      const apiKeyEnv = buildApiKeyEnv(db);

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

      shell = userShell;
      args = ["-ilc", fullCommand];
      env = {
        ...process.env,
        ...apiKeyEnv,
        ...cliConfig.env,
        TERM: "xterm-256color",
        EXEGOL_AGENT_ID: agent.id,
      } as Record<string, string>;
    }

    // ── Shell readiness: only for plain shells (interactive prompt) ─────
    // Agent CLIs use -ilc which runs a command directly — no prompt, no precmd,
    // so the marker never fires and we'd wait 15s for nothing.
    const shellName = userShell.split("/").pop() ?? "";
    const enableMarker = isPlainShell && shellSupportsMarker(userShell);
    if (enableMarker) {
      if (shellName === "zsh") {
        env.EXEGOL_ORIG_ZDOTDIR = process.env.ZDOTDIR || require("node:os").homedir();
        env.ZDOTDIR = getZshWrapperDir();
      } else if (shellName === "bash") {
        args = ["-il", "--rcfile", getBashRcfile()];
      }
    }

    // ── Output processing setup (non-shell agents only) ─────────────────
    if (!isPlainShell) {
      this.outputProcessors.set(agent.id, createOutputProcessor(agent.id, agent.cliType));
      // Title-based status detection (T56) — only for CLIs that set terminal titles
      if (["claude-code", "gemini", "codex", "crush"].includes(agent.cliType)) {
        this.titleTrackers.set(
          agent.id,
          createTitleStatusTracker((status, _title) => {
            broadcastAgentStatus({
              agentId: agent.id,
              projectId: agent.projectId,
              status,
              currentStep: null,
              cliType: agent.cliType,
              timestamp: Date.now(),
            });
          }),
        );
      }
      this.scrollbackBuffers.set(agent.id, []);
      this.scrollbackSizes.set(agent.id, 0);
    }

    // ── Spawn PTY in isolated subprocess (T35) ──────────────────────────
    const ptyHost = getPtyHost();
    const scrollbackPath = isPlainShell ? undefined : getScrollbackPath(agent.id);

    const { pid } = await ptyHost.createSession(
      agent.id,
      { shell, args, cwd, cols: DEFAULT_PTY_COLS, rows: DEFAULT_PTY_ROWS, env },
      {
        onData: (data: string) => {
          // Broadcast raw terminal data to all renderer windows
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send("terminal:data", agent.id, data);
          }
          // Notify data subscribers (pipeline idle monitoring)
          this.dataCallbacks.get(agent.id)?.(data);
          // Title-based status detection (T56)
          this.titleTrackers.get(agent.id)?.(data);

          if (isPlainShell) return;

          // Buffer raw data for scoring (capped at 1MB)
          const currentSize = this.scrollbackSizes.get(agent.id) ?? 0;
          if (currentSize < AgentManager.MAX_SCROLLBACK_BYTES) {
            this.scrollbackBuffers.get(agent.id)?.push(data);
            this.scrollbackSizes.set(agent.id, currentSize + data.length);
          }

          // Status parsing
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

          // Token limit detection + handoff
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
        },

        onExit: (exitCode: number) => {
          const isShell = agent.cliType === "shell";
          const scrollbackForScoring = isShell
            ? ""
            : (this.scrollbackBuffers.get(agent.id)?.join("") ?? "");

          // Clean up in-memory state
          this.outputProcessors.delete(agent.id);
          this.titleTrackers.delete(agent.id);
          this.tokenLimitDetected.delete(agent.id);
          this.scrollbackBuffers.delete(agent.id);
          this.scrollbackSizes.delete(agent.id);

          finalizeAgentStatus(db, agent, exitCode);

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
        },

        onError: (message: string) => {
          logger.error(`[AgentManager] PTY error for ${agent.id}: ${message}`);
        },
      },
      { scrollbackPath, shellReadyGating: enableMarker },
    );

    setAgentPid(db, agent.id, pid);
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
  }

  /**
   * Reattach to agents that survived in the sidecar after app restart.
   * Rebuilds output processors + callbacks so they continue working as if freshly spawned.
   */
  async reattachSidecarAgents(db: Database.Database, sidecarSessionIds: string[]): Promise<number> {
    const stale = db
      .prepare("SELECT * FROM agents WHERE status IN ('running', 'spawning', 'waiting_input')")
      .all() as Array<Record<string, unknown>>;

    let reattached = 0;
    const ptyHost = getPtyHost();

    for (const row of stale) {
      const agentId = row.id as string;
      const cliType = row.cli_type as AgentCliType;
      const projectId = row.project_id as string;
      const isShell = cliType === "shell";

      if (!sidecarSessionIds.includes(agentId)) continue;

      // Rebuild output processor for non-shell agents
      try {
        this.hydrateTrackedWorktree(db, agentId);
        if (!isShell) {
          this.outputProcessors.set(agentId, createOutputProcessor(agentId, cliType));
          this.scrollbackBuffers.set(agentId, []);
          this.scrollbackSizes.set(agentId, 0);
        }

        const scrollbackPath = isShell ? undefined : getScrollbackPath(agentId);

        await ptyHost.reattachSession(
          agentId,
          { cols: DEFAULT_PTY_COLS, rows: DEFAULT_PTY_ROWS },
          {
            onData: (data: string) => {
              for (const win of BrowserWindow.getAllWindows()) {
                win.webContents.send("terminal:data", agentId, data);
              }
              if (isShell) return;

              const currentSize = this.scrollbackSizes.get(agentId) ?? 0;
              if (currentSize < AgentManager.MAX_SCROLLBACK_BYTES) {
                this.scrollbackBuffers.get(agentId)?.push(data);
                this.scrollbackSizes.set(agentId, currentSize + data.length);
              }

              const processor = this.outputProcessors.get(agentId);
              if (!processor) return;
              const result = processor.process(data);
              if (result.status || result.currentStep) {
                const status = (result.status as AgentStatus) ?? "running";
                updateAgentStatus(db, agentId, status, result.currentStep);
                broadcastAgentStatus({
                  agentId,
                  projectId,
                  status,
                  currentStep: result.currentStep ?? null,
                  cliType,
                  timestamp: Date.now(),
                });
              }
            },

            onExit: (exitCode: number) => {
              this.outputProcessors.delete(agentId);
              this.tokenLimitDetected.delete(agentId);
              this.scrollbackBuffers.delete(agentId);
              this.scrollbackSizes.delete(agentId);
              this.titleTrackers.delete(agentId);
              finalizeAgentStatus(
                db,
                {
                  id: agentId,
                  cliType,
                  projectId,
                  taskDescription: (row.task_description as string) ?? "",
                } as Agent,
                exitCode,
              );
              this.cleanupWorktree(db, agentId);
              const completionCb = this.completionCallbacks.get(agentId);
              if (completionCb) {
                this.completionCallbacks.delete(agentId);
                completionCb(exitCode);
              }
            },

            onError: (message: string) => {
              logger.error(`[AgentManager] PTY error for reattached ${agentId}: ${message}`);
            },
          },
          { scrollbackPath },
        );

        // Confirm running status (may have been "spawning" before crash)
        updateAgentStatus(db, agentId, "running");
        broadcastAgentStatus({
          agentId,
          projectId,
          status: "running",
          currentStep: row.current_step as string | null,
          cliType,
          timestamp: Date.now(),
        });

        reattached++;
        logger.info(`[AgentManager] Reattached to sidecar session: ${agentId} (${cliType})`);
      } catch (err) {
        // Clean up orphaned state on failure
        this.outputProcessors.delete(agentId);
        this.scrollbackBuffers.delete(agentId);
        this.scrollbackSizes.delete(agentId);
        logger.warn(`[AgentManager] Failed to reattach ${agentId}: ${err}`);
      }
    }

    return reattached;
  }

  async stop(db: Database.Database, agentId: string): Promise<void> {
    const ptyHost = getPtyHost();
    if (ptyHost.isAlive(agentId)) {
      ptyHost.kill(agentId);
      // Wait for exit
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (!ptyHost.hasSession(agentId)) {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            resolve();
          }
        }, STOP_POLL_INTERVAL_MS);
        const timeout = setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, STOP_TIMEOUT_MS);
      });
    } else {
      stopAgent(db, agentId, "completed");
      this.cleanupWorktree(db, agentId);
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

  listRunning(): string[] {
    return getPtyHost().listSessions();
  }

  write(agentId: string, data: string): void {
    getPtyHost().write(agentId, data);
  }

  resize(agentId: string, cols: number, rows: number): void {
    getPtyHost().resize(agentId, cols, rows);
  }

  onAgentComplete(agentId: string, callback: (exitCode: number) => void): void {
    this.completionCallbacks.set(agentId, callback);
  }

  /** Register a one-shot or persistent data callback for an agent (pipeline idle monitoring) */
  private dataCallbacks: Map<string, (data: string) => void> = new Map();

  onAgentData(agentId: string, callback: (data: string) => void): () => void {
    this.dataCallbacks.set(agentId, callback);
    return () => this.dataCallbacks.delete(agentId);
  }

  /** Get PID from PtyHost session (for process metrics) */
  getPid(agentId: string): number | null {
    return getPtyHost().getPid(agentId);
  }

  private hydrateTrackedWorktree(db: Database.Database, agentId: string): void {
    if (this.worktrees.has(agentId)) return;
    const wt = getWorktreeByAgentId(db, agentId);
    if (!wt) return;

    const project = db.prepare("SELECT path FROM projects WHERE id = ?").get(wt.projectId) as
      | { path: string }
      | undefined;
    if (!project) return;

    this.worktrees.set(agentId, {
      dbId: wt.id,
      worktreeName: getWorktreeName(wt.branchName),
      worktreePath: wt.path,
      repoPath: project.path,
    });
  }

  private cleanupWorktree(db: Database.Database, agentId: string): void {
    this.hydrateTrackedWorktree(db, agentId);
    const wt = this.worktrees.get(agentId);
    if (!wt || !coreRust) return;
    try {
      const hasChanges = coreRust.worktreeHasChanges(wt.worktreePath);
      if (hasChanges) {
        logger.info(
          `[AgentManager] Worktree '${wt.worktreeName}' has changes — keeping at ${wt.worktreePath}`,
        );
      } else {
        removeManagedWorktree(wt.repoPath, wt.worktreeName, wt.worktreePath, false);
        dbRemoveWorktree(db, wt.dbId);
        clearAgentWorktree(db, agentId);
        logger.info(`[AgentManager] Cleaned up empty worktree '${wt.worktreeName}'`);
      }
    } catch (err) {
      logger.error(`[AgentManager] Failed to clean up worktree '${wt.worktreeName}':`, err);
    }
    this.worktrees.delete(agentId);
  }
}
