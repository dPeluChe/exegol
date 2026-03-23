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
  // Anthropic
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  "claude-sonnet-4-5-20250514": { input: 3, output: 15 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
  "claude-3-opus-20240229": { input: 15, output: 75 },
  // OpenAI
  "gpt-5": { input: 2.5, output: 10 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  o3: { input: 10, output: 40 },
  "o4-mini": { input: 1.1, output: 4.4 },
  // Google
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const costs = MODEL_COSTS[model] ??
    Object.entries(MODEL_COSTS).find(([key]) => model.startsWith(key))?.[1] ?? {
      input: 3,
      output: 15,
    }; // default to Sonnet pricing
  return (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;
}

// ─── Claude Code JSONL Parser ───────────────────────────────────────────────

export function parseClaudeCodeLogs(sinceTimestamp: number): ParsedTokenEntry[] {
  const claudeDir = join(homedir(), ".claude", "projects");
  return parseJsonlDirectory(claudeDir, sinceTimestamp, "anthropic", extractClaudeTokenUsage);
}

function extractClaudeTokenUsage(
  entry: Record<string, unknown>,
  since: number,
): ParsedTokenEntry | null {
  const ts = getTimestamp(entry);
  if (ts < since) return null;

  // Pattern 1: Direct usage field { usage: { input_tokens, output_tokens }, model }
  const usage = entry.usage as Record<string, unknown> | undefined;
  if (usage && typeof usage.input_tokens === "number") {
    const model = (entry.model as string) ?? "unknown";
    const inputTokens = usage.input_tokens as number;
    const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
    return {
      provider: "anthropic",
      model,
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateCost(model, inputTokens, outputTokens),
      toolCallCount: countToolCalls(entry),
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
      outputTokens: typeof entry.outputTokens === "number" ? entry.outputTokens : 0,
      estimatedCostUsd: entry.costUSD as number,
      toolCallCount: countToolCalls(entry),
      timestamp: ts,
    };
  }

  return null;
}

// ─── Codex JSONL Parser (T03) ───────────────────────────────────────────────

/**
 * Parse Codex (OpenAI) session logs from ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 * Token data is in entries with payload.type === "token_count" with
 * payload.info.total_token_usage.{input_tokens, output_tokens, cached_input_tokens}
 * Model/provider comes from session_meta entry.
 */
export function parseCodexLogs(sinceTimestamp: number): ParsedTokenEntry[] {
  const sessionsDir = join(homedir(), ".codex", "sessions");
  const entries: ParsedTokenEntry[] = [];

  // Walk YYYY/MM/DD directory structure
  for (const year of safeReaddir(sessionsDir)) {
    for (const month of safeReaddir(join(sessionsDir, year))) {
      for (const day of safeReaddir(join(sessionsDir, year, month))) {
        const dayDir = join(sessionsDir, year, month, day);
        for (const file of safeReaddir(dayDir).filter((f) => f.endsWith(".jsonl"))) {
          const filePath = join(dayDir, file);
          try {
            if (statSync(filePath).mtimeMs / 1000 < sinceTimestamp) continue;
          } catch {
            continue;
          }
          entries.push(...parseCodexSessionFile(filePath, sinceTimestamp));
        }
      }
    }
  }
  return entries;
}

function parseCodexSessionFile(filePath: string, since: number): ParsedTokenEntry[] {
  const entries: ParsedTokenEntry[] = [];
  let sessionModel = "unknown";
  let sessionProvider = "openai";
  let sessionTimestamp = 0;

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    // First pass: extract session meta (model, provider, timestamp)
    for (const line of lines) {
      try {
        const d = JSON.parse(line) as {
          timestamp?: string;
          type?: string;
          payload?: Record<string, unknown>;
        };
        if (d.type === "session_meta" && d.payload) {
          sessionModel = (d.payload.model as string) ?? "unknown";
          sessionProvider = (d.payload.model_provider as string) ?? "openai";
          if (d.payload.timestamp) {
            const t = new Date(d.payload.timestamp as string);
            sessionTimestamp = Number.isNaN(t.getTime()) ? 0 : t.getTime() / 1000;
          }
          // Also check nested in base_instructions or collaboration_mode for model
          break;
        }
      } catch {
        /* skip */
      }
    }

    // If no model from session_meta, try to find it in response items
    if (sessionModel === "unknown") {
      for (const line of lines) {
        try {
          const d = JSON.parse(line);
          const model = d?.payload?.model;
          if (typeof model === "string" && model.length > 0) {
            sessionModel = model;
            break;
          }
        } catch {
          /* skip */
        }
      }
    }

    if (sessionTimestamp < since) return entries;

    // Second pass: extract token_count entries
    for (const line of lines) {
      try {
        const d = JSON.parse(line) as { timestamp?: string; payload?: Record<string, unknown> };
        const payload = d.payload;
        if (!payload || payload.type !== "token_count") continue;

        const info = payload.info as Record<string, unknown> | undefined;
        if (!info) continue;

        const totalUsage = info.total_token_usage as Record<string, number> | undefined;
        if (!totalUsage || typeof totalUsage.input_tokens !== "number") continue;

        const ts = d.timestamp ? new Date(d.timestamp).getTime() / 1000 : sessionTimestamp;
        if (ts < since) continue;

        entries.push({
          provider: sessionProvider,
          model: sessionModel,
          inputTokens: totalUsage.input_tokens,
          outputTokens: totalUsage.output_tokens ?? 0,
          estimatedCostUsd: estimateCost(
            sessionModel,
            totalUsage.input_tokens,
            totalUsage.output_tokens ?? 0,
          ),
          toolCallCount: 0,
          timestamp: ts,
        });
      } catch {
        /* skip */
      }
    }
  } catch {
    /* unreadable file */
  }

  // Codex reports cumulative totals — we want the LAST entry only (final session total)
  const last = entries[entries.length - 1];
  return last ? [last] : [];
}

// ─── Aider Log Parser (T03) ────────────────────────────────────────────────

/**
 * Parse Aider usage from .aider.chat.history.md files.
 * Aider logs cost/token info in markdown comments like:
 * > Tokens: 12.3k sent, 1.2k received. Cost: $0.04
 */
export function parseAiderLogs(sinceTimestamp: number): ParsedTokenEntry[] {
  const entries: ParsedTokenEntry[] = [];
  const home = homedir();

  // Aider stores history in project directories — scan common locations
  const searchPaths = [
    join(home, ".aider.chat.history.md"),
    join(home, ".aider.token.usage.cache.v1"),
  ];

  for (const filePath of searchPaths) {
    try {
      if (statSync(filePath).mtimeMs / 1000 < sinceTimestamp) continue;
      const content = readFileSync(filePath, "utf-8");

      // Parse token usage cache (JSON format)
      if (filePath.endsWith(".cache.v1")) {
        try {
          const cache = JSON.parse(content) as Record<
            string,
            { sent: number; received: number; cost: number; model?: string }
          >;
          for (const [model, usage] of Object.entries(cache)) {
            if (typeof usage.sent !== "number") continue;
            entries.push({
              provider: guessProvider(model),
              model,
              inputTokens: usage.sent,
              outputTokens: usage.received ?? 0,
              estimatedCostUsd: usage.cost ?? estimateCost(model, usage.sent, usage.received ?? 0),
              toolCallCount: 0,
              timestamp: Math.floor(Date.now() / 1000), // Cache doesn't have per-entry timestamps
            });
          }
        } catch {
          /* malformed cache */
        }
        continue;
      }

      // Parse markdown history for cost lines
      const costPattern = /Tokens: ([\d.]+)k sent, ([\d.]+)k received.*?Cost: \$([\d.]+)/g;
      let match: RegExpExecArray | null;
      for (match = costPattern.exec(content); match !== null; match = costPattern.exec(content)) {
        entries.push({
          provider: "unknown",
          model: "aider-session",
          inputTokens: Math.round(Number.parseFloat(match[1] ?? "0") * 1000),
          outputTokens: Math.round(Number.parseFloat(match[2] ?? "0") * 1000),
          estimatedCostUsd: Number.parseFloat(match[3] ?? "0"),
          toolCallCount: 0,
          timestamp: Math.floor(Date.now() / 1000),
        });
      }
    } catch {
      /* file doesn't exist */
    }
  }

  return entries;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function guessProvider(model: string): string {
  if (model.startsWith("claude") || model.startsWith("anthropic")) return "anthropic";
  if (model.startsWith("gpt") || model.startsWith("o3") || model.startsWith("o4")) return "openai";
  if (model.startsWith("gemini")) return "google";
  return "unknown";
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function parseJsonlDirectory(
  baseDir: string,
  sinceTimestamp: number,
  _defaultProvider: string,
  extractor: (entry: Record<string, unknown>, since: number) => ParsedTokenEntry | null,
): ParsedTokenEntry[] {
  const entries: ParsedTokenEntry[] = [];
  for (const dir of safeReaddir(baseDir)) {
    const projectPath = join(baseDir, dir);
    try {
      if (!statSync(projectPath).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const file of safeReaddir(projectPath).filter((f) => f.endsWith(".jsonl"))) {
      const filePath = join(projectPath, file);
      try {
        if (statSync(filePath).mtimeMs / 1000 < sinceTimestamp) continue;
        const content = readFileSync(filePath, "utf-8");
        for (const line of content.split("\n")) {
          if (!line.trim()) continue;
          try {
            const parsed = extractor(JSON.parse(line), sinceTimestamp);
            if (parsed) entries.push(parsed);
          } catch {
            /* skip */
          }
        }
      } catch {
        /* skip */
      }
    }
  }
  return entries;
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
  const content = entry.content;
  if (Array.isArray(content)) {
    return content.filter(
      (c) =>
        typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "tool_use",
    ).length;
  }
  if (typeof entry.toolCallCount === "number") return entry.toolCallCount;
  return 0;
}

// ─── Aggregate Scanner ──────────────────────────────────────────────────────

export function scanAllLogs(sinceTimestamp: number): ParsedTokenEntry[] {
  const claude = parseClaudeCodeLogs(sinceTimestamp);
  const codex = parseCodexLogs(sinceTimestamp);
  const aider = parseAiderLogs(sinceTimestamp);
  return [...claude, ...codex, ...aider];
}
