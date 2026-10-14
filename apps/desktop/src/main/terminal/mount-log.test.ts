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
    expect(stats && formatMountLine("agent-1", stats)).toBe(
      "[TermMount] agent-1 mount snapshot 52431B 12ms grid 108x54 -> 102x54 replayed 3 dropped 2 kick no paint 49ms",
    );
  });

  it("refuses anything that is not a count or a grid (the renderer is untrusted)", () => {
    expect(parseMountStats("agent-1", { ...mount, snapGrid: "/Users/me" })).toBeNull();
    expect(parseMountStats("agent-1", { ...mount, replayed: -1 })).toBeNull();
    expect(parseMountStats("agent-1", { ...mount, kind: "echo hi" })).toBeNull();
    expect(parseMountStats("../x y", mount)).toBeNull();
  });

  it("an unmount is one short line", () => {
    const stats = parseMountStats("a", {
      ...mount,
      kind: "unmount",
      snapGrid: null,
      fitGrid: null,
      paintMs: null,
    });
    expect(stats && formatMountLine("a", stats)).toBe("[TermMount] a unmount");
  });
});
