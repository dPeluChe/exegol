import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ParsedTokenEntry {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  toolCallCount: number;
  timestamp: number;
}

// ─── Cost estimation per model (USD per 1M tokens) ──────────────────────────

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  // Older models
  "claude-sonnet-4-5-20250514": { input: 3, output: 15 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
  "claude-3-opus-20240229": { input: 15, output: 75 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Try exact match first, then prefix match
  const costs = MODEL_COSTS[model] ??
    Object.entries(MODEL_COSTS).find(([key]) => model.startsWith(key))?.[1] ?? {
      input: 3,
      output: 15,
    }; // default to Sonnet pricing

  return (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;
}

// ─── Claude Code JSONL Parser ───────────────────────────────────────────────

/**
 * Parse Claude Code JSONL logs from ~/.claude/projects/<project-hash>/
 * Each JSONL file contains conversation entries. We look for entries with
 * usage data (input_tokens, output_tokens).
 */
export function parseClaudeCodeLogs(sinceTimestamp: number): ParsedTokenEntry[] {
  const claudeDir = join(homedir(), ".claude", "projects");
  const entries: ParsedTokenEntry[] = [];

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(claudeDir);
  } catch {
    return entries;
  }

  for (const dir of projectDirs) {
    const projectPath = join(claudeDir, dir);
    try {
      if (!statSync(projectPath).isDirectory()) continue;
    } catch {
      continue;
    }

    // Look for JSONL files in the project directory
    let files: string[];
    try {
      files = readdirSync(projectPath).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = join(projectPath, file);
      try {
        const stat = statSync(filePath);
        // Skip files older than our window
        if (stat.mtimeMs / 1000 < sinceTimestamp) continue;

        const content = readFileSync(filePath, "utf-8");
        for (const line of content.split("\n")) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            const parsed = extractTokenUsage(entry, sinceTimestamp);
            if (parsed) entries.push(parsed);
          } catch {
            // Skip malformed lines
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return entries;
}

/**
 * Extract token usage from a single JSONL entry.
 * Claude Code log entries may have different shapes — we look for common patterns.
 */
function extractTokenUsage(entry: Record<string, unknown>, since: number): ParsedTokenEntry | null {
  // Check timestamp
  const ts = getTimestamp(entry);
  if (ts < since) return null;

  // Pattern 1: Direct usage field { usage: { input_tokens, output_tokens }, model }
  const usage = entry.usage as Record<string, unknown> | undefined;
  if (usage && typeof usage.input_tokens === "number") {
    const model = (entry.model as string) ?? "unknown";
    const inputTokens = usage.input_tokens as number;
    const outputTokens = (usage.output_tokens as number) ?? 0;
    const toolCallCount = countToolCalls(entry);
    return {
      provider: "anthropic",
      model,
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateCost(model, inputTokens, outputTokens),
      toolCallCount,
      timestamp: ts,
    };
  }

  // Pattern 2: costUSD field (newer logs)
  if (typeof entry.costUSD === "number" && typeof entry.inputTokens === "number") {
    const model = (entry.model as string) ?? "unknown";
    return {
      provider: "anthropic",
      model,
      inputTokens: entry.inputTokens as number,
      outputTokens: (entry.outputTokens as number) ?? 0,
      estimatedCostUsd: entry.costUSD as number,
      toolCallCount: countToolCalls(entry),
      timestamp: ts,
    };
  }

  return null;
}

function getTimestamp(entry: Record<string, unknown>): number {
  if (typeof entry.timestamp === "number") return entry.timestamp;
  if (typeof entry.timestamp === "string") {
    const d = new Date(entry.timestamp);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime() / 1000;
  }
  if (typeof entry.createdAt === "number") return entry.createdAt;
  return 0;
}

function countToolCalls(entry: Record<string, unknown>): number {
  // Check for tool_use in content array
  const content = entry.content as unknown[];
  if (Array.isArray(content)) {
    return content.filter(
      (c) =>
        typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "tool_use",
    ).length;
  }
  if (typeof entry.toolCallCount === "number") return entry.toolCallCount;
  return 0;
}

// ─── Aider Log Parser ───────────────────────────────────────────────────────

/**
 * Parse Aider session logs. Aider stores usage in its own format.
 * Looks for .aider.chat.history.md or .aider.input.history files.
 */
export function parseAiderLogs(_sinceTimestamp: number): ParsedTokenEntry[] {
  // Aider logs are less standardized — return empty for now
  // Future: parse ~/.aider.chat.history.md for cost entries
  return [];
}

// ─── Aggregate Scanner ──────────────────────────────────────────────────────

export function scanAllLogs(sinceTimestamp: number): ParsedTokenEntry[] {
  const claude = parseClaudeCodeLogs(sinceTimestamp);
  const aider = parseAiderLogs(sinceTimestamp);
  return [...claude, ...aider];
}
