import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
import { createWorktree } from "../db/queries/worktrees";
import { sweepOrphanWorktrees } from "./worktree-housekeeping";

const NOW = Date.now();
const OLD_S = Math.floor((NOW - 3 * 24 * 60 * 60 * 1000) / 1000);
let root = "";
afterEach(() => rmSync(root, { recursive: true, force: true }));

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env: ENV, encoding: "utf-8", stdio: "pipe" });

function setup() {
  root = realpathSync(mkdtempSync(join(tmpdir(), "exegol-wt-housekeeping-")));
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  const wtRoot = join(root, "worktrees");
  git(root, "init", "-q", "--bare", origin);
  git(root, "init", "-q", "-b", "main", repo);
  mkdirSync(join(repo, ".agents"));
  writeFileSync(join(repo, ".agents", "mcp_config.json"), "{}");
  writeFileSync(join(repo, "a.txt"), "a");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "origin", "main");

  const db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Proj', ?)").run(repo);

  /** A worktree on its own branch, pushed unless `push` is false */
  const worktree = (name: string, opts: { push?: boolean } = {}) => {
    const path = join(wtRoot, "proj", name);
    git(repo, "worktree", "add", "-q", "-b", name, path);
    if (opts.push !== false) git(path, "push", "-q", "origin", name);
    utimesSync(join(path, ".git"), OLD_S, OLD_S);
    return path;
  };
  /** A row for it, with one agent in `status` that changed three days ago */
  const row = (id: string, path: string, status = "completed") => {
    db.prepare(
      `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at)
       VALUES (?, 'p1', 'claude-code', ?, 't', ?)`,
    ).run(id, status, OLD_S);
    const wt = createWorktree(db, { projectId: "p1", agentId: id, path, branchName: id });
    db.prepare("UPDATE worktrees SET created_at = ? WHERE id = ?").run(OLD_S, wt.id);
    db.prepare("UPDATE agents SET worktree_id = ?, status_changed_at = ? WHERE id = ?").run(
      wt.id,
      OLD_S * 1000,
      id,
    );
    return wt.id;
  };
  const rowExists = (id: string) =>
    db.prepare("SELECT 1 FROM worktrees WHERE id = ?").get(id) !== undefined;
  return { db, repo, wtRoot, worktree, row, rowExists };
}

describe("sweepOrphanWorktrees", () => {
  it("removes a clean, pushed worktree of an ended agent (the always-deleted mcp config ignored)", async () => {
    const { db, wtRoot, worktree, row, rowExists } = setup();
    const path = worktree("clean");
    rmSync(join(path, ".agents", "mcp_config.json"));
    const id = row("clean", path);
    const result = await sweepOrphanWorktrees(db, [wtRoot], NOW);
    expect(result).toMatchObject({ removed: 1, kept: 0 });
    expect(existsSync(path)).toBe(false);
    expect(rowExists(id)).toBe(false);
  });

  it("keeps a dirty worktree", async () => {
    const { db, wtRoot, worktree, row, rowExists } = setup();
    const path = worktree("dirty");
    writeFileSync(join(path, "work.txt"), "unsaved");
    const id = row("dirty", path);
    const result = await sweepOrphanWorktrees(db, [wtRoot], NOW);
    expect(result).toMatchObject({ removed: 0, kept: 1 });
    expect(existsSync(join(path, "work.txt"))).toBe(true);
    expect(rowExists(id)).toBe(true);
  });

  it("keeps a worktree with unpushed commits", async () => {
    const { db, wtRoot, worktree, row } = setup();
    const path = worktree("ahead");
    writeFileSync(join(path, "b.txt"), "b");
    git(path, "add", ".");
    git(path, "commit", "-q", "-m", "local only");
    row("ahead", path);
    const result = await sweepOrphanWorktrees(db, [wtRoot], NOW);
    expect(result).toMatchObject({ removed: 0, kept: 1 });
    expect(existsSync(path)).toBe(true);
  });

  it("keeps a clean, pushed worktree while its agent is live", async () => {
    const { db, wtRoot, worktree, row } = setup();
    const path = worktree("live");
    row("live", path, "running");
    const result = await sweepOrphanWorktrees(db, [wtRoot], NOW);
    expect(result).toMatchObject({ removed: 0, kept: 0 });
    expect(existsSync(path)).toBe(true);
  });

  it("drops the row and prunes the registration of a missing directory", async () => {
    const { db, repo, wtRoot, worktree, row, rowExists } = setup();
    const path = worktree("gone");
    const id = row("gone", path);
    rmSync(path, { recursive: true });
    const result = await sweepOrphanWorktrees(db, [wtRoot], NOW);
    expect(result.droppedRows).toBe(1);
    expect(rowExists(id)).toBe(false);
    expect(git(repo, "worktree", "list")).not.toContain(path);
  });

  it("removes a clean, pushed directory with no row, keeps an unpushed one", async () => {
    const { db, wtRoot, worktree } = setup();
    const clean = worktree("norow");
    const ahead = worktree("norow-ahead", { push: false });
    writeFileSync(join(ahead, "b.txt"), "b");
    git(ahead, "add", ".");
    git(ahead, "commit", "-q", "-m", "local only");
    utimesSync(join(ahead, ".git"), OLD_S, OLD_S);
    // No .git of its own: git would answer for an enclosing repo, so it is never removed
    const plain = join(wtRoot, "proj", "plain");
    mkdirSync(plain);
    const result = await sweepOrphanWorktrees(db, [wtRoot], NOW);
    expect(result).toMatchObject({ removed: 1, kept: 2 });
    expect(existsSync(clean)).toBe(false);
    expect(existsSync(ahead)).toBe(true);
    expect(existsSync(plain)).toBe(true);
  });
});
