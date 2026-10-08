import { describe, expect, it, vi } from "vitest";
import { createFrameReader } from "./frame-reader";
import { createNdjsonBuffer } from "./ndjson";

function feedInChunks(feed: (b: Buffer) => void, text: string, size: number) {
  const buf = Buffer.from(text);
  for (let i = 0; i < buf.length; i += size) feed(buf.subarray(i, i + size));
}

describe("createFrameReader", () => {
  it("joins a frame split across chunks, multibyte characters included", () => {
    const got: unknown[] = [];
    const feed = createFrameReader((m) => got.push(m), vi.fn(), 1_000_000);
    const data = "acentos ñ ✻ \u001b[31m".repeat(500);
    feedInChunks(feed, `${JSON.stringify({ id: 1, data })}\n{"id":2}\n`, 7);
    expect(got).toEqual([{ id: 1, data }, { id: 2 }]);
  });

  it("reads several frames from one chunk and skips a malformed one", () => {
    const got: unknown[] = [];
    const feed = createFrameReader((m) => got.push(m), vi.fn(), 1000);
    feed(Buffer.from('{"a":1}\nnot json\n\n{"b":2}\n{"c"'));
    feed(Buffer.from(":3}\n"));
    expect(got).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("drops an oversized frame once and resumes at the next newline", () => {
    const got: unknown[] = [];
    const overflow = vi.fn();
    const feed = createFrameReader((m) => got.push(m), overflow, 100);
    feedInChunks(feed, `{"big":"${"x".repeat(500)}"}\n{"ok":1}\n`, 64);
    expect(overflow).toHaveBeenCalledTimes(1);
    expect(got).toEqual([{ ok: 1 }]);
  });

  it("stays linear on a 12 MB frame in 8 KB chunks (macOS socket reads)", () => {
    let got = 0;
    const feed = createFrameReader(() => got++, vi.fn(), 32 * 1024 * 1024);
    const data = "\u001b[38;2;1;2;3mhello\u001b[39m\r\n".repeat(400_000);
    const started = performance.now();
    feedInChunks(feed, `${JSON.stringify({ data })}\n`, 8192);
    expect(got).toBe(1);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("keeps the MCP default ceiling: an unframed flood is one incident, then it recovers", () => {
    const got: unknown[] = [];
    const overflow = vi.fn();
    const feed = createFrameReader((m) => got.push(m), overflow);
    const flood = Buffer.alloc(1024 * 1024, "x");
    for (let i = 0; i < 12; i++) feed(flood);
    feed(Buffer.from('\n{"id":1}\n'));
    expect(overflow).toHaveBeenCalledTimes(1);
    expect(got).toEqual([{ id: 1 }]);
  });
});

// The sidecar still frames with lib/ndjson, so both ends must agree on every chunking.
describe("createFrameReader matches lib/ndjson", () => {
  const MAX = 1000;
  const MAX_CHUNK = 200;

  function rng(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) % 2 ** 31;
      return s / 2 ** 31;
    };
  }

  function stream(rand: () => number): string {
    const lines: string[] = [];
    for (let i = 0; i < 60; i++) {
      const r = rand();
      if (r < 0.1) lines.push("", "   ", "\r");
      else if (r < 0.15) lines.push("not json");
      else if (r < 0.2) {
        // Oversize, then a blank line longer than a chunk: lib/ndjson checks its whole buffer
        // and drops complete frames that share the overflowing chunk, frame-reader does not
        lines.push(JSON.stringify({ big: "x".repeat(MAX * 3 + Math.floor(rand() * MAX)) }));
        lines.push(" ".repeat(MAX_CHUNK + 50));
      } else {
        const text = "ñ✻€😀\u001b[31m\r\n".repeat(1 + Math.floor(rand() * 8));
        const json = JSON.stringify({ i, text });
        lines.push(rand() < 0.5 ? `${json}\r` : json);
      }
    }
    return `${lines.join("\n")}\n`;
  }

  function run(
    make: (onMsg: (m: unknown) => void, onOverflow: () => void) => (b: Buffer) => void,
    bytes: Buffer,
    rand: () => number,
  ) {
    const frames: unknown[] = [];
    let overflows = 0;
    const feed = make(
      (m) => frames.push(m),
      () => overflows++,
    );
    for (let i = 0; i < bytes.length; ) {
      const size = 1 + Math.floor(rand() * MAX_CHUNK);
      feed(bytes.subarray(i, i + size));
      i += size;
    }
    return { frames, overflows };
  }

  it("yields identical frames for random chunkings (split UTF-8, CRLF, blanks, oversize)", () => {
    let overflows = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const bytes = Buffer.from(stream(rng(seed)));
      const expected = run((m, o) => createNdjsonBuffer(m, o, MAX), bytes, rng(seed * 7));
      expect(expected.frames.length).toBeGreaterThan(0);
      overflows += expected.overflows;
      for (let k = 1; k <= 5; k++) {
        const got = run((m, o) => createFrameReader(m, o, MAX), bytes, rng(seed * 31 + k));
        expect(got).toEqual(expected);
      }
    }
    expect(overflows).toBeGreaterThan(0);
  });
});
