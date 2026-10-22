import Database from "libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations";
import { updateAgentStatus } from "../db/queries/agents";
import { forgetAgentStatusWrites, STEP_WRITE_MS, writeAgentStatus } from "./status-writes";

let db: Database.Database;

function row(id = "a1") {
  return db.prepare("SELECT status, current_step FROM agents WHERE id = ?").get(id) as {
    status: string;
    current_step: string | null;
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'One', '/a')").run();
  db.prepare(
    "INSERT INTO agents (id, project_id, cli_type, status, task_description) VALUES ('a1', 'p1', 'codex', 'spawning', 't')",
  ).run();
  db.exec(`CREATE TABLE write_log (n INTEGER);
    CREATE TRIGGER count_writes AFTER UPDATE OF status, current_step ON agents BEGIN INSERT INTO write_log VALUES (1); END;`);
});

afterEach(() => {
  forgetAgentStatusWrites("a1");
  vi.useRealTimers();
});

const countWrites = () =>
  (db.prepare("SELECT COUNT(*) AS n FROM write_log").get() as { n: number }).n;

describe("writeAgentStatus", () => {
  it("skips a write when status and step did not change", () => {
    writeAgentStatus(db, "a1", "running", "Reading");
    writeAgentStatus(db, "a1", "running", "Reading");
    writeAgentStatus(db, "a1", "running");
    expect(countWrites()).toBe(1);
    expect(row()).toMatchObject({ status: "running", current_step: "Reading" });
  });

  it("writes a status change at once, even inside the step window", () => {
    writeAgentStatus(db, "a1", "running", "Reading");
    writeAgentStatus(db, "a1", "waiting_input");
    expect(countWrites()).toBe(2);
    expect(row().status).toBe("waiting_input");
  });

  it("throttles step-only changes and lands the last step", () => {
    writeAgentStatus(db, "a1", "running", "one");
    writeAgentStatus(db, "a1", "running", "two");
    writeAgentStatus(db, "a1", "running", "three");
    expect(countWrites()).toBe(1);
    expect(row().current_step).toBe("one");

    vi.advanceTimersByTime(STEP_WRITE_MS);
    expect(countWrites()).toBe(2);
    expect(row().current_step).toBe("three");
  });

  it("a status change carries the pending step and cancels the trailing write", () => {
    writeAgentStatus(db, "a1", "running", "one");
    writeAgentStatus(db, "a1", "running", "two");
    writeAgentStatus(db, "a1", "waiting_input");
    expect(row()).toMatchObject({ status: "waiting_input", current_step: "two" });
    vi.advanceTimersByTime(STEP_WRITE_MS);
    expect(countWrites()).toBe(2);
  });

  it("writes again after another writer took the row, with no forget call", () => {
    writeAgentStatus(db, "a1", "running", "one");
    db.prepare("UPDATE agents SET status = 'idle', current_step = NULL WHERE id = 'a1'").run();
    writeAgentStatus(db, "a1", "running");
    expect(row().status).toBe("running");
    vi.advanceTimersByTime(STEP_WRITE_MS);
    writeAgentStatus(db, "a1", "running", "one");
    expect(row()).toMatchObject({ status: "running", current_step: "one" });
  });

  it("a trailing step never overwrites a status another writer set", () => {
    writeAgentStatus(db, "a1", "running", "one");
    writeAgentStatus(db, "a1", "running", "two");
    db.prepare("UPDATE agents SET status = 'stopped', current_step = NULL WHERE id = 'a1'").run();
    const before = countWrites();
    vi.advanceTimersByTime(STEP_WRITE_MS);
    expect(countWrites()).toBe(before);
    expect(row()).toMatchObject({ status: "stopped", current_step: null });
  });
});

describe("updateAgentStatus", () => {
  it("an unchanged pair touches nothing, status_changed_at included", () => {
    updateAgentStatus(db, "a1", "running", "x");
    db.prepare("UPDATE agents SET status_changed_at = 1 WHERE id = 'a1'").run();
    const before = countWrites();
    expect(updateAgentStatus(db, "a1", "running", "x")).toBe(false);
    expect(updateAgentStatus(db, "a1", "running")).toBe(false);
    expect(countWrites()).toBe(before);
    const at = db.prepare("SELECT status_changed_at AS t FROM agents WHERE id = 'a1'").get() as {
      t: number;
    };
    expect(at.t).toBe(1);
  });
});
