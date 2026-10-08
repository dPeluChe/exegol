import type { StorageOtherEntry, StorageRow } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { storageBarSegments, summarizeOther } from "./storage-overview";

const row = (category: StorageRow["category"], bytes: number): StorageRow => ({
  category,
  label: category,
  bytes,
  path: null,
});

const entry = (name: string, bytes: number): StorageOtherEntry => ({
  root: "exegol",
  name,
  bytes,
  isDir: true,
});

describe("storageBarSegments", () => {
  it("gives each non-empty row its share", () => {
    const segments = storageBarSegments([row("models", 750), row("logs", 250), row("other", 0)]);
    expect(segments.map((s) => [s.category, s.percent])).toEqual([
      ["models", 75],
      ["logs", 25],
    ]);
  });

  it("sums to exactly 100 when the shares round", () => {
    const segments = storageBarSegments([row("models", 1), row("logs", 1), row("database", 1)]);
    expect(segments.reduce((a, s) => a + s.percent, 0)).toBeCloseTo(100, 10);
    expect(segments.map((s) => s.percent).sort()).toEqual([33.3, 33.3, 33.4]);
  });

  it("is empty when nothing is used", () => {
    expect(storageBarSegments([row("models", 0)])).toEqual([]);
    expect(storageBarSegments([])).toEqual([]);
  });
});

describe("summarizeOther", () => {
  it("keeps the largest and folds the rest", () => {
    const summary = summarizeOther(
      [entry("a", 10), entry("b", 300), entry("c", 5), entry("d", 40)],
      2,
    );
    expect(summary.top.map((e) => e.name)).toEqual(["b", "d"]);
    expect(summary).toMatchObject({ restCount: 2, restBytes: 15 });
  });

  it("has no rest under the limit", () => {
    expect(summarizeOther([entry("a", 1)], 5)).toEqual({
      top: [entry("a", 1)],
      restCount: 0,
      restBytes: 0,
    });
  });
});
