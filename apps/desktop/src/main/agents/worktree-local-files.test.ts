import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_WORKTREE_COPY } from "@exegol/shared";
import { afterEach, describe, expect, it } from "vitest";
import { copyLocalFiles, planLocalCopies } from "./worktree-local-files";

let root = "";
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env: ENV, encoding: "utf-8", stdio: "pipe" });

function put(dir: string, rel: string, text = rel) {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text);
}

function setup() {
  root = realpathSync(mkdtempSync(join(tmpdir(), "exegol-wt-copy-")));
  const repo = join(root, "repo");
  const wt = join(root, "wt");
  git(root, "init", "-q", "-b", "main", repo);
  put(repo, ".gitignore", ".env*\nnode_modules/\n!.env.tracked\n");
  put(repo, ".env.tracked", "tracked");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "worktree", "add", "-q", "-b", "agent", wt);
  return { repo, wt };
}

describe("copyLocalFiles", () => {
  it("copies ignored .env files at any depth, never the example, deps or tracked files", async () => {
    const { repo, wt } = setup();
    put(repo, ".env", "SECRET=1");
    put(repo, ".env.local");
    put(repo, ".env.example");
    put(repo, "apps/web/.env.local");
    put(repo, "node_modules/pkg/.env");
    chmodSync(join(repo, ".env"), 0o600);

    const r = await copyLocalFiles(repo, wt, DEFAULT_WORKTREE_COPY);

    expect(r).toEqual({ copied: 3, skipped: 0 });
    expect(readFileSync(join(wt, ".env"), "utf-8")).toBe("SECRET=1");
    expect(statSync(join(wt, ".env")).mode & 0o777).toBe(0o600);
    expect(existsSync(join(wt, ".env.local"))).toBe(true);
    expect(existsSync(join(wt, "apps/web/.env.local"))).toBe(true);
    expect(existsSync(join(wt, ".env.example"))).toBe(false);
    expect(existsSync(join(wt, "node_modules"))).toBe(false);
  });

  it("never overwrites a file already in the worktree", async () => {
    const { repo, wt } = setup();
    put(repo, ".env", "from checkout");
    put(wt, ".env", "mine");
    const r = await copyLocalFiles(repo, wt, [".env"]);
    expect(r).toEqual({ copied: 0, skipped: 1 });
    expect(readFileSync(join(wt, ".env"), "utf-8")).toBe("mine");
  });

  it("skips links and files reached through a linked folder outside the checkout", async () => {
    const { repo, wt } = setup();
    const outside = join(root, "outside");
    put(outside, ".env.outside", "elsewhere");
    symlinkSync(join(outside, ".env.outside"), join(repo, ".env"));
    symlinkSync(outside, join(repo, "linked"));
    const r = await copyLocalFiles(repo, wt, [".env*"]);
    expect(r.copied).toBe(0);
    expect(existsSync(join(wt, ".env"))).toBe(false);
    expect(existsSync(join(wt, "linked"))).toBe(false);
  });

  it("does not write through a linked folder in the worktree", async () => {
    const { repo, wt } = setup();
    const outside = join(root, "outside");
    mkdirSync(outside);
    put(repo, "cfg/.env", "x");
    symlinkSync(outside, join(wt, "cfg"));
    const r = await copyLocalFiles(repo, wt, [".env"]);
    expect(r).toEqual({ copied: 0, skipped: 1 });
    expect(existsSync(join(outside, ".env"))).toBe(false);
  });

  it("never searches dependency folders", async () => {
    const { repo, wt } = setup();
    put(repo, "node_modules/pkg/.env");
    put(repo, "packages/a/node_modules/b/.env.local");
    expect(await copyLocalFiles(repo, wt, [".env*"])).toEqual({ copied: 0, skipped: 0 });
  });

  it("an empty pattern list copies nothing", async () => {
    const { repo, wt } = setup();
    put(repo, ".env");
    expect(await copyLocalFiles(repo, wt, [])).toEqual({ copied: 0, skipped: 0 });
  });
});

describe("planLocalCopies", () => {
  it("keeps plain relative files", () => {
    expect(planLocalCopies([".env", "apps/web/.env.local", ".env"])).toEqual([
      ".env",
      "apps/web/.env.local",
    ]);
  });

  it("drops escapes, absolute paths, .git and dependency or build folders", () => {
    expect(
      planLocalCopies([
        "../.env",
        "/etc/.env",
        "a/./.env",
        ".git/config",
        "node_modules/x/.env",
        "apps/dist/.env",
        "dir/",
        "new\nline/.env",
        'quo"te.env',
        "back\\slash.env",
        "",
      ]),
    ).toEqual([]);
  });

  it("caps the list", () => {
    expect(planLocalCopies(["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });
});
