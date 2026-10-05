import { describe, expect, it, vi } from "vitest";
import {
  expectReattach,
  getRecoveryState,
  settleAllReattach,
  settleReattach,
  whenSessionReady,
} from "./reattach-gate";

describe("reattach gate", () => {
  it("nothing is known before recovery plans the reattach", () => {
    expect(getRecoveryState()).toEqual({ done: false, planned: null, ready: [], crashed: [] });
  });

  it("a pane waits for its own session, however long the others take", async () => {
    expectReattach(["a", "b"]);
    expect(getRecoveryState()).toEqual({
      done: false,
      planned: ["a", "b"],
      ready: [],
      crashed: [],
    });
    let aReady = false;
    let bReady = false;
    const a = whenSessionReady("a").then(() => {
      aReady = true;
    });
    const b = whenSessionReady("b").then(() => {
      bReady = true;
    });
    settleReattach("a");
    await a;
    expect(aReady).toBe(true);
    expect(bReady).toBe(false);
    expect(getRecoveryState().ready).toEqual(["a"]);
    settleAllReattach(["gone"]);
    await b;
    expect(bReady).toBe(true);
    expect(getRecoveryState()).toEqual({
      done: true,
      planned: ["a", "b"],
      ready: ["a", "b"],
      crashed: ["gone"],
    });
  });

  it("a session not being reattached answers at once", async () => {
    await expect(whenSessionReady("new-agent")).resolves.toBeUndefined();
  });
});

describe("reattach order", () => {
  it("sessions a pane waits on go first, before and after the plan is set", async () => {
    vi.resetModules();
    const gate = await import("./reattach-gate");
    void gate.whenSessionReady("c");
    gate.expectReattach(["a", "b", "c", "d"]);
    void gate.whenSessionReady("d");
    expect([gate.nextReattach(), gate.nextReattach(), gate.nextReattach()]).toEqual([
      "c",
      "d",
      "a",
    ]);
    gate.settleAllReattach();
    await expect(gate.whenRecovered()).resolves.toBeUndefined();
    expect(gate.nextReattach()).toBeUndefined();
  });
});
