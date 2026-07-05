import { describe, expect, it } from "vitest";
import { createNdjsonBuffer, encodeRequest, encodeResponse } from "./exegol-protocol";

describe("createNdjsonBuffer", () => {
  it("parses a single complete line", () => {
    const received: unknown[] = [];
    const feed = createNdjsonBuffer((msg) => received.push(msg));
    feed(`${JSON.stringify({ hello: "world" })}\n`);
    expect(received).toEqual([{ hello: "world" }]);
  });

  it("buffers partial lines across multiple chunks", () => {
    const received: unknown[] = [];
    const feed = createNdjsonBuffer((msg) => received.push(msg));
    const json = JSON.stringify({ a: 1 });
    feed(json.slice(0, 5));
    feed(`${json.slice(5)}\n`);
    expect(received).toEqual([{ a: 1 }]);
  });

  it("parses multiple messages delivered in one chunk", () => {
    const received: unknown[] = [];
    const feed = createNdjsonBuffer((msg) => received.push(msg));
    feed(`${JSON.stringify({ n: 1 })}\n${JSON.stringify({ n: 2 })}\n`);
    expect(received).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("drops malformed lines without throwing", () => {
    const received: unknown[] = [];
    const feed = createNdjsonBuffer((msg) => received.push(msg));
    expect(() => feed("not json\n")).not.toThrow();
    feed(`${JSON.stringify({ ok: true })}\n`);
    expect(received).toEqual([{ ok: true }]);
  });
});

describe("encodeRequest / encodeResponse", () => {
  it("round-trips a request through JSON.parse", () => {
    const line = encodeRequest(1, "call_tool", { tool: "memory_search" });
    expect(JSON.parse(line.trim())).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "call_tool",
      params: { tool: "memory_search" },
    });
  });

  it("encodes a success response", () => {
    const line = encodeResponse(2, { ok: true });
    expect(JSON.parse(line.trim())).toEqual({ jsonrpc: "2.0", id: 2, result: { ok: true } });
  });

  it("encodes an error response", () => {
    const line = encodeResponse(3, undefined, { code: -32001, message: "nope" });
    expect(JSON.parse(line.trim())).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32001, message: "nope" },
    });
  });
});
