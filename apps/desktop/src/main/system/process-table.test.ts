import { describe, expect, it } from "vitest";
import { parseWin32Processes } from "./process-table";

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
