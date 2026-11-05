import { describe, expect, it } from "vitest";
import { aggregateUsage, type UsageRow } from "./usage-aggregation";

const row = (over: Partial<UsageRow>): UsageRow => ({
  projectId: "p1",
  projectName: "One",
  cli: "claude-code",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  date: "2026-11-01",
  costSource: "priced",
  session: "",
  toolCalls: 3,
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 800,
  cacheWriteTokens: 100,
  costUsd: 1,
  records: 2,
  ...over,
});

const range = { since: 0, until: 100 };

describe("aggregateUsage", () => {
  it("totals tokens, cost and cache hit rate across every breakdown", () => {
    const report = aggregateUsage(
      [
        row({}),
        row({ date: "2026-11-02", costUsd: 2 }),
        row({
          projectId: "p2",
          projectName: "Two",
          cli: "codex",
          provider: "openai",
          model: "gpt-5",
          date: "2026-10-31",
          inputTokens: 500,
          outputTokens: 100,
          cacheReadTokens: 500,
          cacheWriteTokens: 0,
          costUsd: 0.5,
          records: 1,
        }),
      ],
      range,
    );
    expect(report.totals).toMatchObject({
      inputTokens: 700,
      outputTokens: 200,
      cacheReadTokens: 2100,
      cacheWriteTokens: 200,
      totalTokens: 3200,
      costUsd: 3.5,
      records: 5,
      unpriced: { records: 0, tokens: 0 },
    });
    expect(report.totals.cacheHitRate).toBeCloseTo(2100 / 3000);
    expect(report.byProject.map((p) => [p.projectId, p.totalTokens, p.costUsd])).toEqual([
      ["p1", 2100, 3],
      ["p2", 1100, 0.5],
    ]);
    expect(report.byCli.map((c) => c.cli)).toEqual(["claude-code", "codex"]);
    expect(report.byProvider.map((p) => p.provider)).toEqual(["anthropic", "openai"]);
    expect(report.byDay.map((d) => d.date)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
    const sonnet = report.byModel.find((m) => m.model === "claude-sonnet-4-6");
    expect(sonnet).toMatchObject({ listPrice: { input: 3, output: 15 }, costUsd: 3 });
    expect(sonnet?.costPerMTok).toBeCloseTo((3 / 2100) * 1_000_000);
  });

  it("reports a model with no price as unpriced, never as cost 0", () => {
    const report = aggregateUsage(
      [
        row({ model: "mystery-model", costSource: "unpriced", costUsd: 0, records: 3 }),
        row({ costUsd: 2 }),
      ],
      range,
    );
    const mystery = report.byModel.find((m) => m.model === "mystery-model");
    expect(mystery).toMatchObject({
      costUsd: null,
      listPrice: null,
      costPerMTok: null,
      unpriced: { records: 3, tokens: 1050 },
    });
    expect(report.totals).toMatchObject({
      costUsd: 2,
      records: 5,
      unpriced: { records: 3, tokens: 1050 },
    });
    expect(report.byDay[0]).toMatchObject({ costUsd: 2, unpriced: { records: 3 } });
  });

  it("treats an old row stored as priced for a model the table does not price as unpriced", () => {
    const report = aggregateUsage([row({ model: "mystery-model", costUsd: 4 })], range);
    expect(report.totals).toMatchObject({ costUsd: null, unpriced: { records: 2 } });
  });

  it("keeps a cost the log reported even when the model has no price", () => {
    const report = aggregateUsage(
      [row({ cli: "aider", model: "aider-session", costSource: "reported", costUsd: 0.04 })],
      range,
    );
    expect(report.totals).toMatchObject({ costUsd: 0.04, unpriced: { records: 0 } });
    expect(report.byModel[0]).toMatchObject({ listPrice: null, costUsd: 0.04 });
  });

  it("returns an empty report at cost 0 with no hit rate", () => {
    expect(aggregateUsage([], range).totals).toMatchObject({
      costUsd: 0,
      records: 0,
      cacheHitRate: null,
    });
  });

  it("lists sessions heaviest first and leaves rows without one out", () => {
    const { bySession } = aggregateUsage(
      [
        row({ session: "small", inputTokens: 1 }),
        row({ session: "big" }),
        row({ session: "big", date: "2026-11-02" }),
        row({ session: "" }),
      ],
      range,
    );
    expect(bySession.map((s) => s.session)).toEqual(["big", "small"]);
    expect(bySession[0]?.toolCalls).toBe(6);
  });
});
