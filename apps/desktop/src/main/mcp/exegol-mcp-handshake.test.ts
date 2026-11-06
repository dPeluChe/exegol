import { describe, expect, it } from "vitest";
import {
  discoverResult,
  negotiateLegacyVersion,
  UNSUPPORTED_VERSION_CODE,
  unsupportedVersionError,
} from "./exegol-mcp-handshake";

describe("MCP handshake", () => {
  it("agrees on a legacy version it speaks, and on its newest legacy otherwise", () => {
    expect(negotiateLegacyVersion("2025-06-18")).toBe("2025-06-18");
    expect(negotiateLegacyVersion("1900-01-01")).toBe("2025-11-25");
    expect(negotiateLegacyVersion(undefined)).toBe("2025-11-25");
  });

  it("discover names the modern version, the capabilities and how to use the tools", () => {
    const r = discoverResult("1.2.3");
    expect(r.supportedVersions).toContain("2026-07-28");
    expect(r).toMatchObject({ resultType: "complete", capabilities: { tools: {} } });
    expect(r.instructions).toMatch(/browser_open/);
  });

  it("refuses a declared version it does not speak, and lists what it does", () => {
    const meta = (v: string) => ({ _meta: { "io.modelcontextprotocol/protocolVersion": v } });
    expect(unsupportedVersionError(meta("2026-07-28"))).toBeNull();
    expect(unsupportedVersionError({})).toBeNull();
    expect(unsupportedVersionError(undefined)).toBeNull();
    const err = unsupportedVersionError(meta("1900-01-01"));
    expect(err?.code).toBe(UNSUPPORTED_VERSION_CODE);
    expect(err?.data.supported).toContain("2026-07-28");
  });
});
