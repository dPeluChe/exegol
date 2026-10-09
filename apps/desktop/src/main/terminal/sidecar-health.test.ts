import { describe, expect, it } from "vitest";
import {
  describeProcess,
  PING_BACKOFF_MS,
  pingDelay,
  RateLimiter,
  STALL_AFTER_MS,
  STILL_STALLED_LOG_MS,
  StallWatch,
  stalledCall,
} from "./sidecar-health";

describe("stalledCall", () => {
  it("is null while every call is younger than the threshold", () => {
    expect(stalledCall([1_000, 2_000], 1_000 + STALL_AFTER_MS - 1)).toBeNull();
    expect(stalledCall([], 10_000)).toBeNull();
  });

  it("returns the oldest call's start once it waited long enough", () => {
    expect(stalledCall([5_000, 1_000, 3_000], 1_000 + STALL_AFTER_MS)).toBe(1_000);
  });
});

describe("pingDelay", () => {
  it("backs off 2s, 5s, 10s and stays at 10s", () => {
    expect([0, 1, 2, 3, 9].map(pingDelay)).toEqual([2_000, 5_000, 10_000, 10_000, 10_000]);
    expect(PING_BACKOFF_MS.at(-1)).toBe(10_000);
  });
});

describe("StallWatch", () => {
  it("starts pinging once per stall", () => {
    const w = new StallWatch();
    expect(w.suspect(100)).toBe(true);
    expect(w.suspect(200)).toBe(false);
    expect(w.watching).toBe(true);
  });

  it("a slow call whose ping answers is no stall and reports nothing", () => {
    const w = new StallWatch();
    w.suspect(0);
    expect(w.onPing(true, 3_500)).toEqual({ event: null, next: null });
    expect(w.watching).toBe(false);
    expect(w.stalledSince).toBeNull();
  });

  it("announces on the first unanswered ping, then backs off, then recovers", () => {
    const w = new StallWatch();
    w.suspect(1_000);
    expect(w.onPing(false, 4_000)).toEqual({
      event: { kind: "stalled", forMs: 3_000 },
      next: 2_000,
    });
    expect(w.stalledSince).toBe(1_000);
    expect(w.onPing(false, 6_000)).toEqual({ event: null, next: 5_000 });
    expect(w.onPing(false, 11_000)).toEqual({ event: null, next: 10_000 });
    expect(w.onPing(false, 21_000)).toEqual({ event: null, next: 10_000 });
    expect(w.onPing(true, 31_000)).toEqual({
      event: { kind: "recovered", afterMs: 30_000 },
      next: null,
    });
    expect(w.stalledSince).toBeNull();
    expect(w.suspect(40_000)).toBe(true);
  });

  it("repeats the stall line at most once per STILL_STALLED_LOG_MS", () => {
    const w = new StallWatch();
    w.suspect(0);
    w.onPing(false, 3_000);
    expect(w.onPing(false, 3_000 + STILL_STALLED_LOG_MS - 1).event).toBeNull();
    expect(w.onPing(false, 3_000 + STILL_STALLED_LOG_MS).event).toEqual({
      kind: "still",
      forMs: 3_000 + STILL_STALLED_LOG_MS,
    });
    expect(w.onPing(false, 3_000 + STILL_STALLED_LOG_MS + 10_000).event).toBeNull();
  });

  it("ignores a ping result while not watching", () => {
    expect(new StallWatch().onPing(false, 1)).toEqual({ event: null, next: null });
  });
});

describe("RateLimiter", () => {
  it("allows one per key per interval, and again after reset", () => {
    const r = new RateLimiter(1_000);
    expect(r.allow("session.write", 0)).toBe(true);
    expect(r.allow("session.write", 999)).toBe(false);
    expect(r.allow("session.resize", 999)).toBe(true);
    expect(r.allow("session.write", 1_000)).toBe(true);
    r.reset();
    expect(r.allow("session.write", 1_001)).toBe(true);
  });
});

describe("describeProcess", () => {
  it("formats ps pcpu and rss (KB)", () => {
    expect(describeProcess("  98.7  524288\n")).toBe("98.7% CPU, 512 MB RSS");
    expect(describeProcess("")).toBeNull();
  });
});
