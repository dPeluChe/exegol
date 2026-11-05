import { describe, expect, it } from "vitest";
import { encodeRequest, encodeResponse } from "./exegol-protocol";

describe("encodeRequest / encodeResponse", () => {
  it("round-trips a newline-terminated request through JSON.parse", () => {
    const line = encodeRequest(1, "call_tool", { tool: "memory_search" });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line.trim())).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "call_tool",
      params: { tool: "memory_search" },
    });
  });

  it("encodes a success response", () => {
    const line = encodeResponse(2, { ok: true });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line.trim())).toEqual({ jsonrpc: "2.0", id: 2, result: { ok: true } });
  });

  it("encodes an error response", () => {
    const line = encodeResponse(3, undefined, { code: -32001, message: "nope" });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line.trim())).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32001, message: "nope" },
    });
  });
});
