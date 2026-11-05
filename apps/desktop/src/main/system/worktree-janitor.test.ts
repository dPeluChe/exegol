import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "libsql";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { createWorktree } from "../db/queries/worktrees";
import { type JanitorDeps, runWorktreeJanitor } from "./worktree-janitor";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.now() + DAY;
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

function put(dir: string, rel: string) {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), rel);
}

function setup() {
  root = realpathSync(mkdtempSync(join(tmpdir(), "exegol-wt-janitor-")));
  const repo = join(root, "repo");
  const wtRoot = join(root, "worktrees");
  git(root, "init", "-q", "-b", "main", repo);
  put(repo, ".gitignore");
  writeFileSync(join(repo, ".gitignore"), "node_modules/\ndist/\n.env\ndata/\n");
  put(repo, "a.txt");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  put(repo, "node_modules/x/index.js");

  const db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Proj', ?)").run(repo);

  const worktree = (name: string) => {
    const path = join(wtRoot, "proj", name);
    git(repo, "worktree", "add", "-q", "-b", name, path);
    put(path, "node_modules/x/index.js");
    put(path, "web/dist/main.js");
    put(path, ".env");
    put(path, "data/local.db");
    return path;
  };
  const run = (now: number, deps: JanitorDeps = {}) =>
    runWorktreeJanitor(db, [wtRoot], {
      processCwds: async () => [],
      measure: async () => 1024 * 1024,
      now,
      ...deps,
    });
  return { db, repo, worktree, run };
}

describe("runWorktreeJanitor", () => {
  it("sheds node_modules and build output on the second idle look, nothing else", async () => {
    const { repo, worktree, run } = setup();
    const wt = worktree("idle");
    expect(await run(T0)).toEqual({ freedBytes: 0, worktrees: 0 });
    expect(existsSync(join(wt, "node_modules"))).toBe(true);

    expect(await run(T0 + DAY)).toEqual({ freedBytes: 2 * 1024 * 1024, worktrees: 1 });
    expect(existsSync(join(wt, "node_modules"))).toBe(false);
    expect(existsSync(join(wt, "web/dist"))).toBe(false);
    expect(existsSync(join(wt, ".env"))).toBe(true);
    expect(existsSync(join(wt, "data/local.db"))).toBe(true);
    expect(existsSync(join(wt, "a.txt"))).toBe(true);
    expect(existsSync(join(repo, "node_modules/x/index.js"))).toBe(true);
  });

  it("keeps a worktree with an untracked file", async () => {
    const { worktree, run } = setup();
    const wt = worktree("dirty");
    put(wt, "notes.txt");
    await run(T0);
    expect((await run(T0 + DAY)).worktrees).toBe(0);
    expect(existsSync(join(wt, "node_modules"))).toBe(true);
  });

  it("keeps a worktree whose HEAD moved since the last look", async () => {
    const { worktree, run } = setup();
    const wt = worktree("moved");
    await run(T0);
    put(wt, "b.txt");
    git(wt, "add", "b.txt");
    git(wt, "commit", "-q", "-m", "b");
    expect((await run(T0 + DAY)).worktrees).toBe(0);
    expect(existsSync(join(wt, "node_modules"))).toBe(true);
  });

  it("keeps a worktree a process works in, or when process folders cannot be read", async () => {
    const { worktree, run } = setup();
    const wt = worktree("used");
    await run(T0);
    expect((await run(T0 + DAY, { processCwds: async () => [join(wt, "web")] })).worktrees).toBe(0);
    expect((await run(T0 + DAY, { processCwds: async () => null })).worktrees).toBe(0);
    expect(existsSync(join(wt, "node_modules"))).toBe(true);
  });

  it("keeps a worktree a live session is in", async () => {
    const { db, worktree, run } = setup();
    const wt = worktree("live");
    db.prepare(
      `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at)
       VALUES ('a1', 'p1', 'claude-code', 'running', 't', 0)`,
    ).run();
    const row = createWorktree(db, {
      projectId: "p1",
      agentId: "a1",
      path: wt,
      branchName: "live",
    });
    db.prepare("UPDATE agents SET worktree_id = ? WHERE id = 'a1'").run(row.id);
    await run(T0);
    expect((await run(T0 + DAY)).worktrees).toBe(0);
    expect(existsSync(join(wt, "node_modules"))).toBe(true);
  });

  it("never touches a folder that is not a worktree of a registered project", async () => {
    const { run } = setup();
    const stray = join(root, "worktrees", "proj", "stray");
    put(stray, "node_modules/x.js");
    await run(T0);
    await run(T0 + DAY);
    expect(existsSync(join(stray, "node_modules/x.js"))).toBe(true);
  });
});
