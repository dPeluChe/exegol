import { describe, expect, it } from "vitest";
import { lsofStdout, parseLsofListenLine, readProcCwds } from "./ports";

describe("lsofStdout", () => {
  it("keeps what a run that exited 1 printed", () => {
    expect(lsofStdout({ code: 1, stdout: "p1\nn/x\n" })).toBe("p1\nn/x\n");
    expect(lsofStdout({ code: 1 })).toBe("");
  });

  it("throws when lsof did not run, so no answer is not read as none", () => {
    expect(() => lsofStdout({ code: "ENOENT" })).toThrow("lsof unavailable");
    expect(() => lsofStdout({ code: null, killed: true })).toThrow("lsof unavailable");
  });
});

describe("readProcCwds", () => {
  it("reads /proc/<pid>/cwd and leaves out the pids it cannot read", async () => {
    const read = async (path: string) => {
      if (path === "/proc/10/cwd") return "/repo";
      throw new Error("EACCES");
    };
    expect(await readProcCwds([10, 11], read)).toEqual(new Map([[10, "/repo"]]));
  });
});

describe("parseLsofListenLine", () => {
  it("reads the port from a real row, whose last column is (LISTEN)", () => {
    const row =
      "node      40030 me        33u  IPv6 0xa77812cde9ec7db4      0t0  TCP [::1]:5173 (LISTEN)";
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
