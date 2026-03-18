import type { HandoffSummary } from "@exegol/shared";
import type Database from "libsql";
import { nanoid } from "../db/queries/helpers";

// ─── Handoff DB Queries ─────────────────────────────────────────────────────

export function createHandoff(
  db: Database.Database,
  data: {
    agentId: string;
    goal: string;
    progress: string;
    filesModified: string;
    nextSteps: string;
    criticalContext: string;
  },
): HandoffSummary {
  const id = nanoid();
  db.prepare(
    `INSERT INTO handoffs (id, agent_id, goal, progress, files_modified, next_steps, critical_context)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.agentId,
    data.goal,
    data.progress,
    data.filesModified,
    data.nextSteps,
    data.criticalContext,
  );
  // biome-ignore lint/style/noNonNullAssertion: row was just inserted
  return getHandoff(db, id)!;
}

export function getHandoff(db: Database.Database, id: string): HandoffSummary | null {
  const row = db.prepare("SELECT * FROM handoffs WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapHandoffRow(row) : null;
}

export function getHandoffByAgent(db: Database.Database, agentId: string): HandoffSummary | null {
  const row = db
    .prepare("SELECT * FROM handoffs WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(agentId) as Record<string, unknown> | undefined;
  return row ? mapHandoffRow(row) : null;
}

export function setHandoffSuccessor(
  db: Database.Database,
  handoffId: string,
  successorAgentId: string,
): void {
  db.prepare("UPDATE handoffs SET successor_agent_id = ? WHERE id = ?").run(
    successorAgentId,
    handoffId,
  );
}

function mapHandoffRow(row: Record<string, unknown>): HandoffSummary {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    successorAgentId: (row.successor_agent_id as string) ?? null,
    goal: row.goal as string,
    progress: row.progress as string,
    filesModified: row.files_modified as string,
    nextSteps: row.next_steps as string,
    criticalContext: row.critical_context as string,
    createdAt: row.created_at as number,
  };
}

// ─── Token Limit Detection ──────────────────────────────────────────────────

/**
 * Patterns that indicate an agent has hit or is approaching its context window limit.
 * Inspired by TunaCode's threshold detection + Stoneforge's prompt-driven handoff.
 */
const TOKEN_LIMIT_PATTERNS = [
  // Claude Code
  /context window/i,
  /token limit/i,
  /maximum context/i,
  /conversation is getting long/i,
  /running low on context/i,
  // Aider
  /token limit/i,
  /truncating.*context/i,
  /exceeded.*token/i,
  // Generic
  /context.*exceed/i,
  /out of.*tokens/i,
  /context.*full/i,
];

export function detectTokenLimitWarning(line: string): boolean {
  return TOKEN_LIMIT_PATTERNS.some((pattern) => pattern.test(line));
}

// ─── Handoff Summary Generation ─────────────────────────────────────────────

/**
 * Generate a structured handoff summary from agent scrollback content.
 * Uses TunaCode's structured format: Goal, Progress, Files, Next Steps, Critical Context.
 *
 * This is a heuristic extraction — for LLM-quality summaries, a future
 * version could call a lightweight model (haiku-class).
 */
export function generateHandoffFromScrollback(
  taskDescription: string,
  scrollback: string,
): {
  goal: string;
  progress: string;
  filesModified: string;
  nextSteps: string;
  criticalContext: string;
} {
  // Extract file modifications from scrollback
  const filePatterns = [
    /(?:Edit|Write|Editing|Writing|Modified|Created)\s+[`"]?([^\s`"]+)/gi,
    /Applied edit to\s+(.+)/gi,
  ];
  const files = new Set<string>();
  for (const pattern of filePatterns) {
    for (const match of scrollback.matchAll(pattern)) {
      if (match[1]) files.add(match[1].trim());
    }
  }

  // Extract recent tool calls as progress indicators
  const toolCalls: string[] = [];
  const toolPattern = /\b(Read|Edit|Write|Bash|Glob|Grep|WebFetch)\s*\(/gi;
  for (const match of scrollback.matchAll(toolPattern)) {
    if (match[1]) toolCalls.push(match[1]);
  }

  // Get last ~500 chars as critical context (recent activity)
  const recentContext = scrollback.slice(-500).trim();

  const uniqueTools = [...new Set(toolCalls)];
  const progressSummary =
    uniqueTools.length > 0
      ? `Used tools: ${uniqueTools.join(", ")}. ${toolCalls.length} total tool calls.`
      : "Agent session ended before significant progress.";

  return {
    goal: taskDescription,
    progress: progressSummary,
    filesModified: files.size > 0 ? [...files].join(", ") : "None detected",
    nextSteps:
      "Continue from where the previous agent left off. Review recent changes and verify correctness.",
    criticalContext: recentContext.length > 0 ? recentContext : "No recent context available.",
  };
}

/**
 * Format a handoff summary for injection into a successor agent's task description.
 */
export function formatHandoffForInjection(handoff: HandoffSummary): string {
  return `[HANDOFF from previous agent]

## Goal
${handoff.goal}

## Progress
${handoff.progress}

## Files Modified
${handoff.filesModified}

## Next Steps
${handoff.nextSteps}

## Critical Context
${handoff.criticalContext}

---
Continue the work described above. The previous agent's context window was exhausted.`;
}
