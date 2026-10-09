import { describe, expect, it } from "vitest";
import { isQuickTerminalKey, terminalCwdFor } from "./split-terminal";

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

describe("isQuickTerminalKey", () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    repeat: false,
    ...mods,
  });

  it("is a bare T (either case) with no field typing", () => {
    expect(isQuickTerminalKey(key("t"), false)).toBe(true);
    expect(isQuickTerminalKey(key("T"), false)).toBe(true);
  });

  it("is not T in a field, a held key, a chord or another key", () => {
    expect(isQuickTerminalKey(key("t"), true)).toBe(false);
    expect(isQuickTerminalKey(key("t", { repeat: true }), false)).toBe(false);
    expect(isQuickTerminalKey(key("t", { metaKey: true }), false)).toBe(false);
    expect(isQuickTerminalKey(key("t", { ctrlKey: true }), false)).toBe(false);
    expect(isQuickTerminalKey(key("t", { altKey: true }), false)).toBe(false);
    expect(isQuickTerminalKey(key("y"), false)).toBe(false);
  });
});
