import type { Agent, AgentCreate } from "@exegol/shared";
import type Database from "libsql";
import type { AgentProviderRegistry } from "./registry";

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
  // Memory, MCP, and skills will be injected when agents are spawned
  // from the kanban task system with explicit user intent.
  // See: docs/UI_RESTRUCTURE.md Phase 7 (Tasks Kanban)
  return { memoryContext: "", mcpContext: "", skillContext: "", contextPrefix: "" };
}

/**
 * Assemble the full CLI command string from the resolved config, context,
 * and task description. Respects provider capabilities:
 * - supportsPromptArg: pass prompt as positional arg (`claude 'task'`)
 * - promptFlag: pass via flag (`aider --message 'task'`)
 * - neither: launch interactive only (`gemini`)
 */
export function buildShellCommand(
  registry: AgentProviderRegistry,
  agent: Agent,
  cliConfig: { command: string; args: string[] },
  contextPrefix: string,
): string {
  const provider = registry.get(agent.cliType);
  const caps = provider?.capabilities;
  const cmdParts = [cliConfig.command, ...cliConfig.args];

  const isQuickLaunch = registry.isQuickLaunchLabel(agent.taskDescription);
  const hasTask = agent.taskDescription && !isQuickLaunch;

  // Build the full prompt (context + task description)
  // Only inject context when there's an actual task — not for quick-launch
  const fullPrompt = hasTask
    ? contextPrefix
      ? `${contextPrefix}# Task\n\n${agent.taskDescription}`
      : agent.taskDescription
    : "";

  if (!fullPrompt) {
    // No prompt, no context — just launch the CLI
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
  }
  // else: CLI is interactive-only — prompt injected via stdin after spawn (see manager.ts)

  return cmdParts.join(" ");
}

/**
 * Check if a provider needs stdin injection (interactive CLI that doesn't accept prompt args).
 */
export function needsStdinInjection(
  registry: AgentProviderRegistry,
  cliType: string,
  taskDescription: string,
): boolean {
  const provider = registry.get(cliType);
  if (!provider) return false;
  const caps = provider.capabilities;
  if (caps.supportsPromptArg || caps.promptFlag) return false;
  if (registry.isQuickLaunchLabel(taskDescription)) return false;
  return !!taskDescription;
}
