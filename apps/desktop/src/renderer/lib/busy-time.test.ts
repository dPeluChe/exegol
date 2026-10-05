import { describe, expect, it } from "vitest";
import { isLongWait, longestWorking, nextActivitySince, turnTime } from "./busy-time";

const now = 1_000_000_000;
const ago = (s: number) => now - s * 1000;
const busy = (s: number) => ({
  status: "running" as const,
  activityLevel: "busy" as const,
  activitySince: ago(s),
});
const waiting = (s: number) => ({
  status: "waiting_input" as const,
  activityLevel: "idle" as const,
  activitySince: ago(s),
});

describe("turnTime", () => {
  it("reports a busy session as working since the level changed", () => {
    expect(turnTime(busy(840), now)).toEqual({ state: "working", seconds: 840 });
  });

  it("reports an idle session as waiting", () => {
    expect(turnTime(waiting(180), now)).toEqual({ state: "waiting", seconds: 180 });
  });

  it("has no time for neutral or unstamped sessions, and never goes negative", () => {
    expect(turnTime({ status: "idle", activityLevel: "neutral", activitySince: ago(5) }, now)).toBe(
      null,
    );
    expect(turnTime({ status: "running", activityLevel: "busy" }, now)).toBe(null);
    expect(turnTime(busy(-5), now)?.seconds).toBe(0);
  });
});

describe("longestWorking", () => {
  it("takes the longest working turn and ignores waiting ones", () => {
    expect(longestWorking([busy(60), busy(840), waiting(9999)], now)).toBe(840);
    expect(longestWorking([waiting(9999)], now)).toBe(null);
  });
});

describe("isLongWait", () => {
  it("flags a waiting_input session after 5 minutes only", () => {
    expect(isLongWait(waiting(299), now)).toBe(false);
    expect(isLongWait(waiting(300), now)).toBe(true);
    expect(
      isLongWait({ status: "paused", activityLevel: "idle", activitySince: ago(9999) }, now),
    ).toBe(false);
  });
});

describe("nextActivitySince", () => {
  it("keeps the start while the level holds and restarts it on a change", () => {
    const prev = { activityLevel: "busy" as const, activitySince: ago(100) };
    expect(nextActivitySince(prev, "busy", now)).toBe(ago(100));
    expect(nextActivitySince(prev, "idle", now)).toBe(now);
    expect(nextActivitySince(undefined, "busy", now)).toBe(now);
    expect(nextActivitySince({ activityLevel: "busy" }, "busy", now)).toBe(now);
  });
});
