import { describe, expect, it } from "vitest";
import type { DiffLine } from "./diff-parser";
import { pairSplitRows } from "./split-rows";

function line(type: DiffLine["type"], oldN: number | null, newN: number | null): DiffLine {
  return { type, content: `${type}-${oldN}-${newN}`, oldLineNumber: oldN, newLineNumber: newN };
}

describe("pairSplitRows", () => {
  it("puts context lines on both sides", () => {
    const ctx = line("context", 1, 1);
    expect(pairSplitRows([ctx])).toEqual([{ left: ctx, right: ctx }]);
  });

  it("lines a deletion run up against the following addition run", () => {
    const d1 = line("deletion", 1, null);
    const d2 = line("deletion", 2, null);
    const a1 = line("addition", null, 1);
    expect(pairSplitRows([d1, d2, a1])).toEqual([
      { left: d1, right: a1 },
      { left: d2, right: null },
    ]);
  });

  it("pads the left side when additions outnumber deletions", () => {
    const d1 = line("deletion", 1, null);
    const a1 = line("addition", null, 1);
    const a2 = line("addition", null, 2);
    expect(pairSplitRows([d1, a1, a2])).toEqual([
      { left: d1, right: a1 },
      { left: null, right: a2 },
    ]);
  });

  it("puts a lone addition on the right and skips header lines", () => {
    const header = line("header", null, null);
    const ctx = line("context", 1, 1);
    const a1 = line("addition", null, 2);
    expect(pairSplitRows([header, ctx, a1])).toEqual([
      { left: ctx, right: ctx },
      { left: null, right: a1 },
    ]);
  });

  it("does not pair an addition run with a later deletion", () => {
    const a1 = line("addition", null, 1);
    const d1 = line("deletion", 1, null);
    expect(pairSplitRows([a1, d1])).toEqual([
      { left: null, right: a1 },
      { left: d1, right: null },
    ]);
  });
});
