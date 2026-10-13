import { describe, expect, it } from "vitest";
import { createGpuCrashTracker, describeGpuCrash, parseGpuStats } from "./gpu-crash";

const MIN = 60_000;

describe("createGpuCrashTracker", () => {
  it("switches to the DOM renderer on the third crash within 10 minutes", () => {
    const tracker = createGpuCrashTracker();
    expect(tracker.record(0).switched).toBe(false);
    expect(tracker.record(4 * MIN).switched).toBe(false);
    expect(tracker.record(9 * MIN)).toEqual({ recent: 3, switched: true });
    expect(tracker.isDomOnly()).toBe(true);
    expect(tracker.record(9.5 * MIN).switched).toBe(false);
  });

  it("does not count crashes older than the window", () => {
    const tracker = createGpuCrashTracker();
    tracker.record(0);
    tracker.record(5 * MIN);
    expect(tracker.record(11 * MIN)).toEqual({ recent: 2, switched: false });
    expect(tracker.isDomOnly()).toBe(false);
  });
});

describe("parseGpuStats", () => {
  it("accepts counts and rejects anything else", () => {
    expect(parseGpuStats({ views: 3, webgl: 2, capped: false })).toEqual({
      views: 3,
      webgl: 2,
      capped: false,
    });
    expect(parseGpuStats({ views: -1, webgl: 2, capped: false })).toBeNull();
    expect(parseGpuStats({ views: 1.5, webgl: 2, capped: false })).toBeNull();
    expect(parseGpuStats({ views: 1, webgl: 2 })).toBeNull();
    expect(parseGpuStats("x")).toBeNull();
  });
});

describe("describeGpuCrash", () => {
  const stats = [
    { views: 4, webgl: 3, capped: false },
    { views: 1, webgl: 1, capped: false },
  ];

  it("sums the windows' counts and names a recent sleep or display change", () => {
    expect(describeGpuCrash(2, stats, { name: "resume", at: 1_000 }, 31_000)).toBe(
      "2 window(s), 5 terminal view(s), 4 WebGL context(s), resume 30s before",
    );
  });

  it("leaves out an old event", () => {
    expect(describeGpuCrash(1, [], { name: "resume", at: 0 }, 10 * MIN)).toBe(
      "1 window(s), 0 terminal view(s), 0 WebGL context(s), no sleep or display change in the last 2 min",
    );
  });
});
