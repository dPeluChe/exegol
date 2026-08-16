import { describe, expect, it } from "vitest";
import { RingBuffer } from "./ring-buffer";

describe("RingBuffer", () => {
  it("should store and snapshot data within capacity", () => {
    const rb = new RingBuffer(100);
    rb.write(Buffer.from("hello"));
    const snap = rb.snapshot();
    expect(snap.toString("utf-8")).toBe("hello");
    expect(rb.byteLength).toBe(5);
  });

  it("should wrap around when exceeding capacity", () => {
    const rb = new RingBuffer(10);
    rb.write(Buffer.from("0123456789")); // fills exactly, head wraps to 0
    rb.write(Buffer.from("ABCDE")); // writes at positions 0-4
    const snap = rb.snapshot();
    // After fill: head=0. Then ABCDE writes at [0..4], head=5.
    // Snapshot: [head..end] + [0..head] = [5..9] + [0..4] = "56789ABCDE"
    expect(snap.toString("utf-8")).toBe("56789ABCDE");
    expect(rb.byteLength).toBe(10);
  });

  it("should handle data larger than buffer capacity", () => {
    const rb = new RingBuffer(5);
    rb.write(Buffer.from("ABCDEFGHIJ")); // 10 bytes, buffer 5
    const snap = rb.snapshot();
    expect(snap.toString("utf-8")).toBe("FGHIJ"); // keeps tail
    expect(rb.byteLength).toBe(5);
  });

  it("should return empty snapshot when no data written", () => {
    const rb = new RingBuffer(100);
    const snap = rb.snapshot();
    expect(snap.toString("utf-8")).toBe("");
    expect(rb.byteLength).toBe(0);
  });

  it("should handle multiple small writes", () => {
    const rb = new RingBuffer(100);
    rb.write(Buffer.from("hello"));
    rb.write(Buffer.from(" "));
    rb.write(Buffer.from("world"));
    expect(rb.snapshot().toString("utf-8")).toBe("hello world");
    expect(rb.byteLength).toBe(11);
  });

  it("should clear the buffer", () => {
    const rb = new RingBuffer(100);
    rb.write(Buffer.from("data"));
    rb.clear();
    expect(rb.snapshot().toString("utf-8")).toBe("");
    expect(rb.byteLength).toBe(0);
  });

  it("should handle empty writes", () => {
    const rb = new RingBuffer(100);
    rb.write(Buffer.alloc(0));
    expect(rb.byteLength).toBe(0);
  });

  it("should correctly wrap with exact boundary alignment", () => {
    const rb = new RingBuffer(8);
    rb.write(Buffer.from("AABBCCDD")); // fills exactly (8 bytes)
    rb.write(Buffer.from("EEFF")); // wraps from position 0
    expect(rb.snapshot().toString("utf-8")).toBe("CCDDEEFF");
    expect(rb.byteLength).toBe(8);
  });
});

describe("RingBuffer alternate-screen stickiness", () => {
  const ALT_ON = "\x1b[?1049h";
  const ALT_OFF = "\x1b[?1049l";

  it("re-arms the alternate screen even after the switch has been evicted", () => {
    // A full-screen TUI enables it once at startup, then floods the ring.
    const rb = new RingBuffer(64);
    rb.write(Buffer.from(`${ALT_ON}opencode starting`));
    rb.write(Buffer.from("x".repeat(200)));

    const snap = rb.snapshot().toString("latin1");
    expect(snap).not.toContain("opencode starting"); // genuinely evicted
    expect(snap.startsWith(ALT_ON)).toBe(true); // …but the screen is restored
  });

  it("does not re-arm once the app has left the alternate screen", () => {
    const rb = new RingBuffer(64);
    rb.write(Buffer.from(ALT_ON));
    rb.write(Buffer.from(`${ALT_OFF}back at the shell`));
    expect(rb.isAltScreen).toBe(false);
    // The raw content still holds the original switch; what must not happen is
    // us adding a SECOND one on top of it.
    const snap = rb.snapshot().toString("latin1");
    expect(snap.split(ALT_ON).length - 1).toBe(1);
  });

  it("sees a toggle split across two writes", () => {
    const rb = new RingBuffer(64);
    rb.write(Buffer.from("\x1b[?10"));
    rb.write(Buffer.from("49h"));
    expect(rb.isAltScreen).toBe(true);
  });

  it("forgets the mode on clear", () => {
    const rb = new RingBuffer(64);
    rb.write(Buffer.from(ALT_ON));
    rb.clear();
    expect(rb.isAltScreen).toBe(false);
  });
});
