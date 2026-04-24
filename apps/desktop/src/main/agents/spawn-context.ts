import { randomBytes } from "node:crypto";
import type { Agent, AgentAccessMode, AgentCreate } from "@exegol/shared";
import type Database from "libsql";
import type { AgentProviderRegistry } from "./registry";

// ─── T58: Access mode system prompts ──────────────────────────────────────

const ACCESS_MODE_PREFIXES: Record<string, string> = {
  read: "[IMPORTANT: READ-ONLY MODE] You are running in explore-only mode. Do NOT write, edit, or create any files. Only read, search, and analyze the codebase. Report your findings but make no changes.\n\n",
  plan: "[IMPORTANT: PLAN-ONLY MODE] You are running in plan mode. Analyze the codebase and produce a detailed implementation plan, but do NOT write, edit, or create any files. Output your plan as structured text.\n\n",
};

interface SpawnContextResult {
  memoryContext: string;
  mcpContext: string;
  skillContext: string;
  contextPrefix: string;
}

/**
 * Build the full context payload (memory, MCP tools, skills) to inject
 * into an agent's task prompt.
 */
export function buildSpawnContext(
  _db: Database.Database,
  _projectId: string,
  _config: AgentCreate,
  _cwd: string,
): SpawnContextResult {
  // TODO: Context injection disabled until task pipeline is implemented.
  return { memoryContext: "", mcpContext: "", skillContext: "", contextPrefix: "" };
}

/**
 * Assemble the full CLI command string from the resolved config, context,
 * and task description. Respects provider capabilities:
 * - supportsPromptArg: pass prompt as positional arg (`claude 'task'`)
 * - promptFlag: pass via flag (`aider --message 'task'`)
 * - neither (interactive): heredoc stdin injection (`gemini "$(cat <<'DELIM'\n...\nDELIM\n)"`)
 *
 * Heredoc pattern inspired by Superset's agent-command.ts.
 */
export function buildShellCommand(
  registry: AgentProviderRegistry,
  agent: Agent,
  cliConfig: { command: string; args: string[] },
  contextPrefix: string,
  accessMode?: AgentAccessMode,
): string {
  const provider = registry.get(agent.cliType);
  const caps = provider?.capabilities;
  const cmdParts = [cliConfig.command, ...cliConfig.args];

  const isQuickLaunch = registry.isQuickLaunchLabel(agent.taskDescription);
  const hasTask = agent.taskDescription && !isQuickLaunch;

  // T58: Prepend access mode instruction to prompt
  const modePrefix = accessMode ? (ACCESS_MODE_PREFIXES[accessMode] ?? "") : "";

  const fullPrompt = hasTask
    ? `${modePrefix}${contextPrefix ? `${contextPrefix}# Task\n\n` : ""}${agent.taskDescription}`
    : modePrefix || "";

  if (!fullPrompt) {
    return cmdParts.join(" ");
  }

  // Shell-escape the prompt
  const escaped = fullPrompt.replace(/'/g, "'\\''");

  if (caps?.promptFlag) {
    // Use the specific flag (e.g. --message for Aider)
    cmdParts.push(caps.promptFlag, `'${escaped}'`);
  } else if (caps?.supportsPromptArg) {
    // Pass as positional argument
    cmdParts.push(`'${escaped}'`);
  } else {
    // Interactive CLI: use heredoc to pipe prompt via stdin
    // This works for Gemini, OpenCode, Kiro, etc.
    const delimiter = `EXEGOL_PROMPT_${randomBytes(4).toString("hex")}`;
    const base = cmdParts.join(" ");
    return `${base} "$(cat <<'${delimiter}'\n${fullPrompt}\n${delimiter}\n)"`;
  }

  return cmdParts.join(" ");
}
