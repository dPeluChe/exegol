import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { dayDirs } from "../history/providers/codex";
import { mapWithConcurrency } from "../lib/concurrency";

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

// ─── Per-file cache ─────────────────────────────────────────────────────────

// A full scan read ~1 GB synchronously (2.1-2.5s main-thread freeze). Logs are
// append-only, so an unchanged mtime + size means the parse is still valid.
interface CachedFile {
  mtimeMs: number;
  size: number;
  since: number;
  entries: ParsedTokenEntry[];
}

const fileCache = new Map<string, CachedFile>();

type FileParser = (path: string, since: number) => Promise<ParsedTokenEntry[]>;

interface ScanStats {
  /** Files parsed, not served from the cache */
  parsedFiles: number;
  seen: Set<string>;
}

async function scanFile(
  path: string,
  since: number,
  parse: FileParser,
  stats: ScanStats,
): Promise<ParsedTokenEntry[]> {
  let info: { mtimeMs: number; size: number };
  try {
    info = await stat(path);
  } catch {
    return [];
  }
  if (info.mtimeMs / 1000 < since) return [];
  stats.seen.add(path);
  const hit = fileCache.get(path);
  if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size && hit.since <= since) {
    return hit.entries.filter((e) => e.timestamp >= since);
  }
  let entries: ParsedTokenEntry[] = [];
  try {
    entries = await parse(path, since);
  } catch {
    /* unreadable file */
  }
  stats.parsedFiles++;
  fileCache.set(path, { mtimeMs: info.mtimeMs, size: info.size, since, entries });
  return entries;
}

/** Streams lines so a 35 MB transcript never sits in memory or blocks one tick */
async function forEachLine(path: string, onLine: (line: string) => void): Promise<void> {
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf-8" }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of lines) onLine(line);
}

// ─── Claude Code JSONL Parser ───────────────────────────────────────────────

/** Only these lines can match extractClaudeTokenUsage; JSON.parse on the rest was most of the cost */
export function mayCarryClaudeUsage(line: string): boolean {
  return line.includes('"input_tokens"') || line.includes('"costUSD"');
}

async function parseClaudeFile(path: string, since: number): Promise<ParsedTokenEntry[]> {
  const entries: ParsedTokenEntry[] = [];
  await forEachLine(path, (line) => {
    if (!mayCarryClaudeUsage(line)) return;
    try {
      const parsed = extractClaudeTokenUsage(JSON.parse(line), since);
      if (parsed) entries.push(parsed);
    } catch {
      /* skip */
    }
  });
  return entries;
}

