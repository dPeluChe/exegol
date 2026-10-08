import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "libsql";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { createParallelRun } from "../db/queries/parallel-runs";
import { createWorktree } from "../db/queries/worktrees";
import { sweepOrphanWorktrees } from "./worktree-housekeeping";

const NOW = Date.now();
const OLD_S = Math.floor((NOW - 3 * 24 * 60 * 60 * 1000) / 1000);
let root = "";
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.GIT_DIR;
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

function commit(dir: string, file: string) {
  writeFileSync(join(dir, file), file);
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", file);
}

function setup() {
  root = realpathSync(mkdtempSync(join(tmpdir(), "exegol-wt-housekeeping-")));
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  const wtRoot = join(root, "worktrees");
  git(root, "init", "-q", "--bare", origin);
  git(root, "init", "-q", "-b", "main", repo);
  mkdirSync(join(repo, ".agents"));
  writeFileSync(join(repo, ".agents", "mcp_config.json"), "{}");
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n.env\n");
  commit(repo, "a.txt");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "config", "user.name", "t");
  git(repo, "config", "user.email", "t@t");
  git(repo, "push", "-q", "origin", "main");

  const db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Proj', ?)").run(repo);

  /** A worktree on its own branch, pushed unless `push` is false */
  const worktree = (name: string, opts: { push?: boolean } = {}) => {
    const path = join(wtRoot, "proj", name.replace(/\//g, "-"));
    git(repo, "worktree", "add", "-q", "-b", name, path);
    if (opts.push !== false) git(path, "push", "-q", "origin", name);
    utimesSync(join(path, ".git"), OLD_S, OLD_S);
    return path;
  };
  /** A row for it with one agent; archived three days ago unless `archived` is false */
  const row = (id: string, path: string, opts: { status?: string; archived?: boolean } = {}) => {
    db.prepare(
      `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at, archived_at)
       VALUES (?, 'p1', 'claude-code', ?, 't', ?, ?)`,
    ).run(id, opts.status ?? "stopped", OLD_S, opts.archived === false ? null : OLD_S);
    const wt = createWorktree(db, { projectId: "p1", agentId: id, path, branchName: id });
    db.prepare("UPDATE worktrees SET created_at = ? WHERE id = ?").run(OLD_S, wt.id);
    db.prepare("UPDATE agents SET worktree_id = ? WHERE id = ?").run(wt.id, id);
    return wt.id;
  };
  const rowExists = (id: string) =>
    db.prepare("SELECT 1 FROM worktrees WHERE id = ?").get(id) !== undefined;
  // The removal rule alone; the save step has its own tests below
  const sweep = (saveWork = false) => sweepOrphanWorktrees(db, [wtRoot], NOW, undefined, saveWork);
  return { db, repo, wtRoot, worktree, row, rowExists, sweep };
}

describe("sweepOrphanWorktrees", () => {
  it("removes a clean, pushed worktree of an archived agent; build output and the mcp config do not count", async () => {
    const { worktree, row, rowExists, sweep } = setup();
    const path = worktree("clean");
    rmSync(join(path, ".agents", "mcp_config.json"));
    mkdirSync(join(path, "node_modules", "x"), { recursive: true });
    const id = row("clean", path);
    expect(await sweep()).toMatchObject({ removed: 1, kept: 0 });
    expect(existsSync(path)).toBe(false);
    expect(rowExists(id)).toBe(false);
  });

  it("keeps a worktree with uncommitted work", async () => {
    const { worktree, row, rowExists, sweep } = setup();
    const path = worktree("dirty");
    writeFileSync(join(path, "work.txt"), "unsaved");
    const id = row("dirty", path);
    expect(await sweep()).toMatchObject({ removed: 0, kept: 1 });
    expect(existsSync(join(path, "work.txt"))).toBe(true);
    expect(rowExists(id)).toBe(true);
  });

  it("sees untracked files even with status.showUntrackedFiles=no in the repo config", async () => {
    const { repo, worktree, row, sweep } = setup();
    git(repo, "config", "status.showUntrackedFiles", "no");
    const path = worktree("hidden");
    mkdirSync(join(path, "notes"));
    writeFileSync(join(path, "notes", "todo.md"), "work");
    row("hidden", path);
    expect(await sweep()).toMatchObject({ removed: 0, kept: 1 });
    expect(existsSync(join(path, "notes", "todo.md"))).toBe(true);
  });

  it("ignores GIT_DIR from the environment", async () => {
    const { worktree, row, sweep } = setup();
    const path = worktree("env");
    row("env", path);
    process.env.GIT_DIR = join(root, "nowhere");
    expect(await sweep()).toMatchObject({ removed: 1 });
  });

  it("keeps a worktree holding ignored files that are not build output (.env)", async () => {
    const { worktree, row, sweep } = setup();
    const path = worktree("secrets");
    writeFileSync(join(path, ".env"), "KEY=1");
    row("secrets", path);
    expect(await sweep()).toMatchObject({ removed: 0, kept: 1 });
    expect(existsSync(join(path, ".env"))).toBe(true);
  });

  it("keeps a worktree with unpushed commits", async () => {
    const { worktree, row, sweep } = setup();
    const path = worktree("ahead");
    commit(path, "b.txt");
    row("ahead", path);
    expect(await sweep()).toMatchObject({ removed: 0, kept: 1 });
    expect(existsSync(path)).toBe(true);
  });

  it("keeps a worktree with submodules or an operation in progress", async () => {
    const { worktree, row, sweep } = setup();
    const sub = worktree("sub");
    writeFileSync(join(sub, ".gitmodules"), "");
    git(sub, "add", ".gitmodules");
    git(sub, "commit", "-q", "-m", "modules");
    git(sub, "push", "-q", "origin", "sub");
    row("sub", sub);
    const merging = worktree("merging");
    const mergeHead = git(merging, "rev-parse", "--git-path", "MERGE_HEAD").trim();
    writeFileSync(mergeHead.startsWith("/") ? mergeHead : join(merging, mergeHead), "x");
    row("merging", merging);
    expect(await sweep()).toMatchObject({ removed: 0, kept: 2 });
    expect(existsSync(sub) && existsSync(merging)).toBe(true);
  });

  it("keeps a locked worktree", async () => {
    const { repo, worktree, row, sweep } = setup();
    const path = worktree("locked");
    git(repo, "worktree", "lock", path);
    row("locked", path);
    expect(await sweep()).toMatchObject({ removed: 0, kept: 1 });
    expect(existsSync(path)).toBe(true);
  });

  it("never touches a worktree whose agent is live or can still be resumed", async () => {
    const { worktree, row, sweep } = setup();
    const live = worktree("live");
    row("live", live, { status: "running", archived: false });
    const crashed = worktree("crashed");
    row("crashed", crashed, { status: "crashed", archived: false });
    expect(await sweep()).toMatchObject({ removed: 0, kept: 0 });
    expect(existsSync(live) && existsSync(crashed)).toBe(true);
  });

  it("keeps the worktrees of a race still waiting for a pick", async () => {
    const { db, worktree, row, sweep } = setup();
    const path = worktree("racer");
    row("racer", path);
    const run = createParallelRun(db, {
      projectId: "p1",
      taskDescription: "t",
      cliTypes: ["c"],
      agentIds: ["racer"],
    });
    db.prepare("UPDATE parallel_runs SET status = 'completed' WHERE id = ?").run(run.id);
    expect(await sweep()).toMatchObject({ removed: 0 });
    expect(existsSync(path)).toBe(true);
  });

  it("drops the row and prunes the registration of a missing directory", async () => {
    const { repo, worktree, row, rowExists, sweep } = setup();
    const path = worktree("gone");
    const id = row("gone", path);
    rmSync(path, { recursive: true });
    expect((await sweep()).droppedRows).toBe(1);
    expect(rowExists(id)).toBe(false);
    expect(git(repo, "worktree", "list")).not.toContain(path);
  });

  it("removes a clean, pushed folder with no row; keeps unpushed ones, plain folders, and finishes a trash", async () => {
    const { wtRoot, worktree, sweep } = setup();
    const clean = worktree("norow");
    const ahead = worktree("norow-ahead", { push: false });
    commit(ahead, "b.txt");
    utimesSync(join(ahead, ".git"), OLD_S, OLD_S);
    // No .git of its own: git would answer for an enclosing repo, so it is never removed
    const plain = join(wtRoot, "proj", "plain");
    mkdirSync(plain);
    mkdirSync(join(wtRoot, "proj", ".exegol-trash-old-1", "x"), { recursive: true });
    expect(await sweep()).toMatchObject({ removed: 1, kept: 2 });
    expect(existsSync(clean)).toBe(false);
    expect(existsSync(ahead) && existsSync(plain)).toBe(true);
    expect(readdirSync(join(wtRoot, "proj")).some((n) => n.startsWith(".exegol-trash-"))).toBe(
      false,
    );
  });

  it("saves dirty work to its branch and pushes it, then removes the worktree", async () => {
    const { repo, worktree, row, rowExists, sweep } = setup();
    const path = worktree("exegol/save-me");
    writeFileSync(join(path, "work.txt"), "unsaved");
    const id = row("exegol/save-me", path);
    expect(await sweep(true)).toMatchObject({ removed: 1 });
    expect(existsSync(path)).toBe(false);
    expect(rowExists(id)).toBe(false);
    expect(git(repo, "show", "origin/exegol/save-me:work.txt")).toBe("unsaved");
    expect(git(repo, "log", "-1", "--format=%s", "exegol/save-me")).toContain("wip(exegol): save");
  });

  it("with the setting off, nothing is committed and the dirty worktree stays", async () => {
    const { repo, worktree, row, sweep } = setup();
    const path = worktree("exegol/off");
    writeFileSync(join(path, "work.txt"), "unsaved");
    row("exegol/off", path);
    const before = git(repo, "rev-parse", "exegol/off");
    expect(await sweep(false)).toMatchObject({ removed: 0, kept: 1 });
    expect(git(repo, "rev-parse", "exegol/off")).toBe(before);
    expect(existsSync(join(path, "work.txt"))).toBe(true);
  });
});
