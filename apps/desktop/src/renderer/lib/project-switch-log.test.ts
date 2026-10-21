import { describe, expect, it } from "vitest";
import {
  createSwitchTracker,
  SWITCH_CAP_MS,
  SWITCH_IDLE_MS,
  type SwitchReport,
} from "./project-switch-log";

function setup() {
  let t = 0;
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  const sent: Array<{ projectId: string; report: SwitchReport }> = [];
  const tracker = createSwitchTracker({
    now: () => t,
    schedule: (fn, ms) => {
      const timer = { at: t + ms, fn, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    send: (projectId, report) => sent.push({ projectId, report }),
  });
  const advance = (to: number) => {
    t = to;
    for (const timer of timers) {
      if (timer.live && timer.at <= t) {
        timer.live = false;
        timer.fn();
      }
    }
  };
  return { tracker, sent, advance };
}

describe("createSwitchTracker", () => {
  it("reports once every mounted view applied its snapshot", () => {
    const { tracker, sent, advance } = setup();
    tracker.start("p1");
    const a = tracker.mounted(true);
    const h1 = tracker.mounted(false);
    const h2 = tracker.mounted(false);
    advance(40);
    a?.({ bytes: 2048, reflow: false });
    advance(90);
    h1?.({ bytes: 4096, reflow: true });
    h1?.({ bytes: 4096, reflow: true });
    expect(sent).toHaveLength(0);
    advance(120);
    h2?.({ bytes: 1024, reflow: false });
    expect(sent).toEqual([
      {
        projectId: "p1",
        report: {
          kind: "switch",
          keptMounts: 0,
          activeMounts: 1,
          hiddenMounts: 2,
          afterMs: 120,
          snapshotBytes: 7168,
          reflows: 1,
          pending: 0,
          ended: "settled",
        },
      },
    ]);
    advance(SWITCH_CAP_MS);
    expect(sent).toHaveLength(1);
  });

  it("times out with what is still pending", () => {
    const { tracker, sent, advance } = setup();
    tracker.start("p1");
    const a = tracker.mounted(true);
    tracker.mounted(false);
    a?.({ bytes: 10, reflow: false });
    advance(SWITCH_CAP_MS);
    expect(sent[0]?.report).toMatchObject({ ended: "timeout", pending: 1, afterMs: SWITCH_CAP_MS });
  });

  it("a view that unmounts before its snapshot stops being waited on", () => {
    const { tracker, sent } = setup();
    tracker.start("p1");
    const v = tracker.mounted(false);
    v?.(null);
    expect(sent[0]?.report).toMatchObject({ ended: "settled", hiddenMounts: 1, pending: 0 });
  });

  it("a project with no terminal reports zero after the idle window", () => {
    const { tracker, sent, advance } = setup();
    tracker.start("p1");
    advance(SWITCH_IDLE_MS);
    expect(sent[0]?.report).toMatchObject({ activeMounts: 0, hiddenMounts: 0, ended: "settled" });
  });

  it("a switch back to a kept project counts the terminals it did not rebuild", () => {
    const { tracker, sent, advance } = setup();
    tracker.start("p1", 4);
    advance(SWITCH_IDLE_MS);
    expect(sent[0]?.report).toMatchObject({
      keptMounts: 4,
      activeMounts: 0,
      hiddenMounts: 0,
      ended: "settled",
    });
  });

  it("a new switch cuts the open one short and ignores its late snapshots", () => {
    const { tracker, sent, advance } = setup();
    tracker.start("p1");
    const late = tracker.mounted(true);
    advance(50);
    tracker.start("p2");
    late?.({ bytes: 99, reflow: false });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ projectId: "p1", report: { ended: "switched", pending: 1 } });
    tracker.start(null);
    expect(sent[1]).toMatchObject({ projectId: "p2", report: { ended: "switched", pending: 0 } });
    expect(tracker.mounted(true)).toBeNull();
  });
});
