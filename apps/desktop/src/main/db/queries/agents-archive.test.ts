import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../migrations";
import { archiveAgent, archiveEndedAgents, createAgent, listRecentSessions } from "./agents";

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'One', '/a')").run();
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p2', 'Two', '/b')").run();
  return db;
}

function insert(db: Database.Database, id: string, status: string, projectId = "p1"): void {
  db.prepare(
    `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at, stopped_at)
     VALUES (?, ?, 'claude-code', ?, 't', unixepoch(), unixepoch())`,
  ).run(id, projectId, status);
}

describe("archiving ended sessions", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = setupDb();
  });

  it("hides an archived session from the recent list without deleting it", () => {
    insert(db, "done", "completed");
    expect(listRecentSessions(db)).toHaveLength(1);

    expect(archiveAgent(db, "done")).toBe(true);
    expect(listRecentSessions(db)).toHaveLength(0);
    // The row survives: it still carries scoring, oplog attribution and the
    // resume handle. Archiving is a view concern, not a deletion.
    const row = db.prepare("SELECT id FROM agents WHERE id = 'done'").get();
    expect(row).toBeTruthy();
  });

  it("refuses to archive a live agent", () => {
    insert(db, "alive", "running");
    expect(archiveAgent(db, "alive")).toBe(false);
    expect(archiveEndedAgents(db)).toBe(0);
  });

  it("is idempotent — a second archive changes nothing", () => {
    insert(db, "done", "failed");
    expect(archiveAgent(db, "done")).toBe(true);
    expect(archiveAgent(db, "done")).toBe(false);
  });

  it("archives every ended session, or only one project's", () => {
    insert(db, "a", "completed");
    insert(db, "b", "crashed");
    insert(db, "c", "completed", "p2");
    insert(db, "live", "waiting_input");

    expect(archiveEndedAgents(db, "p1")).toBe(2);
    // The other project is untouched, and the live one is never swept up.
    expect(archiveEndedAgents(db)).toBe(1);
    const live = db.prepare("SELECT archived_at FROM agents WHERE id = 'live'").get() as {
      archived_at: number | null;
    };
    expect(live.archived_at).toBeNull();
  });
});

// The task is optional at every launcher, but a blank label makes an agent
// unidentifiable in the dashboard, the tab bar and agent_send addressing.
describe("createAgent task label", () => {
  it("falls back to the provider name when no task is given", () => {
    const db = setupDb();
    expect(
      createAgent(db, { projectId: "p1", cliType: "claude-code", taskDescription: "" })
        .taskDescription,
    ).toBe("Claude Code");
    expect(
      createAgent(db, { projectId: "p1", cliType: "claude-code", taskDescription: "   " })
        .taskDescription,
    ).toBe("Claude Code");
  });

  it("keeps a real task untouched", () => {
    const db = setupDb();
    expect(
      createAgent(db, { projectId: "p1", cliType: "claude-code", taskDescription: "fix login" })
        .taskDescription,
    ).toBe("fix login");
  });
});
