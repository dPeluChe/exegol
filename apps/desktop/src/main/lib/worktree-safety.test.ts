import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inRegisteredProject, isRegenerable, pathKey, repoOf } from "./worktree-safety";

describe("repo of a worktree", () => {
  it("reads it from the worktree's .git file, and only from a linked worktree's", () => {
    const dir = mkdtempSync(join(tmpdir(), "exegol-repoof-"));
    try {
      writeFileSync(join(dir, ".git"), "gitdir: /w/api/.git/worktrees/github-api-pr-7\n");
      expect(repoOf(dir)).toBe("/w/api");
      writeFileSync(join(dir, ".git"), "gitdir: ../.git/modules/sub\n");
      expect(repoOf(dir)).toBeNull();
      rmSync(join(dir, ".git"));
      mkdirSync(join(dir, ".git"));
      expect(repoOf(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("counts a project and the repos inside it, not a sibling with the same prefix", () => {
    const keys = new Set([resolve("/w/proj")]);
    expect(inRegisteredProject("/w/proj", keys)).toBe(true);
    expect(inRegisteredProject("/w/proj/services/api", keys)).toBe(true);
    expect(inRegisteredProject("/w/proj2", keys)).toBe(false);
  });
});

describe("pathKey", () => {
  it("is the realpath, so a symlinked spelling of a folder is the same key", () => {
    const dir = mkdtempSync(join(tmpdir(), "exegol-pathkey-"));
    try {
      const link = `${dir}-link`;
      symlinkSync(dir, link);
      expect(pathKey(link, "darwin")).toBe(realpathSync(dir));
      rmSync(link);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps case off Windows and folds it on Windows, a missing path resolved", () => {
    expect(pathKey("/No/Such/Dir", "linux")).toBe(resolve("/No/Such/Dir"));
    expect(pathKey("/No/Such/Dir", "win32")).toBe(resolve("/No/Such/Dir").toLowerCase());
  });
});

describe("isRegenerable", () => {
  it("accepts build output, caches, logs and .DS_Store", () => {
    for (const p of [
      "node_modules/",
      "apps/desktop/dist/",
      "packages/core-rust/target/",
      ".turbo/",
      "a/.cache/x",
      "debug.log",
      "sub/.DS_Store",
    ]) {
      expect(isRegenerable(p)).toBe(true);
    }
  });

  it("rejects anything else ignored: secrets, local databases, notes", () => {
    for (const p of [".env", "data/local.db", "notes/", ".env.local", "logs.txt"]) {
      expect(isRegenerable(p)).toBe(false);
    }
  });
});
