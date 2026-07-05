import type { Agent, AgentCreate } from "@exegol/shared";
import type Database from "libsql";
import { activateAgent, getAgent, insertActivity, stopAgent } from "../db/queries";
import { getScrollbackPath } from "../ipc/procedures/scrollback";
import { logger } from "../lib/logger";
import { runSetupIfNeeded } from "../lifecycle/loader";
import { getPtyHost } from "../terminal/pty-host";
import { createOutputProcessor, type OutputProcessor } from "./agent-output-processor";
import { createSpawnCallbacks, type SessionMaps } from "./agent-session-callbacks";
import { buildPtyInvocation, setupAgentCwd } from "./agent-spawn-flow";
import { cleanupWorktree, type WorktreeRecord } from "./agent-worktree-ops";
import { runPreflight } from "./preflight";
import {
  type ReattachResult,
  reattachSidecarAgents as reattachSidecarAgentsImpl,
} from "./reattach-sidecar-agents";
import { getProviderRegistry } from "./registry";
import { broadcastAgentStatus, coreRust, DEFAULT_PTY_COLS, DEFAULT_PTY_ROWS } from "./spawn-env";
import { createTitleStatusTracker } from "./title-status";

export type { AgentStatusEvent } from "./spawn-env";

// ─── AgentManager Singleton ───────────────────────────────────────────────

let instance: AgentManager | null = null;

export function getAgentManager(): AgentManager {
  if (!instance) {
    instance = new AgentManager();
  }
  return instance;
}

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
  /** Agents whose Claude session ID has already been stored (T101). */
  private sessionIdsCaptured: Set<string> = new Set();

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
      sessionIdsCaptured: this.sessionIdsCaptured,
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

    const preflight = await runPreflight(db, {
      cliType: agent.cliType,
      command: cliConfig.command,
      projectPath: project.path,
      useWorktree: config.useWorktree,
      coreRustLoaded: !!coreRust,
    });
    for (const w of preflight.warnings) {
      logger.warn(`[Preflight] ${w.code}: ${w.message}`);
    }
    if (!preflight.ok) {
      const msg = preflight.errors.map((e) => e.message).join("; ");
      throw new Error(`Preflight failed: ${msg}`);
    }

    runSetupIfNeeded(project.path).catch(() => {});

    const cwd = setupAgentCwd(db, agent, config, project, this.worktrees, this.initialSnapshots);

    const { shell, args, env, stdinCommand, enableMarker, isPlainShell } = buildPtyInvocation(
      db,
      agent,
      config,
      cwd,
      registry,
      cliConfig,
      project.path,
    );

    if (!isPlainShell) {
      const resumePattern = registry.get(agent.cliType)?.capabilities?.resumeCommandPattern;
      this.outputProcessors.set(
        agent.id,
        createOutputProcessor(agent.id, agent.cliType, resumePattern),
      );
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
      { scrollbackPath, shellReadyGating: enableMarker, smallRingBuffer: isPlainShell },
    );

    activateAgent(db, agent.id, pid);

    if (stdinCommand) {
      if (enableMarker) {
        // PtyHost queues pre-ready writes and flushes them on the shell-ready
        // marker (or its timeout) — no blind delay racing shell startup.
        ptyHost.write(agent.id, `${stdinCommand}\n`);
      } else {
        setTimeout(() => {
          ptyHost.write(agent.id, `${stdinCommand}\n`);
        }, 500);
      }
    }

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
      await ptyHost.waitForExit(agentId, STOP_TIMEOUT_MS);
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
