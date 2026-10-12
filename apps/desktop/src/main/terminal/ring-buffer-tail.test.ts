import { describe, expect, it } from "vitest";
import { continuationBytes, RingBuffer, tailStart } from "./ring-buffer";

describe("RingBuffer UTF-8 boundary (T202)", () => {
  it("a wrap that cuts a character starts the replay at the next one", () => {
    const rb = new RingBuffer(8);
    rb.write(Buffer.from("aaaaaa"));
    rb.write(Buffer.from("€€€"));
    expect(rb.snapshot().toString("utf-8")).toBe("€€");
  });

  it("an oversize write keeps a tail that starts on a character", () => {
    const rb = new RingBuffer(5);
    rb.write(Buffer.from("ñññ"));
    expect(rb.snapshot().toString("utf-8")).toBe("ññ");
  });

  it("continuationBytes counts at most 3", () => {
    expect(continuationBytes(Buffer.from([0x80, 0x80, 0x80, 0x80]))).toBe(3);
    expect(continuationBytes(Buffer.from("abc"))).toBe(0);
  });
});

describe("RingBuffer capped snapshot (T202)", () => {
  it("keeps only the tail, from a line break near the cut", () => {
    const rb = new RingBuffer(1024);
    rb.write(Buffer.from(`${"old line\r\n".repeat(20)}newest\r\n`));
    const snap = rb.snapshot(30).toString("utf-8");
    expect(snap.length).toBeLessThanOrEqual(30);
    expect(snap.endsWith("newest\r\n")).toBe(true);
    expect(snap.startsWith("old line")).toBe(true);
  });

  it("starts at the last screen clear inside the tail", () => {
    const rb = new RingBuffer(1024);
    rb.write(Buffer.from(`${"x".repeat(200)}\x1b[2J\x1b[3Jfresh screen`));
    expect(rb.snapshot(100).toString("latin1")).toBe("\x1b[2J\x1b[3Jfresh screen");
    rb.write(Buffer.from("\x1bcafter reset"));
    expect(rb.snapshot(100).toString("latin1")).toBe("\x1bcafter reset");
  });

  it("a ring under the cap is returned whole", () => {
    const rb = new RingBuffer(1024);
    rb.write(Buffer.from("a\x1bcb"));
    expect(rb.snapshot(100).toString("latin1")).toBe("a\x1bcb");
    expect(rb.snapshot().toString("latin1")).toBe("a\x1bcb");
  });

  it("tailStart: the last clear first, else the first line break within reach", () => {
    expect(tailStart(Buffer.from("ab\ncd\x1bcef"))).toBe(5);
    expect(tailStart(Buffer.from("ab\ncd"))).toBe(3);
    expect(tailStart(Buffer.from([0x80, 0x61]))).toBe(1);
  });
});

describe("RingBuffer sticky modes (T202)", () => {
  it("restores bracketed paste, mouse and a hidden cursor after they were evicted", () => {
    const rb = new RingBuffer(64);
    rb.write(Buffer.from("\x1b[?2004h\x1b[?1000;1006h\x1b[?25l"));
    rb.write(Buffer.from("y".repeat(200)));
    const snap = rb.snapshot().toString("latin1");
    expect(snap.startsWith("\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[?25l")).toBe(true);
  });

  it("follows the last switch, also one split across writes", () => {
    const rb = new RingBuffer(64);
    rb.write(Buffer.from("\x1b[?2004h"));
    rb.write(Buffer.from("text\x1b[?20"));
    rb.write(Buffer.from("04l"));
    expect(rb.snapshot().toString("latin1").startsWith("\x1b[?2004l")).toBe(true);
  });

  it("a split right after ESC is still seen", () => {
    const rb = new RingBuffer(64);
    rb.write(Buffer.from("abc\x1b"));
    rb.write(Buffer.from("[?1049h"));
    expect(rb.isAltScreen).toBe(true);
  });
});

describe("RingBuffer shrinkTo (memory pressure)", () => {
  it("keeps the newest bytes in a smaller allocation and keeps writing", () => {
    const rb = new RingBuffer(64);
    rb.write(Buffer.from("0123456789".repeat(5)));
    expect(rb.shrinkTo(16)).toBe(48);
    expect(rb.capacity).toBe(16);
    expect(rb.snapshot().toString()).toBe("4567890123456789");
    rb.write(Buffer.from("AB"));
    expect(rb.snapshot().toString()).toBe("67890123456789AB");
  });

  it("does nothing when already at or under the size", () => {
    const rb = new RingBuffer(16);
    expect(rb.shrinkTo(32)).toBe(0);
    expect(rb.capacity).toBe(16);
  });
});
