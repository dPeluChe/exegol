import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { captureGitDiff, captureTree } from "./git-evidence";

let cwd: string;
function git(...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
function commit(): void {
  git("add", "--all");
  const tree = git("write-tree");
  const content = `tree ${tree}\nauthor Fixture <fixture@example.com> 1 +0000\ncommitter Fixture <fixture@example.com> 1 +0000\n\nfixture\n`;
  const hash = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], {
    cwd,
    input: content,
    encoding: "utf8",
  }).trim();
  git("update-ref", "HEAD", hash);
}
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "exegol-evidence-test-"));
  git("init", "--quiet");
  writeFileSync(join(cwd, "tracked.txt"), "initial\n");
  commit();
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

it("keeps committed changes in cumulative evidence and isolates each step", async () => {
  const ref = "refs/exegol/pipelines/test/base";
  await captureTree(cwd, ref);
  writeFileSync(join(cwd, "first.txt"), "first step\n");
  commit();
  expect(git("diff", "HEAD")).toBe("");
  expect(await captureGitDiff(cwd, ref)).toContain("+first step");
  const stepBase = await captureTree(cwd);
  writeFileSync(join(cwd, "second.txt"), "second step\n");
  commit();
  const cumulative = await captureGitDiff(cwd, ref);
  expect(cumulative).toContain("+first step");
  expect(cumulative).toContain("+second step");
  const stepDiff = await captureGitDiff(cwd, stepBase);
  expect(stepDiff).not.toContain("first.txt");
  expect(stepDiff).toContain("+second step");
});

it("excludes preexisting edits and ignored files without changing staging", async () => {
  writeFileSync(join(cwd, "tracked.txt"), "preexisting staged\n");
  git("add", "tracked.txt");
  writeFileSync(join(cwd, "tracked.txt"), "preexisting unstaged\n");
  writeFileSync(join(cwd, ".gitignore"), "ignored.txt\n");
  const index = readFileSync(join(cwd, ".git/index"));
  const base = await captureTree(cwd);
  expect(await captureGitDiff(cwd, base)).toBe("(no changes)");
  writeFileSync(join(cwd, "new.txt"), "new evidence\n");
  writeFileSync(join(cwd, "ignored.txt"), "private\n");
  const diff = await captureGitDiff(cwd, base);
  expect(diff).toContain("+new evidence");
  expect(diff).not.toContain("tracked.txt");
  expect(diff).not.toContain("ignored.txt");
  expect(readFileSync(join(cwd, ".git/index"))).toEqual(index);
});

it("captures deletions and diffs larger than the previous 1 MiB limit", async () => {
  const base = await captureTree(cwd);
  rmSync(join(cwd, "tracked.txt"));
  writeFileSync(join(cwd, "large.txt"), "evidence line\n".repeat(90_000));
  const diff = await captureGitDiff(cwd, base);
  expect(diff.length).toBeGreaterThan(1024 * 1024);
  expect(diff).toContain("deleted file mode");
});

it("reports unavailable baselines as failures instead of empty evidence", async () => {
  expect(await captureGitDiff(cwd)).toContain("baseline unavailable");
  expect(await captureGitDiff(cwd, "missing-ref")).toContain("failed to capture");
});

it("captures changes inside a linked worktree", async () => {
  const path = join(cwd, "linked");
  git("worktree", "add", "--quiet", "--detach", path);
  const base = await captureTree(path, "refs/exegol/pipelines/linked/base");
  writeFileSync(join(path, "tracked.txt"), "worktree change\n");
  expect(await captureGitDiff(path, base)).toContain("+worktree change");
});

it("marks oversized evidence unavailable instead of returning a partial diff", async () => {
  const base = await captureTree(cwd);
  writeFileSync(join(cwd, "oversized.txt"), "evidence\n".repeat(2_000_000));
  expect(await captureGitDiff(cwd, base)).toContain("16 MiB diff limit");
});
