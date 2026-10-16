import { describe, expect, it } from "vitest";
import { createSettleTracker } from "./mount-settle";

describe("createSettleTracker", () => {
  it("reports the last grid and when it arrived", () => {
    let t = 100;
    const tracker = createSettleTracker("130x8", () => t);
    t = 120;
    tracker.fit("130x8");
    t = 141;
    tracker.fit("137x6");
    t = 900;
    expect(tracker.report()).toEqual({
      kind: "settle",
      mountGrid: "130x8",
      finalGrid: "137x6",
      afterMs: 41,
      changes: 1,
    });
  });

  it("stays quiet when the mount grid held", () => {
    const tracker = createSettleTracker("80x24", () => 0);
    tracker.fit("80x24");
    expect(tracker.report()).toBeNull();
  });

  it("counts a flap back to the mount grid", () => {
    let t = 0;
    const tracker = createSettleTracker("80x24", () => t);
    t = 10;
    tracker.fit("90x24");
    t = 30;
    tracker.fit("80x24");
    expect(tracker.report()).toMatchObject({ finalGrid: "80x24", afterMs: 30, changes: 2 });
  });
});
