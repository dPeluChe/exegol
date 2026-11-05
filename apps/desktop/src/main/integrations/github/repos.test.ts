import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findRepoFolders,
  githubRepoInConfig,
  parseGitHubRemote,
  projectRepos,
  sessionsByRepo,
} from "./repos";

describe("parseGitHubRemote", () => {
  it.each([
    ["https://github.com/o/r.git", "o/r"],
    ["https://github.com/o/r", "o/r"],
    ["https://x:tok@github.com/o/r.git", "o/r"],
    ["git@github.com:o/r.git", "o/r"],
    ["ssh://git@ssh.github.com:443/o/r.git", "o/r"],
    ["git@github.com-work:o/r.git", "o/r"],
    ["https://github.com/vercel/next.js.git", "vercel/next.js"],
  ])("reads %s", (url, slug) => {
    expect(parseGitHubRemote(url)).toBe(slug);
  });

  it.each([
    "https://gitlab.com/o/r.git",
    "https://notgithub.com/o/r",
    "https://github.com.evil.io/o/r",
    "https://github.com/o/r; rm -rf ~",
    "https://github.com/../..",
  ])("refuses %s", (url) => {
    expect(parseGitHubRemote(url)).toBeNull();
  });
});

describe("githubRepoInConfig", () => {
  const config = (...remotes: [string, string][]) =>
    remotes.map(([n, url]) => `[remote "${n}"]\n\turl = ${url}\n\tfetch = +x\n`).join("[core]\n");

  it("prefers origin, else any GitHub remote, never another host", () => {
    const upstream: [string, string] = ["upstream", "git@github.com:up/r.git"];
    const origin: [string, string] = ["origin", "git@github.com:me/r.git"];
    const gitlab: [string, string] = ["origin", "git@gitlab.com:me/r.git"];
    expect(githubRepoInConfig(config(upstream, origin))).toBe("me/r");
    expect(githubRepoInConfig(config(gitlab, upstream))).toBe("up/r");
    expect(githubRepoInConfig(config(gitlab))).toBeNull();
    expect(githubRepoInConfig("[core]\n\turl = https://github.com/no/section")).toBeNull();
  });
});

describe("project folders", () => {
  let root: string;
  const repo = (rel: string, url?: string) => {
    mkdirSync(join(root, rel, ".git"), { recursive: true });
    const remote = url ? `[remote "origin"]\n\turl = ${url}\n` : "";
    writeFileSync(join(root, rel, ".git", "config"), remote);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gh-repos-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("finds repos up to 4 levels down, skipping build dirs, dot dirs and links", async () => {
    repo("api");
    repo("a/b/c/d");
    repo("a/b/c/d2/too-deep");
    repo("api/nested");
    repo("node_modules/dep");
    repo(".claude/worktrees/x");
    mkdirSync(join(root, "outside"));
    repo("outside/linked");
    mkdirSync(join(root, "z"));
    symlinkSync(join(root, "outside"), join(root, "z", "link"));
    expect(await findRepoFolders(root)).toEqual(["api", "outside/linked", "a/b/c/d"]);
  });

  it("the root wins when it has a GitHub remote, else the repos inside, one per repo", async () => {
    repo("web", "git@github.com:o/web.git");
    repo("copies/web", "git@github.com:o/web.git");
    repo("gitlab", "git@gitlab.com:o/g.git");
    repo("local");
    expect(await projectRepos(root)).toEqual([
      { name: "o/web", folder: "web", path: join(root, "web") },
    ]);
    const single = mkdtempSync(join(tmpdir(), "gh-root-"));
    mkdirSync(join(single, ".git"));
    writeFileSync(
      join(single, ".git", "config"),
      '[remote "origin"]\n\turl = git@github.com:o/r\n',
    );
    mkdirSync(join(single, "sub", ".git"), { recursive: true });
    expect((await projectRepos(single)).map((r) => [r.name, r.folder])).toEqual([["o/r", ""]]);
    rmSync(single, { recursive: true, force: true });
  });

  it("follows a linked worktree's `.git` file to its config", async () => {
    repo("main", "git@github.com:o/main.git");
    const admin = join(root, "main", ".git", "worktrees", "wt");
    mkdirSync(admin, { recursive: true });
    writeFileSync(join(admin, "commondir"), "../..\n");
    mkdirSync(join(root, "wt"));
    writeFileSync(join(root, "wt", ".git"), `gitdir: ${admin}\n`);
    const repos = await projectRepos(root);
    expect(repos.map((r) => r.folder)).toEqual(["main"]);
  });
});

describe("sessionsByRepo", () => {
  it("places a session by its worktree's repo, else its folder", () => {
    const repos = [
      { folder: "api", path: "/w/api" },
      { folder: "apis", path: "/w/apis" },
    ];
    const held = sessionsByRepo(
      [
        { id: "in", cwd: "/w/api/src", worktreeRepo: null },
        { id: "wt", cwd: "/home/.exegol/worktrees/x", worktreeRepo: "/w/apis" },
        { id: "root", cwd: "/w", worktreeRepo: null },
      ],
      repos,
    );
    expect(held.get("api")).toEqual(["in"]);
    expect(held.get("apis")).toEqual(["wt"]);
    expect(held.size).toBe(2);
  });
});
