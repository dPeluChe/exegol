import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { worktreeSafety } from "../lib/worktree-safety";
import { saveWorktreeWork } from "./worktree-save";

let root = "";
afterEach(() => rmSync(root, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();

/** A repo with a bare origin and one Exegol worktree on `exegol/task`, dirty with work.txt */
function setup() {
  root = realpathSync(mkdtempSync(join(tmpdir(), "exegol-wt-save-")));
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  git(root, "init", "-q", "--bare", origin);
  git(root, "init", "-q", "-b", "main", repo);
  git(repo, "config", "user.name", "t");
  git(repo, "config", "user.email", "t@t");
  writeFileSync(join(repo, ".gitignore"), "cache.db\n");
  writeFileSync(join(repo, "a.txt"), "a");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "origin", "main");
  const dir = join(root, "wt");
  git(repo, "worktree", "add", "-q", "-b", "exegol/task", dir);
  writeFileSync(join(dir, "work.txt"), "work");
  const target = { dir, expectedBranch: "exegol/task", alias: "besalt" };
  return { repo, origin, dir, target };
}

describe("saveWorktreeWork", () => {
  it("commits pending work, pushes the branch, and the worktree becomes removable", async () => {
    const { repo, dir, target } = setup();
    writeFileSync(join(dir, "cache.db"), "local data");
    expect(await saveWorktreeWork(target)).toEqual({
      status: "saved",
      branch: "exegol/task",
      commits: 1,
    });
    expect(git(repo, "show", "origin/exegol/task:work.txt")).toBe("work");
    // Ignored files are never committed
    expect(git(dir, "ls-files", "cache.db")).toBe("");
    expect((await worktreeSafety(dir)).reason).not.toBe("uncommitted changes");
  });

  it("refuses the default branch and branches Exegol did not create", async () => {
    const { repo, dir, target } = setup();
    writeFileSync(join(repo, "b.txt"), "b");
    expect(await saveWorktreeWork({ dir: repo, expectedBranch: "main", alias: "x" })).toEqual({
      status: "refused",
      reason: "default branch",
    });
    expect(await saveWorktreeWork({ ...target, expectedBranch: "exegol/other" })).toMatchObject({
      status: "refused",
      reason: "not a branch Exegol created",
    });
    expect(git(dir, "log", "-1", "--format=%s")).toBe("init");
  });

  it("refuses when a file looks like a secret, and commits nothing", async () => {
    const { dir, target } = setup();
    writeFileSync(join(dir, ".env.local"), "KEY=1");
    expect(await saveWorktreeWork(target)).toMatchObject({ status: "refused" });
    expect(git(dir, "log", "-1", "--format=%s")).toBe("init");
    expect(git(dir, "diff", "--cached", "--name-only")).toBe("");
  });

  it("keeps the work local when the push fails", async () => {
    const { dir, target } = setup();
    git(dir, "remote", "set-url", "origin", join(root, "missing.git"));
    expect(await saveWorktreeWork(target)).toEqual({ status: "refused", reason: "push failed" });
  });

  it("keeps the work uncommitted when a hook refuses the commit", async () => {
    const { repo, dir, target } = setup();
    const hooks = join(repo, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n");
    chmodSync(join(hooks, "pre-commit"), 0o755);
    expect(await saveWorktreeWork(target)).toMatchObject({ status: "refused" });
    expect(git(dir, "log", "-1", "--format=%s")).toBe("init");
    expect(git(dir, "status", "--porcelain")).toContain("?? work.txt");
  });

  it("has nothing to do on a clean, pushed worktree", async () => {
    const { dir, target } = setup();
    rmSync(join(dir, "work.txt"));
    expect(await saveWorktreeWork(target)).toEqual({ status: "nothing", branch: "exegol/task" });
  });
});
