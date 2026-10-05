import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { claudeProjectDir } from "../history/providers/claude-code";
import { dayDirs } from "../history/providers/codex";
import { mapWithConcurrency } from "../lib/concurrency";
import { isInside } from "../system/ports";
import { claudeCacheInput, estimateCost } from "./pricing";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ParsedTokenEntry {
  /** Stable per source record, so a rescan updates the row instead of adding one */
  key: string;
  /** Working directory the record came from (Claude, Codex); aider logs have none */
  cwd?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  toolCallCount: number;
  timestamp: number;
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
  const seen = new Set<string>();
  let lineNo = 0;
  await forEachLine(path, (line) => {
    lineNo++;
    if (!mayCarryClaudeUsage(line)) return;
    try {
      const parsed = extractClaudeTokenUsage(
        JSON.parse(line),
        since,
        `${basename(path)}:${lineNo}`,
      );
      // One line per content block, each repeating the message's usage
      if (parsed && !seen.has(parsed.key)) {
        seen.add(parsed.key);
        entries.push(parsed);
      }
    } catch {
      /* skip */
    }
  });
  return entries;
}

/** With roots, only the folders Claude names after them (or a subfolder of them) */
async function listClaudeFiles(home: string, roots?: string[]): Promise<string[]> {
  const base = join(home, ".claude", "projects");
  const prefixes = roots?.map(claudeProjectDir);
  const files: string[] = [];
  for (const dir of await safeReaddir(base)) {
    if (!dir.isDirectory()) continue;
    if (prefixes && !prefixes.some((p) => dir.name === p || dir.name.startsWith(`${p}-`))) {
      continue;
    }
    for (const f of await safeReaddir(join(base, dir.name))) {
      if (f.name.endsWith(".jsonl")) files.push(join(base, dir.name, f.name));
    }
  }
  return files;
}

const num = (v: unknown): number => (typeof v === "number" ? v : 0);

function extractClaudeTokenUsage(
  entry: Record<string, unknown>,
  since: number,
  fallbackKey: string,
): ParsedTokenEntry | null {
  const ts = getTimestamp(entry);
  if (ts < since) return null;

  // Transcripts nest it: { message: { id, model, usage, content }, requestId }; older logs had it top-level
  const message =
    typeof entry.message === "object" && entry.message !== null
      ? (entry.message as Record<string, unknown>)
      : undefined;
  const source = message?.usage ? message : entry;
  const usage = source.usage as Record<string, unknown> | undefined;
  const hasUsage = typeof usage?.input_tokens === "number";
  const hasCost = typeof entry.costUSD === "number" && typeof entry.inputTokens === "number";
  if (!hasUsage && !hasCost) return null;

  const model = typeof source.model === "string" ? source.model : "unknown";
  const id = typeof source.id === "string" ? source.id : (entry.uuid as string | undefined);
  const requestId = hasUsage && typeof entry.requestId === "string" ? `:${entry.requestId}` : "";
  const shared = {
    key: `claude:${id ? `${id}${requestId}` : fallbackKey}`,
    cwd: typeof entry.cwd === "string" ? entry.cwd : undefined,
    provider: "anthropic",
    model,
    toolCallCount: countToolCalls(source),
    timestamp: ts,
  };
  if (usage && hasUsage) {
    const inputTokens = usage.input_tokens as number;
    const outputTokens = num(usage.output_tokens);
    return {
      ...shared,
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateCost(model, inputTokens + claudeCacheInput(usage), outputTokens),
    };
  }
  // costUSD form (older logs)
  return {
    ...shared,
    inputTokens: entry.inputTokens as number,
    outputTokens: num(entry.outputTokens),
    estimatedCostUsd: entry.costUSD as number,
  };
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
  let cwd: string | undefined;
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
      if (typeof payload.cwd === "string") cwd = payload.cwd;
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
      key: `codex:${basename(path)}`,
      cwd,
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
          key: `aider:cache:${model}`,
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
      key: `aider:history:${match.index}`,
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

/** With roots (a project and its worktrees), only records whose cwd is inside one of them */
export async function scanAllLogs(
  sinceTimestamp: number,
  home = homedir(),
  roots?: string[],
): Promise<{ entries: ParsedTokenEntry[]; parsedFiles: number }> {
  const stats: ScanStats = { parsedFiles: 0, seen: new Set() };
  const [claudeFiles, codexFiles] = await Promise.all([
    listClaudeFiles(home, roots),
    listCodexFiles(home, sinceTimestamp),
  ]);
  const jobs: [string, FileParser][] = [
    ...claudeFiles.map((f): [string, FileParser] => [f, parseClaudeFile]),
    ...codexFiles.map((f): [string, FileParser] => [f, parseCodexSessionFile]),
    // Aider logs carry no cwd, so they cannot belong to a project
    ...(roots ? [] : aiderFiles(home)).map((f): [string, FileParser] => [f, parseAiderFile]),
  ];
  const results = await mapWithConcurrency(jobs, SCAN_CONCURRENCY, ([path, parse]) =>
    scanFile(path, sinceTimestamp, parse, stats),
  );
  // A project scan skips other projects' files: keep theirs until they age out of the window
  for (const [path, hit] of fileCache) {
    if (!stats.seen.has(path) && (!roots || hit.mtimeMs / 1000 < sinceTimestamp)) {
      fileCache.delete(path);
    }
  }
  const entries = results.flat();
  return {
    entries: roots ? entries.filter((e) => roots.some((r) => isInside(e.cwd, r))) : entries,
    parsedFiles: stats.parsedFiles,
  };
}
