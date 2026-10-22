import { describe, expect, it, vi } from "vitest";
import {
  createProcessTableReader,
  parsePsTable,
  parsePsUsage,
  parseWin32Processes,
} from "./process-table";

describe("parsePsTable", () => {
  it("reads %cpu, a comma locale included, and keeps args with spaces", () => {
    const out =
      "  101     1   101   101 ttys001   2048  12.5 /bin/zsh -il\n 102 101 102 -1 ?? 512 0,7 node a b\nbad\n";
    expect(parsePsTable(out)).toEqual([
      {
        pid: 101,
        ppid: 1,
        pgid: 101,
        tpgid: 101,
        tty: "ttys001",
        rss: 2048,
        cpu: 12.5,
        args: "/bin/zsh -il",
      },
      {
        pid: 102,
        ppid: 101,
        pgid: 102,
        tpgid: -1,
        tty: "??",
        rss: 512,
        cpu: 0.7,
        args: "node a b",
      },
    ]);
  });
});

describe("createProcessTableReader", () => {
  const row = (pid: number) => [{ pid, ppid: 1, args: "x" }];

  it("shares one read between callers at the same time", async () => {
    let resolve: (rows: ReturnType<typeof row>) => void = () => {};
    const read = vi.fn(
      () =>
        new Promise<ReturnType<typeof row>>((r) => {
          resolve = r;
        }),
    );
    const reader = createProcessTableReader(read);
    const a = reader();
    const b = reader({ maxAgeMs: 1_000 });
    resolve(row(1));
    expect(await a).toBe(await b);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reuses a read only while it is within maxAgeMs, timed from its start", async () => {
    let t = 0;
    let n = 0;
    const read = vi.fn(async () => row(++n));
    const reader = createProcessTableReader(read, () => t);
    await reader();
    t = 1_500;
    expect((await reader({ maxAgeMs: 1_500 }))[0]?.pid).toBe(1);
    expect((await reader({ maxAgeMs: 1_499 }))[0]?.pid).toBe(2);
    // No maxAgeMs: always a new read
    expect((await reader())[0]?.pid).toBe(3);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("recent returns the last read while fresh, and never reads", async () => {
    let t = 0;
    const read = vi.fn(async () => row(1));
    const reader = createProcessTableReader(read, () => t);
    expect(reader.recent(4_000)).toBeNull();
    await reader();
    t = 4_000;
    expect(reader.recent(4_000)?.[0]?.pid).toBe(1);
    expect(reader.recent(3_999)).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("keeps nothing from a failed read", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("ps")).mockResolvedValueOnce(row(5));
    const reader = createProcessTableReader(read);
    await expect(reader({ maxAgeMs: 10_000 })).rejects.toThrow("ps");
    expect((await reader({ maxAgeMs: 10_000 }))[0]?.pid).toBe(5);
  });
});

describe("parsePsUsage", () => {
  it("reads pid, ppid, rss and cpu (comma locale too)", () => {
    expect(parsePsUsage("  12     1  2048  3.5\n  40    12   512 0,7\nbad\n")).toEqual([
      { pid: 12, ppid: 1, rss: 2048, cpu: 3.5, args: "" },
      { pid: 40, ppid: 12, rss: 512, cpu: 0.7, args: "" },
    ]);
  });
});

describe("parseWin32Processes", () => {
  it("reads Win32_Process rows (pid, parent, KB, command line)", () => {
    const json = JSON.stringify([
      { ProcessId: 0, ParentProcessId: 0, WorkingSetSize: 8192, CommandLine: null },
      {
        ProcessId: 4120,
        ParentProcessId: 900,
        WorkingSetSize: 10_485_760,
        CommandLine: '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo',
      },
    ]);
    expect(parseWin32Processes(json)).toEqual([
      { pid: 0, ppid: 0, rss: 8, args: "" },
      {
        pid: 4120,
        ppid: 900,
        rss: 10_240,
        args: '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo',
      },
    ]);
  });

  it("takes a single object, and nothing from empty or broken output", () => {
    expect(parseWin32Processes('{"ProcessId":7,"ParentProcessId":1}')).toEqual([
      { pid: 7, ppid: 1, rss: 0, args: "" },
    ]);
    expect(parseWin32Processes("")).toEqual([]);
    expect(parseWin32Processes("Get-CimInstance : Access denied")).toEqual([]);
  });
});
