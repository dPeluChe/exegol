import type { Agent, AgentCreate } from "@exegol/shared";
import type Database from "libsql";
import {
  createOplogEntry,
  createWorktree as dbCreateWorktree,
  listWorktrees,
  setAgentWorktree,
} from "../db/queries";
import { runSetupHook } from "../hooks/project-hooks";
import { PermanentError } from "../lib/errors";
import { logger } from "../lib/logger";
import { loadLifecycleConfig } from "../lifecycle/loader";
import { resolveMcpShimPath, writeAgentMcpConfig } from "../mcp/exegol-mcp-config";
import { ensureExegolMcpServerStarted } from "../mcp/exegol-server";
import { inspectCommand } from "../security/command-guard";
import {
  getFishInitCommand,
  getShellIntegrationBashRcfile,
  getShellIntegrationZdotdir,
  shellSupportsMarker,
} from "../terminal/shell-wrappers";
import type { WorktreeRecord } from "./agent-worktree-ops";
import type { AgentProviderRegistry } from "./registry";
import { buildShellCommand, buildSpawnContext } from "./spawn-context";
import { _getFullPath, buildApiKeyEnv, coreRust, slugifyBranchName } from "./spawn-env";
import { createManagedWorktree, getWorktreeName, removeManagedWorktree } from "./worktrees";

export interface PtyInvocation {
  shell: string;
  args: string[];
  env: Record<string, string>;
  /** Command to inject after shell starts (interactive CLIs only). null otherwise. */
  stdinCommand: string | null;
  enableMarker: boolean;
  isPlainShell: boolean;
}

interface ProjectInfo {
  path: string;
  name: string;
}

/**
 * Resolve cwd for an agent: either the override (e.g. pipeline shared worktree),
 * a reused existing worktree on the same branch, or a freshly created worktree.
 * Falls back to project root if worktree creation fails.
 */
