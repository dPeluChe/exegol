import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { dispatchAgentFileEvent, type SessionMaps } from "./agent-session-callbacks";

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    cli_type TEXT,
    project_id TEXT,
    task_description TEXT,
    status TEXT,
    current_step TEXT
  )`);
  return db;
}

function insertAgent(db: Database.Database, id: string, cliType: string, status: string): void {
  db.prepare(
    "INSERT INTO agents (id, cli_type, project_id, task_description, status) VALUES (?, ?, ?, ?, ?)",
  ).run(id, cliType, "proj1", "task", status);
}

function emptyMaps(): SessionMaps {
  return {
    outputProcessors: new Map(),
    titleTrackers: new Map(),
    scrollbackBuffers: new Map(),
    scrollbackSizes: new Map(),
    tokenLimitDetected: new Set(),
    completionCallbacks: new Map(),
    initialSnapshots: new Map(),
    dataCallbacks: new Map(),
    sessionIdsCaptured: new Set(),
  };
}

function status(db: Database.Database, id: string): string {
  const row = db.prepare("SELECT status FROM agents WHERE id = ?").get(id) as { status: string };
  return row.status;
}

describe("dispatchAgentFileEvent", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  it("maps tool_use to working → running status", () => {
    insertAgent(db, "a1", "claude-code", "spawning");
    dispatchAgentFileEvent(db, emptyMaps(), { type: "tool_use", agentId: "a1" });
    expect(status(db, "a1")).toBe("running");
  });

  it("maps stop to finished → waiting_input status", () => {
    insertAgent(db, "a2", "claude-code", "running");
    dispatchAgentFileEvent(db, emptyMaps(), { type: "stop", agentId: "a2" });
    expect(status(db, "a2")).toBe("waiting_input");
  });

  it("maps permission_needed to attention → waiting_input status", () => {
    insertAgent(db, "a3", "claude-code", "running");
    dispatchAgentFileEvent(db, emptyMaps(), { type: "permission_needed", agentId: "a3" });
    expect(status(db, "a3")).toBe("waiting_input");
  });

  it("never resurrects a terminal agent", () => {
    insertAgent(db, "a4", "claude-code", "completed");
    dispatchAgentFileEvent(db, emptyMaps(), { type: "tool_use", agentId: "a4" });
    expect(status(db, "a4")).toBe("completed");
  });

  it("skips shells", () => {
    insertAgent(db, "a5", "shell", "running");
    dispatchAgentFileEvent(db, emptyMaps(), { type: "stop", agentId: "a5" });
    expect(status(db, "a5")).toBe("running");
  });

  it("ignores unknown event types and unknown agents", () => {
    insertAgent(db, "a6", "claude-code", "running");
    dispatchAgentFileEvent(db, emptyMaps(), { type: "token_limit", agentId: "a6" });
    expect(status(db, "a6")).toBe("running");
    expect(() =>
      dispatchAgentFileEvent(db, emptyMaps(), { type: "stop", agentId: "ghost" }),
    ).not.toThrow();
  });
});
