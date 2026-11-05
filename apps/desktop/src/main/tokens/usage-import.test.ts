import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { importScannedTokenUsage, listUsageRows } from "../db/queries/token-usage";
import type { ParsedTokenEntry } from "./log-parser";
import { aggregateUsage } from "./usage-aggregation";
import { importWindow, projectForCwd } from "./usage-import";

const NOW = 1_800_000_000;

describe("importWindow", () => {
  it("reads every file in the 30-day window on the first import", () => {
    expect(importWindow(null, NOW)).toEqual({ since: NOW - 30 * 86400, modifiedSince: 0 });
  });

  it("then only files written since the last start, with some overlap", () => {
    const last = { at: NOW - 1800, imported: 1, skipped: 0 };
    expect(importWindow(last, NOW).modifiedSince).toBe(NOW - 1800 - 300);
    const stale = { at: NOW - 90 * 86400, imported: 1, skipped: 0 };
    expect(importWindow(stale, NOW).modifiedSince).toBe(NOW - 30 * 86400);
  });
});

describe("projectForCwd", () => {
  const roots = [
    { projectId: "outer", path: "/code" },
    { projectId: "inner", path: "/code/inner" },
    { projectId: "inner", path: "/wt/inner-a" },
  ];
  it("picks the deepest root holding the folder", () => {
    expect(projectForCwd(roots, "/code/inner/src")).toBe("inner");
    expect(projectForCwd(roots, "/code/other")).toBe("outer");
    expect(projectForCwd(roots, "/wt/inner-a")).toBe("inner");
  });
  it("leaves folders outside every project, and records with none, unassigned", () => {
    expect(projectForCwd(roots, "/codex")).toBeNull();
    expect(projectForCwd(roots, undefined)).toBeNull();
  });
});

describe("import into the app-wide ledger", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    db.prepare(
      "INSERT INTO projects (id, name, path) VALUES ('p1', 'One', '/a'), ('p2', 'Two', '/b')",
    ).run();
  });

  const at = Date.UTC(2026, 10, 1, 12) / 1000;
  const entry = (key: string, cwd: string, over: Partial<ParsedTokenEntry> = {}) => ({
    key,
    cwd,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 80,
    cacheWriteTokens: 10,
    estimatedCostUsd: 0.25,
    costSource: "priced" as const,
    toolCallCount: 0,
    timestamp: at,
    ...over,
  });

  it("stores each session under its project, skips the rest, and aggregates them", async () => {
    const roots = [
      { projectId: "p1", path: "/a" },
      { projectId: "p2", path: "/b" },
    ];
    const entries = [
      entry("claude:1", "/a/src"),
      entry("codex:r.jsonl", "/b", {
        provider: "openai",
        model: "mystery-model",
        costSource: "unpriced",
        estimatedCostUsd: 0,
      }),
      entry("claude:2", "/elsewhere"),
    ];
    const projectOf = (e: ParsedTokenEntry) => projectForCwd(roots, e.cwd);
    expect(await importScannedTokenUsage(db, entries, projectOf)).toEqual({
      imported: 2,
      skipped: 1,
    });
    expect(await importScannedTokenUsage(db, entries, projectOf)).toEqual({
      imported: 0,
      skipped: 3,
    });

    const report = aggregateUsage(listUsageRows(db, at - 10, at + 10), {
      since: at - 10,
      until: at + 10,
    });
    expect(report.byProject.map((p) => [p.projectName, p.costUsd])).toEqual([
      ["One", 0.25],
      ["Two", null],
    ]);
    expect(report.byCli.map((c) => c.cli).sort()).toEqual(["claude-code", "codex"]);
    expect(report.totals).toMatchObject({
      cacheReadTokens: 160,
      costUsd: 0.25,
      unpriced: { records: 1, tokens: 105 },
    });
    expect(listUsageRows(db, at + 1, at + 10)).toEqual([]);
    const inP2 = listUsageRows(db, at - 10, at + 10, "p2").map((r) => r.projectId);
    expect([...new Set(inP2)]).toEqual(["p2"]);
  });
});
