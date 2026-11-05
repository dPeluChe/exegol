import { describe, expect, it } from "vitest";
import {
  FROZEN_MS,
  firstAlert,
  type StuckContext,
  type StuckSession,
  stuckTitle,
  stuckVerdict,
} from "./stuck-turn";

const MIN = 60_000;
const NOW = 1_000 * 60 * MIN;

const session = (over: Partial<StuckSession> = {}): StuckSession => ({
  id: "a1",
  cliType: "claude-code",
  muted: false,
  driven: false,
  startedAt: 0,
  statusChangedAt: NOW - 5 * MIN,
  ...over,
});

const ctx = (over: Partial<StuckContext> = {}): StuckContext => ({
  now: NOW,
  limitMinutes: 60,
  since: 0,
  turnStartedAt: () => undefined,
  msSinceOutput: () => 1_000,
  needsUser: () => false,
  ...over,
});

describe("stuckVerdict", () => {
  it("says nothing while Off or under the limit with output flowing", () => {
    const long = session({ statusChangedAt: NOW - 3 * 60 * MIN });
    expect(stuckVerdict(long, ctx({ limitMinutes: 0 }))).toBeNull();
    expect(stuckVerdict(session(), ctx())).toBeNull();
  });

  it("flags a turn past the limit", () => {
    const v = stuckVerdict(session({ statusChangedAt: NOW - 61 * MIN }), ctx());
    expect(v).toEqual({ reason: "limit", turnStart: NOW - 61 * MIN, runningMs: 61 * MIN });
  });

  it("a turn_started while already running starts the clock again", () => {
    const s = session({ statusChangedAt: NOW - 90 * MIN });
    expect(stuckVerdict(s, ctx({ turnStartedAt: () => NOW - 20 * MIN }))).toBeNull();
  });

  it("flags silence past 10 minutes as no output", () => {
    const s = session({ statusChangedAt: NOW - 30 * MIN });
    const v = stuckVerdict(s, ctx({ msSinceOutput: () => FROZEN_MS }));
    expect(v?.reason).toBe("no output");
  });

  it("silence counts only from the turn start and from when main started watching", () => {
    const quiet = { msSinceOutput: () => Number.POSITIVE_INFINITY };
    expect(stuckVerdict(session(), ctx(quiet))).toBeNull();
    const old = session({ statusChangedAt: NOW - 40 * MIN });
    expect(stuckVerdict(old, ctx({ ...quiet, since: NOW - 2 * MIN }))).toBeNull();
    expect(stuckVerdict(old, ctx({ ...quiet, since: NOW - 11 * MIN }))?.reason).toBe("no output");
  });

  it("a limit under 10 minutes caps the silence window", () => {
    const s = session({ statusChangedAt: NOW - 4 * MIN });
    const v = stuckVerdict(s, ctx({ limitMinutes: 5, msSinceOutput: () => 5 * MIN }));
    expect(v).toBeNull();
    expect(
      stuckVerdict(session({ statusChangedAt: NOW - 5 * MIN }), ctx({ limitMinutes: 5 })),
    ).toMatchObject({ reason: "limit" });
  });

  it("skips shells, driven, muted and sessions waiting on the user", () => {
    const old = { statusChangedAt: NOW - 5 * 60 * MIN };
    const skipped: StuckSession[] = [
      session({ ...old, cliType: "shell" }),
      session({ ...old, driven: true }),
      session({ ...old, muted: true }),
    ];
    for (const s of skipped) expect(stuckVerdict(s, ctx())).toBeNull();
    expect(stuckVerdict(session(old), ctx({ needsUser: () => true }))).toBeNull();
  });

  it("falls back to the start time without a status change time", () => {
    const s = session({ statusChangedAt: null, startedAt: (NOW - 2 * 60 * MIN) / 1000 });
    expect(stuckVerdict(s, ctx())?.runningMs).toBe(2 * 60 * MIN);
  });
});

describe("firstAlert", () => {
  it("alerts once per turn and again on a new one", () => {
    const alerted = new Map<string, number>();
    expect(firstAlert(alerted, "a", 100)).toBe(true);
    expect(firstAlert(alerted, "a", 100)).toBe(false);
    expect(firstAlert(alerted, "a", 200)).toBe(true);
    expect(firstAlert(alerted, "b", 200)).toBe(true);
  });
});

describe("stuckTitle", () => {
  it("names the agent and how long, nothing else", () => {
    const v = { reason: "limit" as const, turnStart: 0, runningMs: 135 * MIN };
    expect(stuckTitle("Ada", v)).toBe("Ada has been running for 2h 15m");
    expect(stuckTitle("Ada", { ...v, reason: "no output", runningMs: 12 * MIN })).toBe(
      "Ada has shown no output for a while (running 12m)",
    );
  });
});
