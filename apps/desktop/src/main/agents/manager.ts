import type { Agent, AgentCreate } from "@exegol/shared";
import type Database from "libsql";
import {
  createOplogEntry,
  createWorktree as dbCreateWorktree,
  getAgent,
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
import { loadLifecycleConfig, runSetupIfNeeded } from "../lifecycle/loader";
import { getPtyHost } from "../terminal/pty-host";
import { getBashRcfile, getZshWrapperDir, shellSupportsMarker } from "../terminal/shell-wrappers";
import { createOutputProcessor, type OutputProcessor } from "./agent-output-processor";
import { createSpawnCallbacks, type SessionMaps } from "./agent-session-callbacks";
import { cleanupWorktree, type WorktreeRecord } from "./agent-worktree-ops";
import {
  type ReattachResult,
  reattachSidecarAgents as reattachSidecarAgentsImpl,
} from "./reattach-sidecar-agents";
import { getProviderRegistry } from "./registry";
import { buildShellCommand, buildSpawnContext } from "./spawn-context";
import {
  broadcastAgentStatus,
  buildApiKeyEnv,
  coreRust,
  DEFAULT_PTY_COLS,
  DEFAULT_PTY_ROWS,
  slugifyBranchName,
} from "./spawn-env";
import { createTitleStatusTracker } from "./title-status";
import { createManagedWorktree, getWorktreeName } from "./worktrees";

export type { AgentStatusEvent } from "./spawn-env";

// ─── AgentManager Singleton ───────────────────────────────────────────────

let instance: AgentManager | null = null;

export function getAgentManager(): AgentManager {
  if (!instance) {
    instance = new AgentManager();
  }
  return instance;
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
  /** Register a one-shot or persistent data callback for an agent (pipeline idle monitoring) */
  private dataCallbacks: Map<string, (data: string) => void> = new Map();

  private getSessionMaps(): SessionMaps {
    return {
      outputProcessors: this.outputProcessors,
      titleTrackers: this.titleTrackers,
      scrollbackBuffers: this.scrollbackBuffers,
      scrollbackSizes: this.scrollbackSizes,
      tokenLimitDetected: this.tokenLimitDetected,
      completionCallbacks: this.completionCallbacks,
      initialSnapshots: this.initialSnapshots,
      dataCallbacks: this.dataCallbacks,
    };
  }

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

    // ── Lifecycle: run setup once per session per project (T91) ────────
    runSetupIfNeeded(project.path).catch(() => {});

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
    let stdinCommand: string | null = null; // For interactive CLIs: injected after shell ready

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
      let fullCommand = buildShellCommand(registry, agent, cliConfig, contextPrefix);

      // Resume: replace prompt with provider's resume flag (e.g. claude --continue)
      if (config.resumeSession) {
        const provider = registry.get(agent.cliType);
        const resumeFlag = provider?.capabilities?.resumeFlag;
        if (resumeFlag) {
          fullCommand = `${cliConfig.command} ${resumeFlag}`;
        }
      }
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

      // ── Lifecycle: prepend beforeAgent script if configured (T91) ──────
      const lifecycle = loadLifecycleConfig(project.path);
      if (lifecycle?.beforeAgent) {
        fullCommand = `${lifecycle.beforeAgent} && ${fullCommand}`;
      }

      // Interactive CLIs (no prompt arg support) need a persistent shell
      // that stays open. We launch as shell (-il) and inject the command
      // via stdin write after shell is ready.
      const provider = registry.get(agent.cliType);
      const isInteractiveCli = !provider?.capabilities?.supportsPromptArg;

      logger.info("[AgentManager] Spawning:", {
        userShell,
        fullCommand,
        isInteractiveCli,
        cwd,
        shellExists: require("node:fs").existsSync(userShell),
      });

      shell = userShell;
      if (isInteractiveCli) {
        args = ["-il"];
        stdinCommand = fullCommand;
      } else {
        args = ["-ilc", fullCommand];
      }
      env = {
        ...process.env,
        ...apiKeyEnv,
        ...cliConfig.env,
        TERM: "xterm-256color",
        EXEGOL_AGENT_ID: agent.id,
      } as Record<string, string>;
    }

    // ── Shell readiness: only for plain shells (interactive prompt) ─────
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

    const callbacks = createSpawnCallbacks(
      db,
      agent,
      this.getSessionMaps(),
      (db2, agentId) => cleanupWorktree(db2, agentId, this.worktrees),
      AgentManager.MAX_SCROLLBACK_BYTES,
    );

    const { pid } = await ptyHost.createSession(
      agent.id,
      { shell, args, cwd, cols: DEFAULT_PTY_COLS, rows: DEFAULT_PTY_ROWS, env },
      callbacks,
      { scrollbackPath, shellReadyGating: enableMarker },
    );

    setAgentPid(db, agent.id, pid);
    // Session ID = agent ID (PTY sessions are keyed by agent.id)
    db.prepare("UPDATE agents SET session_id = ? WHERE id = ?").run(agent.id, agent.id);

    // Interactive CLIs: inject the command after shell initializes
    if (stdinCommand) {
      setTimeout(() => {
        ptyHost.write(agent.id, `${stdinCommand}\n`);
      }, 500);
    }

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
   * Rebuilds output processors + callbacks so they continue working as if
   * freshly spawned. Returns a detailed result with alive/dead/failed sets
   * so the caller can mark dead/failed agents as crashed.
   */
  async reattachSidecarAgents(
    db: Database.Database,
    sidecarSessionIds: string[],
  ): Promise<ReattachResult> {
    return reattachSidecarAgentsImpl(
      db,
      sidecarSessionIds,
      this.getSessionMaps(),
      this.worktrees,
      AgentManager.MAX_SCROLLBACK_BYTES,
    );
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
      cleanupWorktree(db, agentId, this.worktrees);
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

  onAgentData(agentId: string, callback: (data: string) => void): () => void {
    this.dataCallbacks.set(agentId, callback);
    return () => this.dataCallbacks.delete(agentId);
  }

  /** Get PID from PtyHost session (for process metrics) */
  getPid(agentId: string): number | null {
    return getPtyHost().getPid(agentId);
  }
}
