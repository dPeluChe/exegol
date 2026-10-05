import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import type { ParsedTokenEntry } from "../../tokens/log-parser";
import { runMigrations } from "../migrations";
import { getProjectTokenUsageSummary, importScannedTokenUsage } from "./token-usage";

const now = Math.floor(Date.now() / 1000);

const entry = (key: string, input: number, output: number): ParsedTokenEntry => ({
  key,
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  inputTokens: input,
  outputTokens: output,
  estimatedCostUsd: 0.5,
  toolCallCount: 0,
  timestamp: now - 3600,
});

describe("importScannedTokenUsage", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Proj', '/repo')").run();
  });

  it("stores rows under the scan pseudo agent and skips them on a rescan", () => {
    const entries = [entry("claude:m1:r1", 10, 5), entry("claude:m2:r2", 20, 7)];
    expect(importScannedTokenUsage(db, "scan:p1", entries)).toEqual({ imported: 2, skipped: 0 });
    expect(importScannedTokenUsage(db, "scan:p1", entries)).toEqual({ imported: 0, skipped: 2 });

    const summary = getProjectTokenUsageSummary(db, "p1", now - 86400);
    expect(summary).toMatchObject({ totalInputTokens: 30, totalOutputTokens: 12, totalCostUsd: 1 });
    const row = db.prepare("SELECT recorded_at FROM token_usage LIMIT 1").get() as {
      recorded_at: number;
    };
    expect(row.recorded_at).toBe(now - 3600);
  });

  it("updates a record whose totals grew instead of adding a second row", () => {
    importScannedTokenUsage(db, "scan:p1", [entry("codex:rollout-1.jsonl", 100, 10)]);
    expect(
      importScannedTokenUsage(db, "scan:p1", [entry("codex:rollout-1.jsonl", 250, 40)]),
    ).toEqual({ imported: 1, skipped: 0 });
    const rows = db.prepare("SELECT input_tokens, output_tokens FROM token_usage").all();
    expect(rows).toEqual([{ input_tokens: 250, output_tokens: 40 }]);
  });

  it("still removes an agent's usage when the agent is deleted", () => {
    db.prepare(
      `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at)
       VALUES ('a1', 'p1', 'claude-code', 'completed', 't', unixepoch())`,
    ).run();
    db.prepare(
      `INSERT INTO token_usage (id, agent_id, provider, model) VALUES ('t1', 'a1', 'anthropic', 'm')`,
    ).run();
    db.prepare("DELETE FROM agents WHERE id = 'a1'").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM token_usage").get()).toMatchObject({ n: 0 });
  });
});
