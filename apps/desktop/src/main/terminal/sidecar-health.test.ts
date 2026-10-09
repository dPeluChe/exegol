import { describe, expect, it } from "vitest";
import {
  CallTracker,
  describeProcess,
  LATE_TIMER_MS,
  PING_BACKOFF_MS,
  pingDelay,
  pingResult,
  RateLimiter,
  STALL_AFTER_MS,
  STILL_STALLED_LOG_MS,
  StallWatch,
} from "./sidecar-health";

describe("CallTracker", () => {
  it("is not stalled while nothing is pending or an answer came recently", () => {
    const t = new CallTracker();
    expect(t.stalledSince(10_000)).toBeNull();
    t.start(1_000);
    t.start(2_000);
    expect(t.stalledSince(1_000 + STALL_AFTER_MS - 1)).toBeNull();
    expect(t.untilStall(1_000 + STALL_AFTER_MS - 1)).toBe(1);
  });

  it("measures from the last answer, not from each call", () => {
    const t = new CallTracker();
    t.start(1_000);
    t.start(2_000);
    expect(t.stalledSince(1_000 + STALL_AFTER_MS)).toBe(1_000);
    t.settle(true, 5_000);
    expect(t.stalledSince(5_000 + STALL_AFTER_MS - 1)).toBeNull();
    expect(t.stalledSince(5_000 + STALL_AFTER_MS)).toBe(5_000);
  });

  it("a failure is no answer; the count never goes negative", () => {
    const t = new CallTracker();
    t.start(0);
    t.start(0);
    t.settle(false, 9_000);
    expect(t.stalledSince(9_000)).toBe(0);
    t.settle(false, 9_000);
    t.settle(false, 9_000);
    expect(t.inFlight).toBe(0);
    expect(t.stalledSince(20_000)).toBeNull();
  });

  it("Retry's answer restarts the wait", () => {
    const t = new CallTracker();
    t.start(0);
    t.answered(10_000);
    expect(t.stalledSince(10_000 + STALL_AFTER_MS - 1)).toBeNull();
  });
});

describe("pingDelay", () => {
  it("backs off 2s, 5s, 10s and stays at 10s", () => {
    expect([0, 1, 2, 3, 9].map(pingDelay)).toEqual([2_000, 5_000, 10_000, 10_000, 10_000]);
    expect(PING_BACKOFF_MS.at(-1)).toBe(10_000);
  });
});

describe("pingResult", () => {
  it("a timeout counts only when its timer fired on time", () => {
    expect(pingResult(true, 5_000)).toBe("ok");
    expect(pingResult(false, 5)).toBe("failed");
    expect(pingResult(false, LATE_TIMER_MS + 1)).toBe("unknown");
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
    expect(w.onPing("ok", 3_500)).toEqual({ event: null, next: null });
    expect(w.watching).toBe(false);
    expect(w.stalledSince).toBeNull();
  });

  it("announces only on the second failed ping in a row", () => {
    const w = new StallWatch();
    w.suspect(1_000);
    expect(w.onPing("failed", 4_000)).toEqual({ event: null, next: 2_000 });
    expect(w.stalledSince).toBeNull();
    expect(w.onPing("failed", 6_000)).toEqual({
      event: { kind: "stalled", forMs: 5_000 },
      next: 5_000,
    });
    expect(w.stalledSince).toBe(1_000);
  });

  it("one failure then an answer is no stall", () => {
    const w = new StallWatch();
    w.suspect(0);
    w.onPing("failed", 3_000);
    expect(w.onPing("ok", 5_000)).toEqual({ event: null, next: null });
    expect(w.watching).toBe(false);
  });

  it("an unknown ping (main was blocked) neither counts nor resets", () => {
    const w = new StallWatch();
    w.suspect(0);
    w.onPing("failed", 3_000);
    expect(w.onPing("unknown", 5_000)).toEqual({ event: null, next: 2_000 });
    expect(w.onPing("failed", 7_000).event).toEqual({ kind: "stalled", forMs: 7_000 });
  });

  it("recovers only after two answers in a row, so the banner does not flap", () => {
    const w = new StallWatch();
    w.suspect(0);
    w.onPing("failed", 3_000);
    w.onPing("failed", 5_000);
    expect(w.onPing("ok", 10_000)).toEqual({ event: null, next: 2_000 });
    expect(w.stalledSince).toBe(0);
    expect(w.onPing("failed", 12_000).event).toBeNull();
    expect(w.onPing("ok", 20_000).event).toBeNull();
    expect(w.onPing("ok", 22_000)).toEqual({
      event: { kind: "recovered", afterMs: 22_000 },
      next: null,
    });
    expect(w.stalledSince).toBeNull();
    expect(w.suspect(40_000)).toBe(true);
  });

  it("clear() reports a recovery only for an announced stall", () => {
    const w = new StallWatch();
    w.suspect(0);
    expect(w.clear(1_000)).toBeNull();
    w.suspect(0);
    w.onPing("failed", 3_000);
    w.onPing("failed", 5_000);
    expect(w.clear(9_000)).toEqual({ kind: "recovered", afterMs: 9_000 });
    expect(w.watching).toBe(false);
  });

  it("repeats the stall line at most once per STILL_STALLED_LOG_MS", () => {
    const w = new StallWatch();
    w.suspect(0);
    w.onPing("failed", 1_000);
    w.onPing("failed", 3_000);
    expect(w.onPing("failed", 3_000 + STILL_STALLED_LOG_MS - 1).event).toBeNull();
    expect(w.onPing("failed", 3_000 + STILL_STALLED_LOG_MS).event).toEqual({
      kind: "still",
      forMs: 3_000 + STILL_STALLED_LOG_MS,
    });
    expect(w.onPing("failed", 3_000 + STILL_STALLED_LOG_MS + 10_000).event).toBeNull();
  });

  it("ignores a ping result while not watching", () => {
    expect(new StallWatch().onPing("failed", 1)).toEqual({ event: null, next: null });
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
  it("formats CPU and RSS in MB", () => {
    expect(describeProcess({ cpu: 98.66, memory: 512 * 1024 * 1024 })).toBe(
      "98.7% CPU, 512 MB RSS",
    );
  });
});
