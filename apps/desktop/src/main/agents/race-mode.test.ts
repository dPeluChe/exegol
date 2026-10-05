import Database from "libsql";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations";
import { createParallelRun } from "../db/queries/parallel-runs";
import { createWorktree } from "../db/queries/worktrees";
import { cleanupLoserWorktrees } from "./race-mode";

const rust = vi.hoisted(() => ({
  worktreeHasChangesAsync: vi.fn<(path: string) => Promise<boolean>>(),
  deleteBranch: vi.fn(),
}));
const removeManagedWorktree = vi.hoisted(() => vi.fn());

vi.mock("./spawn-env", () => ({ coreRust: rust }));
vi.mock("./worktrees", () => ({ removeManagedWorktree }));

function setup() {
  const db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Test', '/tmp/test')").run();
  for (const id of ["a1", "a2"]) {
    db.prepare(
      `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at)
       VALUES (?, 'p1', 'claude-code', 'completed', 'task', unixepoch())`,
    ).run(id);
  }
  createWorktree(db, { projectId: "p1", agentId: "a2", path: "/tmp/wt/a2", branchName: "b2" });
  const run = createParallelRun(db, {
    projectId: "p1",
    taskDescription: "t",
    cliTypes: ["c", "c"],
    agentIds: ["a1", "a2"],
  });
  return { db, run };
}

describe("cleanupLoserWorktrees", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes a clean loser worktree and its branch", async () => {
    const { db, run } = setup();
    rust.worktreeHasChangesAsync.mockResolvedValue(false);

    const [result] = await cleanupLoserWorktrees(db, run, "a1");

    expect(result).toMatchObject({ agentId: "a2", cleaned: true, dirty: false });
    expect(removeManagedWorktree).toHaveBeenCalledWith("/tmp/test", "a2", "/tmp/wt/a2", false);
    expect(rust.deleteBranch).toHaveBeenCalledWith("/tmp/test", "b2", true);
  });

  it("keeps a dirty loser unless forced", async () => {
    const { db, run } = setup();
    rust.worktreeHasChangesAsync.mockResolvedValue(true);

    const [result] = await cleanupLoserWorktrees(db, run, "a1");

    expect(result).toMatchObject({ cleaned: false, dirty: true });
    expect(removeManagedWorktree).not.toHaveBeenCalled();
  });

  it("treats a failed dirty check as dirty", async () => {
    const { db, run } = setup();
    rust.worktreeHasChangesAsync.mockRejectedValue(new Error("locked"));

    const [result] = await cleanupLoserWorktrees(db, run, "a1");

    expect(result).toMatchObject({ cleaned: false, dirty: true });
    expect(removeManagedWorktree).not.toHaveBeenCalled();
  });
});
