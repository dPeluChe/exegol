import type { Agent, AgentCreate } from "@exegol/shared";
import type Database from "libsql";
import { logger } from "../lib/logger";
import { getMcpHost } from "../mcp/host";
import { buildMemoryContext, getMemoriesForInjection } from "../memory/store";
import { discoverSkills } from "../skills/discovery";
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
  db: Database.Database,
  projectId: string,
  config: AgentCreate,
  cwd: string,
): SpawnContextResult {
  // ── Memory context injection ─────────────────────────────────────────
  const relevantMemories = getMemoriesForInjection(db, projectId);
  const memoryContext = buildMemoryContext(relevantMemories);

  // ── MCP tool context injection ──────────────────────────────────────
  const mcpContext = getMcpHost().buildToolContext();

  // ── Skill context injection ─────────────────────────────────────────
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

  const contextPrefix = [memoryContext, mcpContext, skillContext].filter(Boolean).join("\n");

  return { memoryContext, mcpContext, skillContext, contextPrefix };
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
  const fullPrompt = hasTask
    ? contextPrefix
      ? `${contextPrefix}# Task\n\n${agent.taskDescription}`
      : agent.taskDescription
    : contextPrefix || "";

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
  // else: CLI is interactive-only — don't pass any prompt, just launch

  return cmdParts.join(" ");
}
