import { describe, expect, it } from "vitest";
import { claudeWindow, codexWindow } from "./plan-usage";

describe("plan windows", () => {
  it("Claude: utilization in percent and an ISO reset time", () => {
    expect(
      claudeWindow({ utilization: 13, resets_at: "2026-10-05T04:20:00.344413+00:00" }, 300),
    ).toEqual({
      usedPercent: 13,
      resetsAt: Date.parse("2026-10-05T04:20:00.344Z"),
      windowMins: 300,
    });
    expect(claudeWindow(null, 300)).toBeNull();
    expect(claudeWindow({ utilization: null }, 300)).toBeNull();
  });

  it("Codex: a window that reset since its last turn reads empty", () => {
    const now = 1_788_800_000_000;
    expect(
      codexWindow({ used_percent: 79, window_minutes: 300, resets_at: 1_788_900_000 }, now),
    ).toEqual({ usedPercent: 79, resetsAt: 1_788_900_000_000, windowMins: 300 });
    expect(
      codexWindow({ used_percent: 79, window_minutes: 300, resets_at: 1_788_700_000 }, now)
        ?.usedPercent,
    ).toBe(0);
  });
});
