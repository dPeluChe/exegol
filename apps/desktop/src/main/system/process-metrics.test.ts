import { describe, expect, it } from "vitest";
import { parsePsMetrics } from "./process-metrics";

describe("parsePsMetrics", () => {
  it("reads pid, %CPU and RSS (KB to bytes), skipping short lines", () => {
    const m = parsePsMetrics("  42  98.7  524288\n 7 0.0 1024\n garbage\n");
    expect(m.get(42)).toEqual({ cpu: 98.7, memory: 524288 * 1024 });
    expect(m.get(7)).toEqual({ cpu: 0, memory: 1024 * 1024 });
    expect(m.size).toBe(2);
  });
});
