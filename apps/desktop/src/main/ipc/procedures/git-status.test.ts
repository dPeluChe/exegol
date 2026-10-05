import { execFileSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitErrorSummary, parseGitStatus, readGitStatus, runGit } from "./git-status";

describe("parseGitStatus", () => {
  it("lists an MM file under both sides", () => {
    expect(parseGitStatus("MM src/a.ts\0")).toEqual([
      { status: "M", staged: true, path: "src/a.ts" },
      { status: "M", staged: false, path: "src/a.ts" },
    ]);
  });

  it("reads a rename's two paths without the arrow", () => {
    expect(parseGitStatus("R  new name.ts\0old.ts\0?? x.txt\0")).toEqual([
      { status: "R", staged: true, path: "new name.ts", origPath: "old.ts" },
      { status: "?", staged: false, path: "x.txt" },
    ]);
  });

  it("keeps a renamed file's later edit on the unstaged side", () => {
    expect(parseGitStatus("RM b.ts\0a.ts\0")).toEqual([
      { status: "R", staged: true, path: "b.ts", origPath: "a.ts" },
      { status: "M", staged: false, path: "b.ts" },
    ]);
  });

  it("reports a conflict once", () => {
    expect(parseGitStatus("UU c.ts\0AA d.ts\0")).toEqual([
      { status: "U", staged: false, path: "c.ts" },
      { status: "U", staged: false, path: "d.ts" },
    ]);
  });
});

describe("gitErrorSummary", () => {
  it("keeps git's fatal line, drops hints and the command echo", () => {
    const err = Object.assign(new Error("Command failed: git add -- nope"), {
      stderr: "fatal: pathspec 'nope' did not match any files\nhint: try harder\n",
    });
    expect(gitErrorSummary(err)).toBe("fatal: pathspec 'nope' did not match any files");
  });

  it("falls back to stdout when git explains itself there", () => {
    const err = Object.assign(new Error("Command failed"), {
      stderr: "",
      stdout: "On branch main\nnothing to commit, working tree clean\n",
    });
    expect(gitErrorSummary(err)).toBe("On branch main\nnothing to commit, working tree clean");
  });
});

describe("against a real repo", () => {
  let cwd: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "exegol-git-status-test-"));
    git("init", "--quiet");
    git("config", "user.email", "fixture@example.com");
    git("config", "user.name", "Fixture");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(cwd, "a.txt"), "one\n");
    writeFileSync(join(cwd, "b.txt"), "bee\n");
    git("add", "-A");
    git("commit", "--quiet", "-m", "init");
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("shows staged + unstaged edits and a staged rename", async () => {
    writeFileSync(join(cwd, "a.txt"), "two\n");
    git("add", "a.txt");
    writeFileSync(join(cwd, "a.txt"), "three\n");
    renameSync(join(cwd, "b.txt"), join(cwd, "c d.txt"));
    git("add", "-A", "b.txt", "c d.txt");

    const files = await readGitStatus(cwd);
    expect(files).toContainEqual({ status: "M", staged: true, path: "a.txt" });
    expect(files).toContainEqual({ status: "M", staged: false, path: "a.txt" });
    expect(files).toContainEqual({
      status: "R",
      staged: true,
      path: "c d.txt",
      origPath: "b.txt",
    });

    await runGit(cwd, ["reset", "-q", "HEAD", "--", "b.txt", "c d.txt"]);
    const after = await readGitStatus(cwd);
    expect(after).toContainEqual({ status: "D", staged: false, path: "b.txt" });
    expect(after).toContainEqual({ status: "?", staged: false, path: "c d.txt" });
  });

  it("throws git's own message", async () => {
    await expect(runGit(cwd, ["add", "--", "missing.txt"])).rejects.toThrow(
      /^fatal: pathspec 'missing.txt' did not match any files$/,
    );
  });
});