async function listClaudeFiles(home: string): Promise<string[]> {
  const base = join(home, ".claude", "projects");
  const files: string[] = [];
  for (const dir of await safeReaddir(base)) {
    if (!dir.isDirectory()) continue;
    for (const f of await safeReaddir(join(base, dir.name))) {
      if (f.name.endsWith(".jsonl")) files.push(join(base, dir.name, f.name));
    }
  }
  return files;
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
 * Codex (OpenAI) session logs from ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
 * Token data is in entries with payload.type === "token_count" with
 * payload.info.total_token_usage.{input_tokens, output_tokens}; the model and
 * provider come from the session_meta entry.
 */
async function listCodexFiles(home: string, since: number): Promise<string[]> {
  const dirs = await dayDirs(join(home, ".codex", "sessions"), since);
  const perDay = await Promise.all(
    dirs.map(async (dir) =>
      (await safeReaddir(dir))
        .filter((f) => f.name.endsWith(".jsonl"))
        .map((f) => join(dir, f.name)),
    ),
  );
  return perDay.flat();
}

/** Codex reports cumulative totals: only the LAST token_count (the session total) counts */
export async function parseCodexSessionFile(
  path: string,
  since: number,
): Promise<ParsedTokenEntry[]> {
  let metaSeen = false;
  let metaModel: string | null = null;
  let fallbackModel: string | null = null;
  let sessionProvider = "openai";
  let sessionTimestamp = 0;
  // A holder, not a `let`: TS would keep a closure-assigned local narrowed to null
  const last: { value: { input: number; output: number; timestamp?: string } | null } = {
    value: null,
  };

  await forEachLine(path, (line) => {
    const isMeta = !metaSeen && line.includes('"session_meta"');
    const isCount = line.includes('"token_count"');
    if (!isMeta && !isCount && !(fallbackModel === null && line.includes('"model"'))) return;
    let d: { timestamp?: string; type?: string; payload?: Record<string, unknown> };
    try {
      d = JSON.parse(line);
    } catch {
      return;
    }
    const payload = d.payload;
    if (fallbackModel === null && typeof payload?.model === "string" && payload.model.length > 0) {
      fallbackModel = payload.model;
    }
    if (!metaSeen && d.type === "session_meta" && payload) {
      metaSeen = true;
      metaModel = (payload.model as string) ?? null;
      sessionProvider = (payload.model_provider as string) ?? "openai";
      if (payload.timestamp) {
        const t = new Date(payload.timestamp as string);
        sessionTimestamp = Number.isNaN(t.getTime()) ? 0 : t.getTime() / 1000;
      }
      return;
    }
    if (payload?.type !== "token_count") return;
    const info = payload.info as Record<string, unknown> | undefined;
    const usage = info?.total_token_usage as Record<string, number> | undefined;
    if (usage && typeof usage.input_tokens === "number") {
      last.value = {
        input: usage.input_tokens,
        output: usage.output_tokens ?? 0,
        timestamp: d.timestamp,
      };
    }
  });

  if (sessionTimestamp < since || !last.value) return [];
  const { input: inputTokens, output: outputTokens, timestamp } = last.value;
  const ts = timestamp ? new Date(timestamp).getTime() / 1000 : sessionTimestamp;
  if (ts < since) return [];
  const model = metaModel ?? fallbackModel ?? "unknown";
  return [
    {
      provider: sessionProvider,
      model,
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateCost(model, inputTokens, outputTokens),
      toolCallCount: 0,
      timestamp: ts,
    },
  ];
}

// ─── Aider Log Parser (T03) ────────────────────────────────────────────────

/**
 * Aider usage from ~/.aider.chat.history.md and its token cache. The history
 * logs cost lines like: > Tokens: 12.3k sent, 1.2k received. Cost: $0.04
 */
function aiderFiles(home: string): string[] {
  return [join(home, ".aider.chat.history.md"), join(home, ".aider.token.usage.cache.v1")];
}

async function parseAiderFile(filePath: string): Promise<ParsedTokenEntry[]> {
  const entries: ParsedTokenEntry[] = [];
  const content = await readFile(filePath, "utf-8");
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
    return entries;
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
  return entries;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function guessProvider(model: string): string {
  if (model.startsWith("claude") || model.startsWith("anthropic")) return "anthropic";
  if (model.startsWith("gpt") || model.startsWith("o3") || model.startsWith("o4")) return "openai";
  if (model.startsWith("gemini")) return "google";
  return "unknown";
}

async function safeReaddir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
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

/** Few enough open streams that parsing still interleaves with PTY output */
const SCAN_CONCURRENCY = 4;

export async function scanAllLogs(
  sinceTimestamp: number,
  home = homedir(),
): Promise<{ entries: ParsedTokenEntry[]; parsedFiles: number }> {
  const stats: ScanStats = { parsedFiles: 0, seen: new Set() };
  const [claudeFiles, codexFiles] = await Promise.all([
    listClaudeFiles(home),
    listCodexFiles(home, sinceTimestamp),
  ]);
  const jobs: [string, FileParser][] = [
    ...claudeFiles.map((f): [string, FileParser] => [f, parseClaudeFile]),
    ...codexFiles.map((f): [string, FileParser] => [f, parseCodexSessionFile]),
    ...aiderFiles(home).map((f): [string, FileParser] => [f, parseAiderFile]),
  ];
  const results = await mapWithConcurrency(jobs, SCAN_CONCURRENCY, ([path, parse]) =>
    scanFile(path, sinceTimestamp, parse, stats),
  );
  for (const path of fileCache.keys()) if (!stats.seen.has(path)) fileCache.delete(path);
  return { entries: results.flat(), parsedFiles: stats.parsedFiles };
}
