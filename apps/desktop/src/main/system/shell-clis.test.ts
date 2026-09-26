import { describe, expect, it } from "vitest";
import { matchShellClis } from "./shell-clis";

const commands = new Map([
  ["claude", "claude-code"],
  ["codex", "codex"],
  ["agy", "agy"],
]);

describe("matchShellClis", () => {
  it("finds a CLI typed in a shell, native or run by node", () => {
    const rows = [
      { pid: 100, ppid: 1, args: "/bin/zsh -il" },
      { pid: 101, ppid: 100, args: "claude --resume abc" },
      { pid: 200, ppid: 1, args: "/bin/zsh -il" },
      { pid: 201, ppid: 200, args: "/opt/homebrew/bin/node /opt/homebrew/bin/codex" },
      { pid: 300, ppid: 1, args: "/bin/zsh -il" },
      { pid: 301, ppid: 300, args: "vim notes.md" },
    ];
    expect(
      matchShellClis(
        [
          { id: "a", pid: 100 },
          { id: "b", pid: 200 },
          { id: "c", pid: 300 },
        ],
        rows,
        commands,
      ),
    ).toEqual({ a: "claude-code", b: "codex" });
  });

  it("looks below wrappers (a subshell or npx)", () => {
    const rows = [
      { pid: 10, ppid: 1, args: "zsh" },
      { pid: 11, ppid: 10, args: "bash -c agy" },
      { pid: 12, ppid: 11, args: "/usr/local/bin/agy" },
    ];
    expect(matchShellClis([{ id: "s", pid: 10 }], rows, commands)).toEqual({ s: "agy" });
  });
});
