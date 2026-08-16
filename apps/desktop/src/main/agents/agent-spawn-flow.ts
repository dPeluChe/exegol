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
import {
  resolveMcpShimPath,
  writeAgentMcpConfigFor,
  writePerAgentMcpConfig,
} from "../mcp/exegol-mcp-config";
import { ensureExegolMcpServerStarted, registerAgentMcpToken } from "../mcp/exegol-server";
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
import {
  _getFullPath,
  buildApiKeyEnv,
  buildClaudeCodeHooksFile,
  coreRust,
  slugifyBranchName,
} from "./spawn-env";
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
    const wtInfo = createManagedWorktree(
      project.path,
      project.name,
      requestedBranchName,
      "worktrees",
      config.baseBranch,
    );
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

  // oh-my-zsh's interactive update prompt blocks shell init (no ready marker,
  // frozen pane) — suppress it in every PTY we spawn.
  const shellInitGuards = {
    DISABLE_AUTO_UPDATE: "true",
    DISABLE_UPDATE_PROMPT: "true",
  };

  if (isPlainShell) {
    shell = userShell;
    args = ["-il"];
    env = {
      ...process.env,
      ...shellInitGuards,
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
        .prepare("SELECT resume_command, claude_session_id, alias FROM agents WHERE id = ?")
        .get(sourceAgentId) as
        | { resume_command: string | null; claude_session_id: string | null; alias: string | null }
        | undefined;

      // T160: resume spawns a NEW agent row — carry the session name over or
      // agent_send targets die on every restart (paco lost his name, 2026-08-12).
      // Overwrites the codename createAgent just assigned: continuing a session
      // must keep the name others already address it by.
      if (row?.alias && sourceAgentId !== agent.id) {
        db.prepare("UPDATE agents SET alias = ? WHERE id = ?").run(row.alias, agent.id);
      }

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
    // T123: deterministic status via Claude Code native hooks (Stop/Notification/
    // PreToolUse) emitting OSC-777 notify signals into the PTY stream. Other
    // providers fall back to the scraped-output parser (source: "parser").
    // Resumed sessions get hooks too — long-lived sessions are exactly the
    // ones that need deterministic status, and --settings composes with
    // --resume (guard against a stored resume_command that already has one).
    if (agent.cliType === "claude-code" && !fullCommand.includes("--settings")) {
      const hooksPath = buildClaudeCodeHooksFile(agent.id, {
        // Only a shared checkout can have two agents reaching for one file.
        enforceClaims: !config.useWorktree,
      });
      if (hooksPath) {
        fullCommand = `${fullCommand} --settings ${hooksPath}`;
      }
    }

    const apiKeyEnv = buildApiKeyEnv(db);

    const lifecycle = loadLifecycleConfig(projectPath);
    if (lifecycle?.beforeAgent) {
      fullCommand = `${lifecycle.beforeAgent} && ${fullCommand}`;
    }

    // Spawn-boundary guard: refuse obviously destructive commands. Scans the
    // final string handed to the shell (prompt + resume + lifecycle included).
    // T145/T166: mid-session MCP. Identity = per-agent secret token; the
    // server never trusts client claims. Provisioned HERE (before args are
    // built) because claude/codex take per-session flags that carry it.
    let mcpToken: string | null = null;
    try {
      ensureExegolMcpServerStarted(db);
      mcpToken = registerAgentMcpToken(agent.id, agent.projectId);
      const shimPath = resolveMcpShimPath();
      const accessMode = config.accessMode ?? "write";
      // The cwd config files are per-DIRECTORY, so two agents on the same repo
      // (the build+review pair) overwrote each other's token and swapped
      // identities (live 2026-08-12). Where the CLI supports per-session MCP
      // config, hand it a private file outside the repo instead.
      // Written for EVERY provider, even those that never read it: it is also
      // Exegol's own record of which token belongs to which agent, so reattach
      // after a restart re-arms each session with its own credential instead of
      // reading whichever token a sibling last left in the shared cwd file.
      const perAgentConfig = writePerAgentMcpConfig(agent.id, shimPath, mcpToken, accessMode);
      if (perAgentConfig && agent.cliType === "claude-code") {
        // No --strict-mcp-config: the user's own servers still load.
        fullCommand = `${fullCommand} --mcp-config ${perAgentConfig}`;
      } else {
        writeAgentMcpConfigFor(agent.cliType, cwd, shimPath, mcpToken, accessMode);
        if (agent.cliType === "codex") {
          // codex sanitizes MCP-server env, so the token normally rides the
          // shared cwd file. `-c` sets it per SESSION and wins over the file in
          // the shim's resolve chain, keeping siblings distinct.
          fullCommand = `${fullCommand} -c 'mcp_servers.exegol.env.ELECTRON_RUN_AS_NODE="1"' -c 'mcp_servers.exegol.env.EXEGOL_MCP_TOKEN="${mcpToken}"'`;
        }
      }
    } catch (err) {
      logger.warn("[AgentManager] Failed to wire Exegol MCP config:", err);
    }

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
      // `exec` replaces the shell with the CLI, so the PTY dies WITH the agent.
      // Without it the shell survives the CLI's exit: Exegol never sees onExit,
      // the pane keeps a live shell prompt, and the session ends with no
      // "Ended" card and no Resume — opencode/gemini/kiro all behaved this way
      // (verify 2026-08-12: "en opencode ctrl-C cierra directo, sin resume").
      stdinCommand = `exec ${fullCommand}`;
    } else {
      args = ["-ic", fullCommand];
    }
    env = {
      ...process.env,
      ...shellInitGuards,
      ...apiKeyEnv,
      ...cliConfig.env,
      PATH: _getFullPath(),
      TERM: "xterm-256color",
      EXEGOL_AGENT_ID: agent.id,
      EXEGOL_ACCESS_MODE: config.accessMode ?? "write",
    } as Record<string, string>;
    if (mcpToken) env.EXEGOL_MCP_TOKEN = mcpToken;
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
