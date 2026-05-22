import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { createParallelRun, getParallelRun } from "../db/queries/parallel-runs";
import { handleParallelAgentExit, promoteParallelAgent } from "./agent-parallel-orchestration";

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Test', '/tmp/test')").run();
  return db;
}

function insertAgent(
  db: Database.Database,
  id: string,
  status: string,
  parallelRunId: string | null,
): void {
  db.prepare(
    `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at, parallel_run_id)
     VALUES (?, 'p1', 'claude-code', ?, 'task', unixepoch(), ?)`,
  ).run(id, status, parallelRunId);
}

describe("handleParallelAgentExit", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  it("does nothing if agent has no parallel_run_id", () => {
    insertAgent(db, "a1", "completed", null);
    expect(() => handleParallelAgentExit(db, "a1")).not.toThrow();
  });

  it("leaves run as running when some agents are still alive", () => {
    insertAgent(db, "a1", "completed", null);
    insertAgent(db, "a2", "running", null);
    const run = createParallelRun(db, {
      projectId: "p1",
      taskDescription: "t",
      cliTypes: ["claude-code", "claude-code"],
      agentIds: ["a1", "a2"],
    });
    db.prepare("UPDATE agents SET parallel_run_id = ? WHERE id IN ('a1', 'a2')").run(run.id);

    handleParallelAgentExit(db, "a1");

    const after = getParallelRun(db, run.id);
    expect(after?.status).toBe("running");
  });

  it("transitions run to completed when all agents terminate with at least one completed", () => {
    insertAgent(db, "a1", "completed", null);
    insertAgent(db, "a2", "failed", null);
    insertAgent(db, "a3", "crashed", null);
    const run = createParallelRun(db, {
      projectId: "p1",
      taskDescription: "t",
      cliTypes: ["c", "c", "c"],
      agentIds: ["a1", "a2", "a3"],
    });
    db.prepare("UPDATE agents SET parallel_run_id = ? WHERE id IN ('a1', 'a2', 'a3')").run(run.id);

    handleParallelAgentExit(db, "a3");

    const after = getParallelRun(db, run.id);
    expect(after?.status).toBe("completed");
    expect(after?.completedAt).not.toBeNull();
  });

  it("transitions run to failed when all agents terminate with no completed", () => {
    insertAgent(db, "a1", "failed", null);
    insertAgent(db, "a2", "crashed", null);
    const run = createParallelRun(db, {
      projectId: "p1",
      taskDescription: "t",
      cliTypes: ["c", "c"],
      agentIds: ["a1", "a2"],
    });
    db.prepare("UPDATE agents SET parallel_run_id = ? WHERE id IN ('a1', 'a2')").run(run.id);

    handleParallelAgentExit(db, "a2");

    const after = getParallelRun(db, run.id);
    expect(after?.status).toBe("failed");
  });

  it("is idempotent — does not re-trigger on a completed run", () => {
    insertAgent(db, "a1", "completed", null);
    insertAgent(db, "a2", "completed", null);
    const run = createParallelRun(db, {
      projectId: "p1",
      taskDescription: "t",
      cliTypes: ["c", "c"],
      agentIds: ["a1", "a2"],
    });
    db.prepare("UPDATE agents SET parallel_run_id = ? WHERE id IN ('a1', 'a2')").run(run.id);

    handleParallelAgentExit(db, "a2"); // first exit settles the run
    const firstCompletedAt = getParallelRun(db, run.id)?.completedAt;
    expect(firstCompletedAt).not.toBeNull();

    handleParallelAgentExit(db, "a1"); // second call should be a no-op
    expect(getParallelRun(db, run.id)?.completedAt).toBe(firstCompletedAt);
  });
});

describe("promoteParallelAgent", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  it("marks the run as completed with the promoted agent id", () => {
    insertAgent(db, "a1", "completed", null);
    insertAgent(db, "a2", "completed", null);
    const run = createParallelRun(db, {
      projectId: "p1",
      taskDescription: "t",
      cliTypes: ["c", "c"],
      agentIds: ["a1", "a2"],
    });

    promoteParallelAgent(db, run.id, "a1");

    const after = getParallelRun(db, run.id);
    expect(after?.status).toBe("completed");
    expect(after?.promotedAgentId).toBe("a1");
  });

  it("ignores promotion of an agent that is not part of the run", () => {
    insertAgent(db, "a1", "completed", null);
    insertAgent(db, "x99", "completed", null);
    const run = createParallelRun(db, {
      projectId: "p1",
      taskDescription: "t",
      cliTypes: ["c"],
      agentIds: ["a1"],
    });

    promoteParallelAgent(db, run.id, "x99");

    const after = getParallelRun(db, run.id);
    expect(after?.promotedAgentId).toBeNull();
  });

  it("is idempotent — calling twice with the same agentId leaves state unchanged", () => {
    insertAgent(db, "a1", "completed", null);
    const run = createParallelRun(db, {
      projectId: "p1",
      taskDescription: "t",
      cliTypes: ["c"],
      agentIds: ["a1"],
    });

    promoteParallelAgent(db, run.id, "a1");
    const first = getParallelRun(db, run.id);
    promoteParallelAgent(db, run.id, "a1");
    const second = getParallelRun(db, run.id);

    expect(second?.completedAt).toBe(first?.completedAt);
    expect(second?.promotedAgentId).toBe("a1");
  });
});
