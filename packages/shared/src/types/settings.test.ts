import { describe, expect, it } from "vitest";
import { compactDuration } from "../lib/duration";
import { settingsSchema } from "../schemas/settings";

describe("compactDuration", () => {
  it("shows minutes, hours with minutes and days with hours", () => {
    expect(compactDuration(45 * 60_000)).toBe("45m");
    expect(compactDuration(120 * 60_000)).toBe("2h");
    expect(compactDuration(135.9 * 60_000)).toBe("2h 15m");
    expect(compactDuration(26 * 3_600_000)).toBe("1d 2h");
  });
});

describe("stuckTurnAlertMinutes", () => {
  const parse = (m: number) =>
    settingsSchema.partial().safeParse({ stuckTurnAlertMinutes: m }).success;

  it("is off by default", () => {
    expect(settingsSchema.parse({}).stuckTurnAlertMinutes).toBe(0);
  });

  it("takes 0 or 5 minutes to 7 days, whole minutes only", () => {
    expect([0, 5, 90, 10_080].map(parse)).toEqual([true, true, true, true]);
    expect([-1, 3, 10_081, 30.5].map(parse)).toEqual([false, false, false, false]);
  });
});
