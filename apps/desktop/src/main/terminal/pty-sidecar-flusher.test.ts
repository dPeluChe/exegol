import { describe, expect, it } from "vitest";
import { appendPending, MAX_PENDING_BYTES, OVERFLOW_NOTICE } from "./pty-sidecar-flusher";

describe("appendPending (T113 PTY flusher)", () => {
  it("returns the literal concatenation when below cap", () => {
    const r1 = appendPending({ pending: "", pendingBytes: 0 }, "hello ");
    expect(r1.overflowed).toBe(false);
    expect(r1.pending).toBe("hello ");
    expect(r1.pendingBytes).toBe(6);
    const r2 = appendPending({ pending: r1.pending, pendingBytes: r1.pendingBytes }, "world");
    expect(r2.pending).toBe("hello world");
    expect(r2.overflowed).toBe(false);
  });

  it("drops pending and prepends ESC c when an oversized chunk arrives", () => {
    const huge = "x".repeat(MAX_PENDING_BYTES + 10);
    const r = appendPending({ pending: "ZZZZ", pendingBytes: 4 }, huge);
    expect(r.overflowed).toBe(true);
    expect(r.pending.startsWith(OVERFLOW_NOTICE)).toBe(true);
    // 'Z' is not in OVERFLOW_NOTICE — its absence proves we dropped the old buffer.
    expect(r.pending.includes("Z")).toBe(false);
    expect(r.pending.length).toBe(OVERFLOW_NOTICE.length + MAX_PENDING_BYTES);
  });

  it("drops pending when pending + new would exceed cap", () => {
    const halfCap = Math.floor(MAX_PENDING_BYTES / 2) + 1024;
    const r = appendPending(
      { pending: "Z".repeat(halfCap), pendingBytes: halfCap },
      "Q".repeat(halfCap),
    );
    expect(r.overflowed).toBe(true);
    expect(r.pending.startsWith(OVERFLOW_NOTICE)).toBe(true);
    // Z is not in OVERFLOW_NOTICE, so its absence proves we dropped the old buffer.
    expect(r.pending.includes("Z")).toBe(false);
    expect(r.pending.endsWith("Q".repeat(halfCap))).toBe(true);
  });

  it("first bytes after overflow are ESC c (RIS hard reset)", () => {
    const r = appendPending(
      { pending: "\x1b[31mhello\x1b[0m", pendingBytes: 14 },
      "x".repeat(MAX_PENDING_BYTES + 1),
    );
    expect(r.pending.charCodeAt(0)).toBe(0x1b);
    expect(r.pending.charCodeAt(1)).toBe(0x63);
  });

  it("ignores empty data", () => {
    const r = appendPending({ pending: "abc", pendingBytes: 3 }, "");
    expect(r.overflowed).toBe(false);
    expect(r.pending).toBe("abc");
    expect(r.pendingBytes).toBe(3);
  });
});