export function setupAgentCwd(
  db: Database.Database,
  agent: Agent,
  config: AgentCreate,
  project: ProjectInfo,
  worktrees: Map<string, WorktreeRecord>,
  initialSnapshots: Map<string, { headSha: string; cwd: string; projectId: string }>,
): string {
  let cwd = project.path;

  if (config.cwdOverride) {
    cwd = config.cwdOverride;
    logger.info("[AgentManager] Using cwdOverride:", { cwd });
    setIsolationMode(db, agent.id, "pipeline");
    captureInitialSnapshot(agent, cwd, initialSnapshots);
    return cwd;
  }

  if (!config.useWorktree) {
    setIsolationMode(db, agent.id, "project-root");
    captureInitialSnapshot(agent, cwd, initialSnapshots);
    return cwd;
  }
  if (!coreRust) {
    // Worktree was requested but the native module is missing — silent fall back.
    setIsolationMode(db, agent.id, "fallback");
    captureInitialSnapshot(agent, cwd, initialSnapshots);
    return cwd;
  }

  const requestedBranchName = config.branchName?.trim() || slugifyBranchName(agent.taskDescription);

  const existingWts = listWorktrees(db, agent.projectId);
  const reuseWt = existingWts.find((w) => w.branchName === requestedBranchName);
  if (reuseWt) {
    cwd = reuseWt.path;
    setAgentWorktree(db, agent.id, reuseWt.id);
    worktrees.set(agent.id, {
      dbId: reuseWt.id,
      worktreeName: getWorktreeName(reuseWt.branchName),
      worktreePath: reuseWt.path,
      repoPath: project.path,
    });
    logger.info("[AgentManager] Reusing existing worktree:", {
      branch: requestedBranchName,
      path: reuseWt.path,
    });
    setIsolationMode(db, agent.id, "isolated");
    captureInitialSnapshot(agent, cwd, initialSnapshots);
    return cwd;
  }

  let createdWtInfo: { worktreeName: string; path: string; branchName: string } | null = null;
  try {
    const wtInfo = createManagedWorktree(project.path, project.name, requestedBranchName);
    createdWtInfo = wtInfo;
    cwd = wtInfo.path;

    const dbWt = dbCreateWorktree(db, {
      projectId: agent.projectId,
      agentId: agent.id,
      path: wtInfo.path,
      branchName: wtInfo.branchName,
      autoCleanup: true,
    });
    setAgentWorktree(db, agent.id, dbWt.id);
    worktrees.set(agent.id, {
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

    runSetupHook(project.path, wtInfo.path, wtInfo.branchName).catch(() => {});
    setIsolationMode(db, agent.id, "isolated");
  } catch (err) {
    logger.error("[AgentManager] Failed to create worktree, falling back to project root:", err);
    // Half-success guard: createManagedWorktree may have written a worktree
    // to disk before dbCreateWorktree threw. Tear the on-disk worktree down
    // so we don't leak it, and reset cwd so the agent runs in project.path
    // (matching what the "fallback" badge claims).
    if (createdWtInfo) {
      try {
        removeManagedWorktree(project.path, createdWtInfo.worktreeName, createdWtInfo.path, true);
      } catch (cleanupErr) {
        logger.warn(
          "[AgentManager] Failed to remove orphaned worktree during fallback:",
          cleanupErr,
        );
      }
    }
    cwd = project.path;
    setIsolationMode(db, agent.id, "fallback");
  }

  captureInitialSnapshot(agent, cwd, initialSnapshots);
  return cwd;
}

function setIsolationMode(db: Database.Database, agentId: string, mode: string): void {
  try {
    db.prepare("UPDATE agents SET isolation_mode = ? WHERE id = ?").run(mode, agentId);
  } catch (err) {
    logger.warn(`[AgentManager] Failed to persist isolation_mode=${mode}:`, err);
  }
}

function captureInitialSnapshot(
  agent: Agent,
  cwd: string,
  initialSnapshots: Map<string, { headSha: string; cwd: string; projectId: string }>,
): void {
  if (!coreRust || agent.cliType === "shell") return;
  try {
    const snapshot = coreRust.getRepoSnapshot(cwd);
    initialSnapshots.set(agent.id, {
      headSha: snapshot.headSha,
      cwd,
      projectId: agent.projectId,
    });
  } catch {
    /* Non-fatal */
  }
}

/**
 * Build the PTY shell, args, and env for an agent. Handles plain-shell mode,
 * interactive CLIs (which need stdin injection after shell ready), and the
 * shell-readiness marker for prompt detection.
 */
export function buildPtyInvocation(
  db: Database.Database,
  agent: Agent,
  config: AgentCreate,
  cwd: string,
  registry: AgentProviderRegistry,
  cliConfig: { command: string; args: string[]; env: Record<string, string> },
  projectPath: string,
): PtyInvocation {
  const isPlainShell = agent.cliType === "shell";
  const userShell = process.env.SHELL || "/bin/zsh";

  let shell: string;
  let args: string[];
  let env: Record<string, string>;
  let stdinCommand: string | null = null;

  if (isPlainShell) {
    shell = userShell;
    args = ["-il"];
    env = {
      ...process.env,
      TERM: "xterm-256color",
      EXEGOL_AGENT_ID: agent.id,
    } as Record<string, string>;
  } else {
    const { contextPrefix } = buildSpawnContext(db, agent.projectId, config, projectPath);
    let fullCommand = buildShellCommand(
      registry,
      agent,
      cliConfig,
      contextPrefix,
      config.accessMode,
    );

    if (config.resumeSession) {
      const sourceAgentId = config.resumeFromAgentId ?? agent.id;
      const row = db
        .prepare("SELECT resume_command, claude_session_id FROM agents WHERE id = ?")
        .get(sourceAgentId) as
        | { resume_command: string | null; claude_session_id: string | null }
        | undefined;

      if (row?.resume_command) {
        fullCommand = row.resume_command;
        logger.info(
          `[AgentManager] Resuming ${agent.cliType} with stored command: ${row.resume_command}`,
        );
      } else if (row?.claude_session_id && agent.cliType === "claude-code") {
        fullCommand = `${cliConfig.command} --resume ${row.claude_session_id}`;
        logger.info(`[AgentManager] Resuming Claude via session ID ${row.claude_session_id}`);
      } else {
        const provider = registry.get(agent.cliType);
        const resumeFlag = provider?.capabilities?.resumeFlag;
        if (resumeFlag) {
          fullCommand = `${cliConfig.command} ${resumeFlag}`;
        }
      }
    }
    const apiKeyEnv = buildApiKeyEnv(db);

    const lifecycle = loadLifecycleConfig(projectPath);
    if (lifecycle?.beforeAgent) {
      fullCommand = `${lifecycle.beforeAgent} && ${fullCommand}`;
    }

    // Spawn-boundary guard: refuse obviously destructive commands. Scans the
    // final string handed to the shell (prompt + resume + lifecycle included).
    const verdict = inspectCommand(fullCommand);
    if (!verdict.ok) {
      logger.error(
        `[AgentManager] Refusing to spawn ${agent.cliType}: ${verdict.reason} (matched: ${JSON.stringify(verdict.matched)})`,
      );
      throw new PermanentError(
        `Command refused by safety guard (${verdict.reason}): ${verdict.matched}`,
        "COMMAND_REFUSED",
      );
    }

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
      args = ["-i"];
      stdinCommand = fullCommand;
    } else {
      args = ["-ic", fullCommand];
    }
    env = {
      ...process.env,
      ...apiKeyEnv,
      ...cliConfig.env,
      PATH: _getFullPath(),
      TERM: "xterm-256color",
      EXEGOL_AGENT_ID: agent.id,
      EXEGOL_ACCESS_MODE: config.accessMode ?? "write",
    } as Record<string, string>;

    // T145: give the agent mid-session access to memory/knowledge via MCP.
    try {
      ensureExegolMcpServerStarted(db);
      writeAgentMcpConfig(
        cwd,
        resolveMcpShimPath(),
        agent.id,
        agent.projectId,
        config.accessMode ?? "write",
      );
    } catch (err) {
      logger.warn("[AgentManager] Failed to wire Exegol MCP config:", err);
    }
  }

  const shellName = userShell.split("/").pop() ?? "";
  // Marker gating also covers interactive-CLI spawns: PtyHost queues the
  // stdinCommand until the shell-ready marker (or its timeout) fires, so we
  // don't race a blind delay against shell startup.
  const enableMarker = (isPlainShell || stdinCommand !== null) && shellSupportsMarker(userShell);
  if (enableMarker) {
    if (shellName === "zsh") {
      // T112: route via the OSC 7 + OSC 133 shell-integration dir so plain
      // shells emit cwd + prompt boundary markers. The integration scripts
      // also emit the existing OSC-777 ready marker (pty-shell-ready.ts).
      env.EXEGOL_USER_ZDOTDIR = process.env.ZDOTDIR || require("node:os").homedir();
      env.ZDOTDIR = getShellIntegrationZdotdir();
    } else if (shellName === "bash") {
      // Drop -l: bash silently ignores --rcfile when started as a login
      // shell. The integration script emulates login init internally
      // (sources /etc/profile + ~/.bash_profile|~/.profile + ~/.bashrc).
      args = ["-i", "--rcfile", getShellIntegrationBashRcfile()];
    } else if (shellName === "fish") {
      // fish is in SHELLS_WITH_MARKER but had no wiring — without this the
      // ready gate only resolves via its 15s timeout, queueing early input.
      args = [...args, "--init-command", getFishInitCommand()];
    }
  }

  return { shell, args, env, stdinCommand, enableMarker, isPlainShell };
}
