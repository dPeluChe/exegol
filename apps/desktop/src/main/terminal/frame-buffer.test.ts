import { describe, expect, it, vi } from "vitest";
import { createFrameBuffer } from "./frame-buffer";

function feedInChunks(feed: (b: Buffer) => void, text: string, size: number) {
  const buf = Buffer.from(text);
  for (let i = 0; i < buf.length; i += size) feed(buf.subarray(i, i + size));
}

describe("createFrameBuffer", () => {
  it("joins a frame split across chunks, multibyte characters included", () => {
    const got: unknown[] = [];
    const feed = createFrameBuffer((m) => got.push(m), vi.fn(), 1_000_000);
    const data = "acentos ñ ✻ \u001b[31m".repeat(500);
    feedInChunks(feed, `${JSON.stringify({ id: 1, data })}\n{"id":2}\n`, 7);
    expect(got).toEqual([{ id: 1, data }, { id: 2 }]);
  });

  it("reads several frames from one chunk and skips a malformed one", () => {
    const got: unknown[] = [];
    const feed = createFrameBuffer((m) => got.push(m), vi.fn(), 1000);
    feed(Buffer.from('{"a":1}\nnot json\n\n{"b":2}\n{"c"'));
    feed(Buffer.from(":3}\n"));
    expect(got).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("drops an oversized frame once and resumes at the next newline", () => {
    const got: unknown[] = [];
    const overflow = vi.fn();
    const feed = createFrameBuffer((m) => got.push(m), overflow, 100);
    feedInChunks(feed, `{"big":"${"x".repeat(500)}"}\n{"ok":1}\n`, 64);
    expect(overflow).toHaveBeenCalledTimes(1);
    expect(got).toEqual([{ ok: 1 }]);
  });

  it("stays linear on a 12 MB frame in 8 KB chunks (macOS socket reads)", () => {
    let got = 0;
    const feed = createFrameBuffer(() => got++, vi.fn(), 32 * 1024 * 1024);
    const data = "\u001b[38;2;1;2;3mhello\u001b[39m\r\n".repeat(400_000);
    const started = performance.now();
    feedInChunks(feed, `${JSON.stringify({ data })}\n`, 8192);
    expect(got).toBe(1);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
