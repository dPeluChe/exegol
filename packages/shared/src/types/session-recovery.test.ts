import { describe, expect, it } from "vitest";
import {
  isSessionReconnecting,
  RECOVERY_DONE,
  reconnectingCount,
  reconnectingLabel,
  type SessionRecoveryState,
} from "./session-recovery";

const unplanned: SessionRecoveryState = { done: false, planned: null, ready: [], crashed: [] };
const midway: SessionRecoveryState = {
  done: false,
  planned: ["a", "b", "c"],
  ready: ["a"],
  crashed: [],
};

describe("isSessionReconnecting", () => {
  it("every session waits until the plan is known", () => {
    expect(isSessionReconnecting(unplanned, "a")).toBe(true);
  });

  it("a reattached session is back while the others still wait", () => {
    expect(isSessionReconnecting(midway, "a")).toBe(false);
    expect(isSessionReconnecting(midway, "b")).toBe(true);
  });

  it("a session outside the plan (spawned during recovery) is not reconnecting", () => {
    expect(isSessionReconnecting(midway, "new")).toBe(false);
    expect(isSessionReconnecting(RECOVERY_DONE, "a")).toBe(false);
  });

  it("a TUI still repainting stays reconnecting after recovery is done", () => {
    const done: SessionRecoveryState = { ...midway, done: true, ready: ["a", "c"] };
    expect(isSessionReconnecting(done, "b")).toBe(true);
    expect(isSessionReconnecting(done, "a")).toBe(false);
    expect(isSessionReconnecting({ ...unplanned, done: true }, "a")).toBe(false);
  });

  it("no state yet is not a reconnect (the query has not answered)", () => {
    expect(isSessionReconnecting(undefined, "a")).toBe(false);
  });
});

describe("reconnectingCount", () => {
  it("counts the planned sessions not back yet", () => {
    expect(reconnectingCount(midway)).toBe(2);
  });

  it("is unknown before the plan and zero once done", () => {
    expect(reconnectingCount(unplanned)).toBeNull();
    expect(reconnectingCount(RECOVERY_DONE)).toBe(0);
    expect(reconnectingCount(undefined)).toBe(0);
  });
});

describe("reconnectingLabel", () => {
  it("names the count while known, and nothing once done", () => {
    expect(reconnectingLabel(midway)).toBe("Reconnecting 2 sessions...");
    expect(reconnectingLabel({ ...midway, ready: ["a", "b"] })).toBe("Reconnecting 1 session...");
    expect(reconnectingLabel(unplanned)).toBe("Reconnecting sessions...");
    expect(reconnectingLabel(RECOVERY_DONE)).toBeNull();
  });
});
