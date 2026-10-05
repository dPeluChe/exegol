import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import type { ParsedTokenEntry } from "../../tokens/log-parser";
import { runMigrations } from "../migrations";
import { getBudgetUsage } from "./budgets";
import { getProjectTokenUsageSummary, importScannedTokenUsage } from "./token-usage";

const now = Math.floor(Date.now() / 1000);

const entry = (key: string, input: number, output: number, cost = 0.5): ParsedTokenEntry => ({
  key,
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  inputTokens: input,
  outputTokens: output,
  estimatedCostUsd: cost,
  toolCallCount: 0,
  timestamp: now - 3600,
});

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Proj', '/repo')").run();
  db.prepare(
    `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at)
     VALUES ('a1', 'p1', 'claude-code', 'completed', 't', unixepoch())`,
  ).run();
});

const count = () => (db.prepare("SELECT COUNT(*) AS n FROM token_usage").get() as { n: number }).n;

describe("importScannedTokenUsage", () => {
  it("stores rows under the project with no agent and skips them on a rescan", async () => {
    const entries = [entry("claude:m1:r1", 10, 5), entry("claude:m2:r2", 20, 7)];
    expect(await importScannedTokenUsage(db, "p1", entries)).toEqual({ imported: 2, skipped: 0 });
    expect(await importScannedTokenUsage(db, "p1", entries)).toEqual({ imported: 0, skipped: 2 });

    const summary = getProjectTokenUsageSummary(db, "p1", now - 86400);
    expect(summary).toMatchObject({ totalInputTokens: 30, totalOutputTokens: 12, totalCostUsd: 1 });
    expect(getBudgetUsage(db, "p1", "daily")).toMatchObject({ tokens: 42, costUsd: 1 });
    const row = db.prepare("SELECT agent_id, project_id, recorded_at FROM token_usage").get();
    expect(row).toMatchObject({ agent_id: null, project_id: "p1", recorded_at: now - 3600 });
  });

  it("updates a record whose totals or price changed instead of adding a second row", async () => {
    await importScannedTokenUsage(db, "p1", [entry("codex:rollout-1.jsonl", 100, 10)]);
    expect(
      await importScannedTokenUsage(db, "p1", [entry("codex:rollout-1.jsonl", 250, 40)]),
    ).toEqual({ imported: 1, skipped: 0 });
    expect(
      await importScannedTokenUsage(db, "p1", [entry("codex:rollout-1.jsonl", 250, 40, 0.9)]),
    ).toEqual({ imported: 1, skipped: 0 });
    const rows = db.prepare(
      "SELECT input_tokens, output_tokens, estimated_cost_usd FROM token_usage",
    );
    expect(rows.all()).toEqual([{ input_tokens: 250, output_tokens: 40, estimated_cost_usd: 0.9 }]);
  });

  it("imports past one chunk", async () => {
    const many = Array.from({ length: 4500 }, (_, i) => entry(`claude:m${i}`, 1, 1));
    expect(await importScannedTokenUsage(db, "p1", many)).toEqual({ imported: 4500, skipped: 0 });
    expect(count()).toBe(4500);
  });

  it("cascades: an agent's rows go with the agent, scan rows with the project", async () => {
    db.prepare(
      `INSERT INTO token_usage (id, agent_id, provider, model) VALUES ('t1', 'a1', 'anthropic', 'm')`,
    ).run();
    await importScannedTokenUsage(db, "p1", [entry("claude:m1", 1, 1)]);
    db.prepare("DELETE FROM agents WHERE id = 'a1'").run();
    expect(count()).toBe(1);
    db.prepare("DELETE FROM projects WHERE id = 'p1'").run();
    expect(count()).toBe(0);
  });
});

describe("w3_018_token_usage_scan_key", () => {
  it("keeps agent rows and drops the old log_scan rows", () => {
    // Back to the pre-w3_018 table, as a user upgrading has it
    db.exec(`DROP TABLE token_usage;
      CREATE TABLE token_usage (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0.0,
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        recorded_at INTEGER NOT NULL DEFAULT (unixepoch()),
        source TEXT NOT NULL DEFAULT 'agent' CHECK (source IN ('agent', 'log_scan'))
      );
      DELETE FROM _migrations WHERE id = 'w3_018_token_usage_scan_key';`);
    const insert = db.prepare(
      `INSERT INTO token_usage (id, agent_id, provider, model, input_tokens, source)
       VALUES (?, ?, 'anthropic', 'm', ?, ?)`,
    );
    insert.run("agent-row", "a1", 10, "agent");
    insert.run("scan-row", "scan:p1", 20, "log_scan");
    insert.run("external-row", "external", 30, "log_scan");
    insert.run("orphan-row", "gone", 40, "agent");

    runMigrations(db);

    expect(db.prepare("SELECT id, agent_id, project_id, dedup_key FROM token_usage").all()).toEqual(
      [{ id: "agent-row", agent_id: "a1", project_id: null, dedup_key: null }],
    );
    expect(db.prepare("PRAGMA foreign_key_check(token_usage)").all()).toEqual([]);
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'trg_agents_delete_token_usage'").get(),
    ).toBeUndefined();
  });
});
