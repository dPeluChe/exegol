import { describe, expect, it } from "vitest";
import { descendantsOf, terminalProcesses } from "./process-tree";

const rows = [
  { pid: 10, ppid: 1, tty: "ttys003", args: "zsh" },
  { pid: 11, ppid: 10, tty: "ttys003", args: "npm run dev" },
  { pid: 12, ppid: 11, tty: "ttys003", args: "node vite" },
  { pid: 13, ppid: 10, tty: "??", args: "setsid worker" },
  { pid: 14, ppid: 1, tty: "ttys003", args: "zsh (async prompt worker)" },
  { pid: 20, ppid: 1, tty: "ttys004", args: "zsh" },
  { pid: 21, ppid: 20, tty: "ttys004", args: "sleep 5" },
];

describe("descendantsOf", () => {
  it("collects every level below the shell, nothing beside it", () => {
    expect(descendantsOf(10, rows).map((r) => r.pid)).toEqual([11, 13, 12]);
    expect(descendantsOf(99, rows)).toEqual([]);
  });
});

describe("terminalProcesses", () => {
  it("everything on the shell's tty plus what left it, never the shell or another terminal", () => {
    const pids = terminalProcesses(10, rows).map((r) => r.pid);
    expect(pids.sort()).toEqual([11, 12, 13, 14]);
  });

  it("Linux pts names count; a shell with no terminal only takes its descendants", () => {
    const linux = rows.map((r) => ({ ...r, tty: r.tty === "ttys003" ? "pts/3" : r.tty }));
    expect(
      terminalProcesses(10, linux)
        .map((r) => r.pid)
        .sort(),
    ).toEqual([11, 12, 13, 14]);
    const detached = rows.map((r) => (r.pid === 10 ? { ...r, tty: "?" } : r));
    expect(
      terminalProcesses(10, detached)
        .map((r) => r.pid)
        .sort(),
    ).toEqual([11, 12, 13]);
  });
});
