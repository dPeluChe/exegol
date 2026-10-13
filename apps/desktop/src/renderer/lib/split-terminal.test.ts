import { describe, expect, it } from "vitest";
import { terminalCwdFor } from "./split-terminal";

describe("terminalCwdFor", () => {
  it("a terminal: the shell's live cwd first, then the session's worktree, else the root", () => {
    const pane = { type: "terminal" as const };
    expect(terminalCwdFor(pane, { shellCwd: "/repo/src", sessionDir: "/wt" })).toBe("/repo/src");
    expect(terminalCwdFor(pane, { sessionDir: "/wt" })).toBe("/wt");
    expect(terminalCwdFor(pane, { sessionDir: null })).toBeUndefined();
  });

  it("a files pane: the open file's folder, else the tree's root folder", () => {
    expect(terminalCwdFor({ type: "files", openFile: "/repo/src/a.ts" })).toBe("/repo/src");
    expect(terminalCwdFor({ type: "files", filePath: "/repo/app" })).toBe("/repo/app");
    expect(terminalCwdFor({ type: "files" })).toBeUndefined();
    expect(terminalCwdFor({ type: "files", openFile: "/a.ts" })).toBe("/");
  });

  it("a git pane its folder; browser, empty and no pane the project root", () => {
    expect(terminalCwdFor({ type: "git", filePath: "/repo/lib" })).toBe("/repo/lib");
    expect(terminalCwdFor({ type: "browser" })).toBeUndefined();
    expect(terminalCwdFor({ type: "empty" })).toBeUndefined();
    expect(terminalCwdFor(undefined)).toBeUndefined();
  });
});
