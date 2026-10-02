import Database from "libsql";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/event-bus", () => ({ broadcast: vi.fn() }));

import { runMigrations } from "../db/migrations";
import { createAgent, createProject } from "../db/queries";
import { broadcast } from "../lib/event-bus";
import { finalizeAgentStatus } from "./spawn-env";

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

const status = (db: Database.Database, id: string) =>
  (db.prepare("SELECT status FROM agents WHERE id = ?").get(id) as { status: string }).status;

describe("finalizeAgentStatus", () => {
  let db: Database.Database;
  let agent: { id: string; cliType: "claude-code"; projectId: string; taskDescription: string };

  beforeEach(() => {
    db = setupDb();
    const project = createProject(db, {
      name: "p",
      path: "/tmp/p",
      gitRemote: null,
      defaultBranch: "main",
      defaultIde: "vscode",
    });
    const row = createAgent(db, {
      projectId: project.id,
      cliType: "claude-code",
      taskDescription: "t",
    });
    db.prepare("UPDATE agents SET status = 'running' WHERE id = ?").run(row.id);
    agent = { id: row.id, cliType: "claude-code", projectId: project.id, taskDescription: "t" };
  });

  it("records a Stop as stopped even when the kill exits non-zero", () => {
    expect(finalizeAgentStatus(db, agent, 143, true)).toBe("stopped");
    expect(status(db, agent.id)).toBe("stopped");
  });

  it("still reads a non-zero exit without a Stop as failed", () => {
    expect(finalizeAgentStatus(db, agent, 1)).toBe("failed");
  });

  it("tells the windows a session ended when its row was deleted while it ran", () => {
    db.prepare("DELETE FROM agents WHERE id = ?").run(agent.id);
    vi.mocked(broadcast).mockClear();
    expect(finalizeAgentStatus(db, agent, 1)).toBeNull();
    expect(broadcast).toHaveBeenCalledWith(
      "agent:status-changed",
      expect.objectContaining({ agentId: agent.id, status: "stopped" }),
    );
  });
});
