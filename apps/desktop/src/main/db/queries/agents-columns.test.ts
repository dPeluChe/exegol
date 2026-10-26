import Database from "libsql";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../migrations";
import {
  AGENT_COLUMNS,
  activateAgent,
  agentPtySize,
  getAgent,
  getAgentFinalOutput,
  listAgentsByIds,
  listLiveAgentClis,
  recoverStaleAgents,
  setAgentFinalOutput,
} from "./agents";

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'One', '/a')").run();
  db.prepare(
    "INSERT INTO worktrees (id, project_id, agent_id, path, branch_name) VALUES ('w1', 'p1', NULL, '/wt', 'feat')",
  ).run();
  const insert = db.prepare(
    `INSERT INTO agents (id, project_id, cli_type, status, task_description, worktree_id, started_at)
     VALUES (?, 'p1', ?, ?, 't', ?, ?)`,
  );
  insert.run("a1", "codex", "running", "w1", 1);
  insert.run("a2", "shell", "running", null, 2);
  insert.run("a3", "claude-code", "completed", null, 3);
  return db;
}

describe("agent rows", () => {
  it("the shared column list never reads final_output", () => {
    expect(AGENT_COLUMNS).not.toContain("final_output");
    expect(AGENT_COLUMNS).toContain("w.branch_name");
  });

  it("activation records the grid the PTY was created at", () => {
    const db = setupDb();
    expect(agentPtySize(db, "a1")).toBeNull();
    activateAgent(db, "a1", 42, { cols: 177, rows: 66 });
    expect(agentPtySize(db, "a1")).toEqual({ cols: 177, rows: 66 });
    expect(getAgent(db, "a1")?.status).toBe("running");
  });

  it("final_output is read only by its own getter", () => {
    const db = setupDb();
    setAgentFinalOutput(db, "a3", "the tail");
    expect(getAgent(db, "a3")).not.toHaveProperty("finalOutput");
    expect(getAgentFinalOutput(db, "a3")).toBe("the tail");
  });

  it("listAgentsByIds maps rows like getAgent, branch included", () => {
    const db = setupDb();
    const [a1] = listAgentsByIds(db, ["a1"]);
    expect(a1).toEqual(getAgent(db, "a1"));
    expect(a1?.branchName).toBe("feat");
  });

  it("listLiveAgentClis returns live non-shell sessions only", () => {
    expect(listLiveAgentClis(setupDb())).toMatchObject([{ id: "a1", cliType: "codex" }]);
  });

  it("recoverStaleAgents marks every stale session crashed in one sweep", () => {
    const db = setupDb();
    const out = recoverStaleAgents(db, new Set(["a2"]));
    expect(out.crashedIds).toEqual(["a1"]);
    expect(getAgent(db, "a1")?.status).toBe("crashed");
    expect(getAgent(db, "a2")?.status).toBe("running");
  });
});
