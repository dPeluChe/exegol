import Database from "libsql";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { limitCrossings, monthWindow, setUsageLimit, usageLimitRows } from "./usage-limits";

describe("limitCrossings", () => {
  const limits = { codex: 100 };

  it("announces 80 and 100 once each in a month", () => {
    expect(limitCrossings({ codex: 79 }, limits, {}, "2026-11")).toEqual([]);
    expect(limitCrossings({ codex: 80 }, limits, {}, "2026-11")[0]?.threshold).toBe(80);
    const at = (threshold: 80 | 100) => ({ codex: { month: "2026-11", threshold } });
    expect(limitCrossings({ codex: 90 }, limits, at(80), "2026-11")).toEqual([]);
    expect(limitCrossings({ codex: 100 }, limits, at(80), "2026-11")[0]?.threshold).toBe(100);
    expect(limitCrossings({ codex: 120 }, limits, at(100), "2026-11")).toEqual([]);
  });

  it("starts over the next month", () => {
    const october = { codex: { month: "2026-10", threshold: 100 as const } };
    const crossings = limitCrossings({ codex: 90 }, limits, october, "2026-11");
    expect(crossings).toHaveLength(1);
  });
});

describe("usageLimitRows", () => {
  it("adds this month's priced spend per CLI and keeps a limit with no spend", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'One', '/a')").run();
    const insert = db.prepare(
      `INSERT INTO token_usage (id, project_id, provider, model, input_tokens, output_tokens,
         estimated_cost_usd, cost_source, tool_call_count, recorded_at, source, dedup_key)
       VALUES (?, 'p1', 'x', ?, 1, 1, ?, ?, 0, ?, 'log_scan', ?)`,
    );
    const at = Math.floor(Date.now() / 1000) - 1;
    insert.run("a", "claude-sonnet-4-6", 2, "priced", at, "claude:a");
    insert.run("b", "no-such-model", 3, "priced", at, "claude:b");
    insert.run("c", "gpt-5", 1, "reported", at - 86400 * 40, "codex:old");
    setUsageLimit(db, "aider", 50);

    expect(usageLimitRows(db)).toEqual([
      { cli: "claude-code", limitUsd: null, spentUsd: 2 },
      { cli: "aider", limitUsd: 50, spentUsd: 0 },
    ]);
  });
});

describe("monthWindow", () => {
  it("starts at local midnight on the first", () => {
    const { since, key } = monthWindow(new Date(2026, 0, 15, 12));
    expect(key).toBe("2026-01");
    expect(new Date(since * 1000).getDate()).toBe(1);
    expect(new Date(since * 1000).getHours()).toBe(0);
  });
});
