import { describe, expect, it } from "vitest";
import { parseLsofListenLine } from "./ports";

describe("parseLsofListenLine", () => {
  it("reads the port from a real row, whose last column is (LISTEN)", () => {
    const row =
      "node      40030 peluche   33u  IPv6 0xa77812cde9ec7db4      0t0  TCP [::1]:5173 (LISTEN)";
    expect(parseLsofListenLine(row)).toEqual({ port: 5173, pid: 40030, process: "node" });
  });

  it("reads wildcard and IPv4 addresses", () => {
    expect(parseLsofListenLine("node 73222 u 17u IPv6 0x61 0t0 TCP *:3333 (LISTEN)")?.port).toBe(
      3333,
    );
    expect(
      parseLsofListenLine("postgres 1264 u 7u IPv4 0x1 0t0 TCP 127.0.0.1:5432 (LISTEN)")?.port,
    ).toBe(5432);
  });

  it("skips the header and short lines", () => {
    expect(parseLsofListenLine("COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME")).toBeNull();
    expect(parseLsofListenLine("")).toBeNull();
  });
});
