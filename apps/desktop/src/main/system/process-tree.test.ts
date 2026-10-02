import { describe, expect, it } from "vitest";
import { descendantsOf } from "./process-tree";

describe("descendantsOf", () => {
  it("collects every level below the shell, nothing beside it", () => {
    const rows = [
      { pid: 10, ppid: 1, args: "zsh" },
      { pid: 11, ppid: 10, args: "npm run dev" },
      { pid: 12, ppid: 11, args: "node vite" },
      { pid: 13, ppid: 10, args: "node watcher &" },
      { pid: 20, ppid: 1, args: "zsh" },
      { pid: 21, ppid: 20, args: "sleep 5" },
    ];
    expect(descendantsOf(10, rows).map((r) => r.pid)).toEqual([11, 13, 12]);
    expect(descendantsOf(99, rows)).toEqual([]);
  });
});
