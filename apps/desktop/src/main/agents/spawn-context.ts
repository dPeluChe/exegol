import { randomBytes } from "node:crypto";
import type { Agent, AgentAccessMode, AgentCreate } from "@exegol/shared";
import type Database from "libsql";
import { logger } from "../lib/logger";
import { getMcpHost } from "../mcp/host";
import { buildMemoryContext, getMemoriesForInjection } from "../memory/store";
import { discoverSkills } from "../skills/discovery";
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

// ─── T127: Progressive disclosure skills ──────────────────────────────────
//
// Full skill bodies grow linearly with skill count — not viable once a
// project accumulates a dozen skills. Instead, inject only `name`+
// `description` (~100 tokens/skill) with an instruction to read the skill's
// file on demand when the task matches. `always: true` in a skill's
// frontmatter is the escape hatch for tiny critical skills that should
// always be fully inlined (e.g. a 10-line house-style reminder).
export function buildSkillContext(projectPath: string, requestedNames?: string[]): string {
  const requested = new Set(requestedNames ?? []);
  const available = discoverSkills(projectPath).filter((s) => s.available);

  // always-on skills bypass selection entirely — that's the point of the escape hatch.
  const always = available.filter((s) => s.always);
  const disclosed = available.filter((s) => !s.always && requested.has(s.name));

  const parts: string[] = [];

  if (always.length > 0) {
    parts.push(always.map((s) => `## Skill: ${s.name}\n\n${s.content}`).join("\n\n"));
  }

  if (disclosed.length > 0) {
    const pointers = disclosed
      .map((s) => `- **${s.name}**: ${s.description} — read \`${s.filePath}\` when this task matches.`)
      .join("\n");
    parts.push(
      `## Available Skills\n\nUse your read tool to load a skill's file when its description matches the task at hand.\n\n${pointers}`,
    );
  }

  return parts.length > 0 ? `# Skills\n\n${parts.join("\n\n")}\n` : "";
}

/**
 * Build the full context payload (memory, MCP tools, skills) to inject
 * into an agent's task prompt. Each source is non-fatal: a failure logs
 * and yields an empty section, never blocks the spawn.
 *
 * Skills resolve from projectPath — the same root skills.list uses — so the
 * picker in SpawnAgentModal and the injected content always agree, regardless
 * of the worktree the agent runs in.
 */
export function buildSpawnContext(
  db: Database.Database,
  projectId: string,
  config: AgentCreate,
  projectPath: string,
): SpawnContextResult {
  let memoryContext = "";
  let mcpContext = "";
  let skillContext = "";

  try {
    // Bounded by getMemoriesForInjection's token budget (~2000 tokens).
    memoryContext = buildMemoryContext(getMemoriesForInjection(db, projectId));
  } catch (err) {
    logger.warn("[SpawnContext] Failed to build memory context:", err);
  }

  try {
    mcpContext = getMcpHost().buildToolContext();
  } catch (err) {
    logger.warn("[SpawnContext] Failed to build MCP context:", err);
  }

  try {
    skillContext = buildSkillContext(projectPath, config.skillNames);
  } catch (err) {
    logger.warn("[SpawnContext] Failed to build skill context:", err);
  }

  const contextPrefix = [memoryContext, mcpContext, skillContext].filter(Boolean).join("\n");
  return { memoryContext, mcpContext, skillContext, contextPrefix };
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
