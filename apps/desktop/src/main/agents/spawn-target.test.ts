import type { Project } from "@exegol/shared";
import Database from "libsql";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./spawn-env", () => ({
  slugifyBranchName: (task: string) => `exegol/${task.replace(/\s+/g, "-")}`,
}));
vi.mock("./worktrees", () => ({
  // Stands in for the on-disk collision check: "-2" is what a taken name gets.
  previewManagedWorktree: (_project: string, branch: string) => ({
    branchName: branch === "exegol/taken" ? "exegol/taken-2" : branch,
    path: `/root/${(branch === "exegol/taken" ? "exegol/taken-2" : branch).replace(/\//g, "-")}`,
  }),
}));

import { runMigrations } from "../db/migrations";
import { resolveSpawnTarget } from "./spawn-target";

const project = { id: "p1", name: "proj", path: "/repo" } as Project;

describe("resolveSpawnTarget", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'proj', '/repo')").run();
  });

  it("is the project checkout when no worktree was asked for", () => {
    expect(resolveSpawnTarget(db, project, { useWorktree: false, taskDescription: "x" })).toEqual({
      cwd: "/repo",
      branchName: null,
      reused: false,
    });
  });

  it("derives the branch from the task when the user named none", () => {
    const t = resolveSpawnTarget(db, project, { useWorktree: true, taskDescription: "fix login" });
    expect(t.branchName).toBe("exegol/fix-login");
  });

  // The modal could not know this one: a matching worktree is REUSED as-is, so
  // showing a suffixed path would have been wrong in the opposite direction.
  it("reuses an existing worktree on that branch instead of suffixing", () => {
    db.prepare(
      `INSERT INTO worktrees (id, project_id, agent_id, path, branch_name)
       VALUES ('w1', 'p1', NULL, '/root/exegol-taken', 'exegol/taken')`,
    ).run();
    expect(
      resolveSpawnTarget(db, project, { useWorktree: true, branchName: "exegol/taken" }),
    ).toEqual({ cwd: "/root/exegol-taken", branchName: "exegol/taken", reused: true });
  });

  it("suffixes when the name is taken on disk but no worktree row claims it", () => {
    const t = resolveSpawnTarget(db, project, { useWorktree: true, branchName: "exegol/taken" });
    expect(t).toEqual({ cwd: "/root/exegol-taken-2", branchName: "exegol/taken-2", reused: false });
  });
});
