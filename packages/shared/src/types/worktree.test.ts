import { describe, expect, it } from "vitest";
import { DEFAULT_WORKTREE_COPY, parseWorktreeCopy, worktreeCopyPatterns } from "./worktree";

describe("parseWorktreeCopy", () => {
  it("keeps one pattern per line, drops blanks, comments and repeats", () => {
    expect(parseWorktreeCopy(" .env\n\n# local\n.env.*\n.env\n!.env.example ")).toEqual([
      ".env",
      ".env.*",
      "!.env.example",
    ]);
  });

  it("drops overlong patterns and caps the list", () => {
    expect(parseWorktreeCopy(["x".repeat(201), "ok"])).toEqual(["ok"]);
    expect(parseWorktreeCopy(Array.from({ length: 60 }, (_, i) => `f${i}`))).toHaveLength(40);
  });
});

describe("worktreeCopyPatterns", () => {
  it("null is the default list, an empty list copies nothing", () => {
    expect(worktreeCopyPatterns(null)).toEqual([...DEFAULT_WORKTREE_COPY]);
    expect(worktreeCopyPatterns([])).toEqual([]);
  });

  it("the default copies .env files but not the example", () => {
    expect(DEFAULT_WORKTREE_COPY).toContain(".env.*");
    expect(DEFAULT_WORKTREE_COPY).toContain("!.env.example");
  });
});
