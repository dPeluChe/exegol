import { describe, expect, it, vi } from "vitest";
import {
  chunksAfterSnapshot,
  createLiveBuffer,
  heldBySnapshot,
  mountRepaint,
  resizeToSnapshot,
} from "./live-seq";

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

  it("keeps everything when either side has no seq (legacy or a snapshot past its deadline)", () => {
    expect(chunksAfterSnapshot([{ data: "a" }, { data: "b", seq: 1 }], 3).replay).toHaveLength(1);
    expect(chunksAfterSnapshot([{ data: "a", seq: 1 }], undefined).dropped).toBe(0);
    expect(heldBySnapshot(undefined, 9)).toBe(false);
  });

  it("drops a repaint (RIS) chunk the snapshot is at least as new as", () => {
    expect(heldBySnapshot(12, 12)).toBe(true);
    expect(heldBySnapshot(13, 12)).toBe(false);
  });
});

describe("createLiveBuffer", () => {
  it("hands back what it holds and starts over", () => {
    const b = createLiveBuffer(10);
    b.push({ data: "abc", seq: 1 });
    b.push({ data: "de", seq: 2 });
    expect(b.take()?.map((c) => c.data)).toEqual(["abc", "de"]);
    expect(b.take()).toEqual([]);
  });

  it("past its cap it keeps nothing and says so once", () => {
    const b = createLiveBuffer(10);
    b.push({ data: "123456" });
    b.push({ data: "789012" });
    b.push({ data: "x" });
    expect(b.take()).toBeNull();
    b.push({ data: "y" });
    expect(b.take()).toEqual([{ data: "y" }]);
  });
});

describe("resizeToSnapshot", () => {
  const terminal = () => ({ cols: 80, rows: 24, resize: vi.fn() });

  it("writes an alt screen at the grid it was drawn at", () => {
    const t = terminal();
    resizeToSnapshot(t, { data: "x", cols: 108, rows: 54, alt: true });
    expect(t.resize).toHaveBeenCalledWith(108, 54);
  });

  it("leaves the normal buffer to the fit (it reflows)", () => {
    const t = terminal();
    resizeToSnapshot(t, { data: "x", cols: 108, rows: 54, alt: false });
    resizeToSnapshot(t, null);
    expect(t.resize).not.toHaveBeenCalled();
  });
});

describe("mountRepaint", () => {
  const snap = { cols: 108, rows: 54 };
  const base = { live: true, alternate: true, firstMount: false, snapshotBytes: 50_000, snap };

  it("lets the PTY resize repaint when the box fits another grid", () => {
    expect(mountRepaint({ ...base, fit: { cols: 102, rows: 54 } })).toBe("resize");
  });

  it("at the same grid kicks an alt screen only on its first mount or when nearly empty", () => {
    expect(mountRepaint({ ...base, fit: snap })).toBe("none");
    expect(mountRepaint({ ...base, firstMount: true, fit: snap })).toBe("kick");
    expect(mountRepaint({ ...base, snapshotBytes: 40, fit: snap })).toBe("kick");
    expect(mountRepaint({ ...base, alternate: false, firstMount: true, fit: snap })).toBe("none");
  });

  it("never asks from a read-only view", () => {
    expect(mountRepaint({ ...base, live: false, firstMount: true, fit: snap })).toBe("none");
  });
});
