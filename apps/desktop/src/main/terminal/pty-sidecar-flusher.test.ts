import { describe, expect, it } from "vitest";
import {
  appendPending,
  fillsQueue,
  type GatePause,
  MAX_PENDING_BYTES,
  OutputGate,
  OVERFLOW_NOTICE,
  SESSION_BACKLOG_BYTES,
} from "./pty-sidecar-flusher";

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

  it("counts multibyte output in UTF-8 bytes, not UTF-16 units", () => {
    const r = appendPending({ pending: "", pendingBytes: 0 }, "ñ—🙂");
    expect(r.pendingBytes).toBe(2 + 3 + 4);
  });

  it("overflows on bytes and keeps a tail that starts on a character", () => {
    const data = "é".repeat(MAX_PENDING_BYTES / 2 + 1);
    const r = appendPending({ pending: "", pendingBytes: 0 }, data);
    expect(r.overflowed).toBe(true);
    expect(r.pending.slice(OVERFLOW_NOTICE.length)).toBe("é".repeat(MAX_PENDING_BYTES / 2));
  });
});

describe("OutputGate (per-session backpressure)", () => {
  function fakeClient(accepts: boolean) {
    const client = {
      accepts,
      written: [] as string[],
      drain: null as null | (() => void),
      write: (d: string) => {
        client.written.push(d);
        return client.accepts;
      },
      once: (_e: "drain", fn: () => void) => {
        client.drain = fn;
      },
    };
    return client;
  }

  function gateWithLog() {
    const events: string[] = [];
    const resumed: GatePause[] = [];
    let now = 1000;
    const gate = new OutputGate<ReturnType<typeof fakeClient>>(
      (id) => events.push(`pause ${id}`),
      (p) => {
        events.push(`resume ${p.id}`);
        resumed.push(p);
      },
      () => now,
    );
    return { gate, events, resumed, advance: (ms: number) => (now += ms) };
  }

  it("pauses only the session whose output filled the queue; the others keep flowing", () => {
    const { gate, events, resumed, advance } = gateWithLog();
    const slow = fakeClient(false);
    const healthy = fakeClient(true);
    gate.send([slow, healthy], "flood", "a", 40_000);
    gate.send([slow, healthy], "k", "b", 1);
    gate.send([slow, healthy], "e", "b", 1);
    expect(events).toEqual(["pause a"]);
    expect(gate.isPaused("b")).toBe(false);
    expect(slow.written).toEqual(["flood", "k", "e"]);
    expect(healthy.written).toEqual(["flood", "k", "e"]);
    advance(1500);
    slow.drain?.();
    expect(events).toEqual(["pause a", "resume a"]);
    expect(resumed).toEqual([{ id: "a", bytes: 40_000, ms: 1500 }]);
    expect(gate.backedUp).toBe(false);
  });

  it("a second session is paused once its own backlog passes the limit", () => {
    const { gate, events } = gateWithLog();
    const slow = fakeClient(false);
    gate.send([slow], "x", "a", 5000);
    gate.send([slow], "y", "b", SESSION_BACKLOG_BYTES - 1);
    expect(events).toEqual(["pause a"]);
    gate.send([slow], "z", "b", 1);
    expect(events).toEqual(["pause a", "pause b"]);
  });

  it("output with no session (exit notices) never pauses anyone", () => {
    const { gate, events } = gateWithLog();
    const slow = fakeClient(false);
    gate.send([slow], "exit");
    expect(gate.backedUp).toBe(true);
    expect(events).toEqual([]);
  });

  it("a closed client releases the pause once; a forgotten session is not resumed", () => {
    const { gate, events } = gateWithLog();
    const slow = fakeClient(false);
    gate.send([slow], "a", "a", 2000);
    gate.send([slow], "b", "b", SESSION_BACKLOG_BYTES);
    gate.forget("b");
    gate.release(slow);
    gate.release(slow);
    expect(events).toEqual(["pause a", "pause b", "resume a"]);
  });

  it("an echo frame that crosses the mark is not the flood", () => {
    const { gate, events } = gateWithLog();
    const slow = fakeClient(false);
    gate.send([slow], "k", "typing", 3);
    expect(events).toEqual([]);
    gate.send([slow], "flood", "build", 64_000);
    expect(events).toEqual(["pause build"]);
  });

  it("fillsQueue: a failed write of real size, or a full share", () => {
    expect(fillsQueue(5000, true, 5000)).toBe(true);
    expect(fillsQueue(3, true, 3)).toBe(false);
    expect(fillsQueue(SESSION_BACKLOG_BYTES, false, 10)).toBe(true);
    expect(fillsQueue(SESSION_BACKLOG_BYTES - 1, false, 10)).toBe(false);
  });
});
