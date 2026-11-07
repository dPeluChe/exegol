import { describe, expect, it } from "vitest";
import { discoverResult, initializeResult, unsupportedVersionError } from "./exegol-mcp-handshake";

describe("MCP handshake", () => {
  it("agrees on a legacy version it speaks, and on its newest legacy otherwise", () => {
    const agreed = (v: unknown) => initializeResult(v, "1.2.3").protocolVersion;
    expect(agreed("2025-06-18")).toBe("2025-06-18");
    expect(agreed("1900-01-01")).toBe("2025-11-25");
    expect(agreed("2026-07-28")).toBe("2025-11-25");
    expect(agreed(undefined)).toBe("2025-11-25");
  });

  it("refuses a declared version it does not speak, and lists what it does", () => {
    const meta = (v: string) => ({ _meta: { "io.modelcontextprotocol/protocolVersion": v } });
    expect(unsupportedVersionError(meta("2026-07-28"))).toBeNull();
    expect(unsupportedVersionError(undefined)).toBeNull();
    const err = unsupportedVersionError(meta("1900-01-01"));
    expect(err?.code).toBe(-32022);
    expect(err?.data.supported).toContain("2026-07-28");
  });
});

describe("session instructions", () => {
  it("come first, in both eras, and leave the rest as it was", () => {
    const line = "Inbox: 2 threads waiting for this project.";
    const plain = initializeResult(undefined, "1.2.3").instructions;
    expect(initializeResult(undefined, "1.2.3", line).instructions).toBe(`${line}\n\n${plain}`);
    expect(discoverResult("1.2.3", line).instructions).toBe(`${line}\n\n${plain}`);
    expect(discoverResult("1.2.3").instructions).toBe(plain);
  });
});
