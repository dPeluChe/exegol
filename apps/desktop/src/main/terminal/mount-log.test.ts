import { describe, expect, it } from "vitest";
import { formatMountLine, parseMountStats } from "./mount-log";

const mount = {
  kind: "mount",
  snapshotBytes: 52_431,
  snapshotMs: 12.4,
  paintMs: 48.6,
  snapGrid: "108x54",
  fitGrid: "102x54",
  replayed: 3,
  dropped: 2,
  kick: false,
};

describe("mount log", () => {
  it("formats sizes, counts and times", () => {
    const stats = parseMountStats("agent-1", mount);
    expect(stats && formatMountLine(stats)).toBe(
      "[TermMount] agent-1 mount snapshot 52431B 12ms grid 108x54 -> 102x54 replayed 3 dropped 2 kick no paint 49ms",
    );
  });

  it("formats a grid that moved after the mount", () => {
    const stats = parseMountStats("agent-1", {
      kind: "settle",
      mountGrid: "130x8",
      finalGrid: "137x6",
      afterMs: 41.6,
      changes: 1,
    });
    expect(stats && formatMountLine(stats)).toBe(
      "[TermMount] agent-1 settled 130x8 -> 137x6 after 42ms (1 change)",
    );
    expect(
      parseMountStats("agent-1", { kind: "settle", mountGrid: "x", finalGrid: "1x1" }),
    ).toBeNull();
  });

  it("refuses anything that is not a count or a grid (the renderer is untrusted)", () => {
    expect(parseMountStats("agent-1", { ...mount, snapGrid: "/Users/me" })).toBeNull();
    expect(parseMountStats("agent-1", { ...mount, replayed: -1 })).toBeNull();
    expect(parseMountStats("agent-1", { ...mount, kind: "echo hi" })).toBeNull();
    expect(parseMountStats("../x y", mount)).toBeNull();
  });

  it("formats a project switch, settled or cut short", () => {
    const sw = {
      kind: "switch",
      keptMounts: 3,
      activeMounts: 1,
      hiddenMounts: 4,
      afterMs: 212.4,
      snapshotBytes: 3_200_000,
      reflows: 2,
      pending: 0,
      ended: "settled",
      webgl: { reused: 3, attached: 1, evicted: 0 },
    };
    const stats = parseMountStats("project-1", sw);
    expect(stats && formatMountLine(stats)).toBe(
      "[ProjectSwitch] project-1 mounted 5 terminals (1 in the active tab, 4 in hidden tabs), 3 already mounted, in 212ms, snapshots 3125 KB, reflows 2, webgl 3 reused, 1 new, 0 evicted",
    );
    const late = parseMountStats("project-1", {
      ...sw,
      afterMs: 3000,
      pending: 3,
      ended: "timeout",
    });
    expect(late && formatMountLine(late)).toContain("timed out after 3000ms with 3 pending,");
    expect(parseMountStats("project-1", { ...sw, ended: "/Users/me" })).toBeNull();
    expect(parseMountStats("project-1", { ...sw, hiddenMounts: "4" })).toBeNull();
    expect(parseMountStats("project-1", { ...sw, keptMounts: -1 })).toBeNull();
    expect(
      parseMountStats("project-1", { ...sw, webgl: { ...sw.webgl, evicted: "x" } }),
    ).toBeNull();
  });

  it("formats a Send to with counts only, and drops anything else", () => {
    const send = {
      kind: "send",
      target: "agent",
      chars: 120,
      lines: 3,
      from: "opened",
      action: "paste",
    };
    const stats = parseMountStats("a", send);
    expect(stats && formatMountLine(stats)).toBe(
      "[SendTo] a (agent) paste: 120 chars, 3 lines, opened selection",
    );
    expect(parseMountStats("a", { ...send, text: "secret", chars: "120" })).toBeNull();
    expect(parseMountStats("a", { ...send, action: "typed" })).toBeNull();
    const extra = parseMountStats("a", { ...send, text: "secret" });
    expect(JSON.stringify(extra)).not.toContain("secret");
  });

  it("formats a glyph atlas churn with counts only, and drops anything else", () => {
    const churn = { kind: "atlas-churn", pages: 16.2, overMs: 412.7, domForMs: 30_000 };
    const stats = parseMountStats("a", churn);
    expect(stats && formatMountLine(stats)).toBe(
      "[TermMount] a glyph atlas churn: 16 pages in 413ms, DOM renderer for 30s",
    );
    expect(parseMountStats("a", { ...churn, pages: -1 })).toBeNull();
    expect(parseMountStats("a", { ...churn, domForMs: "30s" })).toBeNull();
    expect(JSON.stringify(parseMountStats("a", { ...churn, text: "secret" }))).not.toContain(
      "secret",
    );
  });

  it("an unmount is one short line", () => {
    const stats = parseMountStats("a", { kind: "unmount" });
    expect(stats && formatMountLine(stats)).toBe("[TermMount] a unmount");
  });

  it("a mount with no snapshot names no grid", () => {
    const stats = parseMountStats("a", { ...mount, snapGrid: null });
    expect(stats && formatMountLine(stats)).toContain("grid none -> 102x54");
    expect(parseMountStats("a", { ...mount, fitGrid: null })).toBeNull();
  });
});
