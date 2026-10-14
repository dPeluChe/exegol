import { describe, expect, it } from "vitest";
import { chunksAfterSnapshot, heldBySnapshot, isOnScreen, mountRepaint } from "./live-seq";

describe("chunksAfterSnapshot", () => {
  it("drops the chunks the snapshot holds and keeps the newer ones in order", () => {
    const buffered = [
      { data: "a", seq: 4 },
      { data: "b", seq: 5 },
      { data: "c", seq: 6 },
      { data: "d", seq: 7 },
    ];
    const { replay, dropped } = chunksAfterSnapshot(buffered, 5);
    expect(replay.map((c) => c.data)).toEqual(["c", "d"]);
    expect(dropped).toBe(2);
  });

  it("keeps everything when either side has no seq (legacy or an unknown snapshot)", () => {
    expect(chunksAfterSnapshot([{ data: "a" }, { data: "b", seq: 1 }], 3).replay).toHaveLength(1);
    expect(chunksAfterSnapshot([{ data: "a", seq: 1 }], null).dropped).toBe(0);
    expect(heldBySnapshot(undefined, 9)).toBe(false);
  });

  it("drops a repaint (RIS) chunk the snapshot is at least as new as", () => {
    expect(heldBySnapshot(12, 12)).toBe(true);
    expect(heldBySnapshot(13, 12)).toBe(false);
  });
});

describe("mountRepaint", () => {
  const snap = { cols: 108, rows: 54 };
  it("lets the PTY resize repaint when the box fits another grid", () => {
    expect(mountRepaint({ owner: true, alternate: true, snap, fit: { cols: 102, rows: 54 } })).toBe(
      "resize",
    );
  });

  it("kicks an alt-screen TUI shown again at the same grid, every mount", () => {
    expect(mountRepaint({ owner: true, alternate: true, snap, fit: snap })).toBe("kick");
    expect(mountRepaint({ owner: true, alternate: false, snap, fit: snap })).toBe("none");
  });

  it("never asks from a mirror or a read-only view", () => {
    expect(mountRepaint({ owner: false, alternate: true, snap, fit: snap })).toBe("none");
  });
});

describe("isOnScreen", () => {
  it("needs both an intersecting box and no hidden ancestor", () => {
    expect(isOnScreen(true, true)).toBe(true);
    expect(isOnScreen(true, false)).toBe(false);
    expect(isOnScreen(false, true)).toBe(false);
  });
});
