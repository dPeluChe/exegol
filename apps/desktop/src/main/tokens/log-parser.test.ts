import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mayCarryClaudeUsage,
  parseClaudeFile,
  parseCodexSessionFile,
  scanAllLogs,
} from "./log-parser";

let home: string;
const now = Math.floor(Date.now() / 1000);
const since = now - 30 * 86400;
const iso = (s: number) => new Date(s * 1000).toISOString();

function claudeLine(input: number, output: number, ts = now - 60): string {
  return JSON.stringify({
    timestamp: iso(ts),
    model: "claude-sonnet-4-6",
    usage: { input_tokens: input, output_tokens: output },
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "exegol-tokens-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("scanAllLogs", () => {
  it("reuses an unchanged file's parse and re-reads it once it grows", async () => {
    const dir = join(home, ".claude", "projects", "p1");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "s.jsonl");
    writeFileSync(file, `${claudeLine(10, 5)}\n{"type":"user","message":"hi"}\n`);

    const first = await scanAllLogs(since, home);
    expect(first.entries.map((e) => e.inputTokens)).toEqual([10]);
    expect(first.parsedFiles).toBe(1);

    const second = await scanAllLogs(since, home);
    expect(second.entries.map((e) => e.inputTokens)).toEqual([10]);
    expect(second.parsedFiles).toBe(0);

    writeFileSync(file, `${claudeLine(10, 5)}\n${claudeLine(20, 7)}\n`);
    const third = await scanAllLogs(since, home);
    expect(third.entries.map((e) => e.inputTokens)).toEqual([10, 20]);
    expect(third.parsedFiles).toBe(1);
  });

  it("skips files last modified before the window", async () => {
    const dir = join(home, ".claude", "projects", "p1");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "old.jsonl");
    writeFileSync(file, `${claudeLine(10, 5, since - 100)}\n`);
    utimesSync(file, since - 100, since - 100);
    expect(await scanAllLogs(since, home)).toEqual({ entries: [], parsedFiles: 0 });
  });
});

describe("parseCodexSessionFile", () => {
  it("keeps only the final cumulative token_count, with the session_meta model", async () => {
    const dir = join(home, ".codex", "sessions", "2026", "10", "04");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "rollout-1.jsonl");
    const count = (input: number, output: number) =>
      JSON.stringify({
        timestamp: iso(now - 30),
        payload: {
          type: "token_count",
          info: { total_token_usage: { input_tokens: input, output_tokens: output } },
        },
      });
    writeFileSync(
      file,
      [
        JSON.stringify({
          type: "session_meta",
          payload: { model: "gpt-5", model_provider: "openai", timestamp: iso(now - 120) },
        }),
        count(100, 10),
        count(250, 40),
      ].join("\n"),
    );
    const entries = await parseCodexSessionFile(file, since);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ model: "gpt-5", inputTokens: 250, outputTokens: 40 });
  });
});

describe("mayCarryClaudeUsage", () => {
  it("lets through every line the extractor could match, and nothing else", () => {
    expect(mayCarryClaudeUsage(claudeLine(1, 1))).toBe(true);
    expect(mayCarryClaudeUsage('{"costUSD":0.1,"inputTokens":3}')).toBe(true);
    expect(mayCarryClaudeUsage('{"type":"user","message":"hello"}')).toBe(false);
  });
});

describe("parseClaudeFile", () => {
  const nested = (id: string, block: string, usage: Record<string, unknown>, requestId = "req_1") =>
    JSON.stringify({
      type: "assistant",
      timestamp: iso(now - 60),
      sessionId: "s1",
      requestId,
      cwd: "/repo",
      message: { id, model: "claude-sonnet-4-6", content: [{ type: block }], usage },
    });

  function write(lines: string[]): string {
    const dir = join(home, ".claude", "projects", "p1");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "s.jsonl");
    writeFileSync(file, `${lines.join("\n")}\n`);
    return file;
  }

  it("reads nested message.usage and counts a message once across its content blocks", async () => {
    const usage = {
      input_tokens: 10,
      output_tokens: 100,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 300_000,
      cache_creation: { ephemeral_5m_input_tokens: 100_000, ephemeral_1h_input_tokens: 200_000 },
    };
    const file = write([
      nested("msg_1", "thinking", usage),
      nested("msg_1", "text", usage),
      nested("msg_1", "tool_use", usage),
      nested("msg_2", "text", { input_tokens: 5, output_tokens: 7 }, "req_2"),
    ]);
    const entries = await parseClaudeFile(file, since);
    expect(entries.map((e) => [e.key, e.inputTokens, e.outputTokens, e.cwd])).toEqual([
      ["claude:msg_1:req_1", 10, 100, "/repo"],
      ["claude:msg_2:req_2", 5, 7, "/repo"],
    ]);
    // Sonnet $3/$15: (10 + 1M x 0.1 + 100k x 1.25 + 200k x 2) at input, 100 at output
    expect(entries[0]?.estimatedCostUsd).toBeCloseTo(
      (10 + 100_000 + 125_000 + 400_000) * 3e-6 + 100 * 15e-6,
    );
  });

  it("still reads the older top-level usage shape", async () => {
    const file = write([claudeLine(10, 5), claudeLine(20, 7)]);
    const entries = await parseClaudeFile(file, since);
    expect(entries.map((e) => [e.model, e.inputTokens, e.outputTokens])).toEqual([
      ["claude-sonnet-4-6", 10, 5],
      ["claude-sonnet-4-6", 20, 7],
    ]);
    expect(new Set(entries.map((e) => e.key)).size).toBe(2);
  });
});
