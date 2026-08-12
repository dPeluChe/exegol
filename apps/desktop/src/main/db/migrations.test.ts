import Database from "libsql";
import { describe, expect, it } from "vitest";
import { runMigrations } from "./migrations";

function tableNames(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name")
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

function columnNames(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.map((r) => r.name);
}

function schemaFingerprint(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT COALESCE(sql, name) AS sql FROM sqlite_master ORDER BY name")
    .all() as { sql: string }[];
  return rows.map((r) => r.sql);
}

function appliedMigrationIds(db: Database.Database): string[] {
  const rows = db.prepare("SELECT id FROM _migrations ORDER BY id").all() as { id: string }[];
  return rows.map((r) => r.id);
}

describe("runMigrations", () => {
  it("applies the full chain against a fresh database without throwing", () => {
    const db = new Database(":memory:");
    expect(() => runMigrations(db)).not.toThrow();

    const tables = tableNames(db);
    for (const expected of [
      "_migrations",
      "projects",
      "project_groups",
      "agents",
      "worktrees",
      "activities",
      "search_index",
      "handoffs",
      "messages",
      "scheduled_tasks",
      "scheduled_results",
      "task_queue",
      "token_usage",
      "budgets",
      "budget_alerts",
      "settings",
      "prompts",
      "skills_state",
      "memories",
      "agent_scores",
      "oplog",
      "pipeline_templates",
      "pipeline_runs",
      "parallel_runs",
      "qa_tests",
      "diff_comments",
      "agent_events",
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it("leaves agents with all incrementally added columns", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const cols = columnNames(db, "agents");
    for (const expected of [
      "id",
      "project_id",
      "worktree_id",
      "cli_type",
      "status",
      "task_description",
      "session_id",
      "access_mode",
      "claude_session_id",
      "resume_command",
      "parallel_run_id",
      "isolation_mode",
    ]) {
      expect(cols).toContain(expected);
    }
  });

  it("accepts every agent status including crashed, and rejects unknown ones", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'p', '/tmp/p1')").run();

    const insert = db.prepare(
      "INSERT INTO agents (id, project_id, cli_type, status, task_description) VALUES (?, 'p1', 'claude-code', ?, 't')",
    );
    const statuses = [
      "idle",
      "spawning",
      "running",
      "waiting_input",
      "paused",
      "completed",
      "failed",
      "stopped",
      "crashed",
    ];
    for (const [i, status] of statuses.entries()) {
      expect(() => insert.run(`a${i}`, status)).not.toThrow();
    }
    expect(() => insert.run("a-bad", "exploded")).toThrow();
  });

  it("adds the memory salience columns with their defaults", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const cols = columnNames(db, "memories");
    expect(cols).toContain("reinforcement_count");
    expect(cols).toContain("last_reinforced_at");
    expect(cols).toContain("superseded_by");

    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'p', '/tmp/p1')").run();
    db.prepare(
      "INSERT INTO memories (id, project_id, category, content) VALUES ('m1', 'p1', 'pattern', 'fact')",
    ).run();
    const row = db
      .prepare("SELECT reinforcement_count, superseded_by FROM memories WHERE id = 'm1'")
      .get() as { reinforcement_count: number; superseded_by: string | null };
    expect(row.reinforcement_count).toBe(1);
    expect(row.superseded_by).toBeNull();
  });

  it("creates the budgets tables with their check constraints", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    expect(columnNames(db, "budgets")).toEqual(
      expect.arrayContaining([
        "id",
        "project_id",
        "period",
        "limit_type",
        "limit_value",
        "hard_stop",
      ]),
    );
    expect(columnNames(db, "budget_alerts")).toEqual(
      expect.arrayContaining(["id", "budget_id", "threshold", "period_key"]),
    );

    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'p', '/tmp/p1')").run();
    const insert = db.prepare(
      "INSERT INTO budgets (id, project_id, period, limit_type, limit_value) VALUES (?, 'p1', ?, ?, 10)",
    );
    expect(() => insert.run("b1", "daily", "tokens")).not.toThrow();
    expect(() => insert.run("b2", "weekly", "dollars")).not.toThrow();
    expect(() => insert.run("b3", "monthly", "tokens")).toThrow();
    expect(() => insert.run("b4", "daily", "euros")).toThrow();
  });

  it("records every migration id exactly once", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const ids = appliedMigrationIds(db);
    expect(ids.length).toBeGreaterThanOrEqual(38);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("001_projects");
    expect(ids).toContain("036_agents_isolation_mode");
    expect(ids).toContain("w2b_001_memory_salience_v2");
    expect(ids).toContain("w2d_001_budgets");
    expect(ids).toContain("w2d_002_project_groups");
  });

  it("is idempotent: a second run does not throw and leaves the schema unchanged", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const schemaBefore = schemaFingerprint(db);
    const idsBefore = appliedMigrationIds(db);

    expect(() => runMigrations(db)).not.toThrow();

    expect(schemaFingerprint(db)).toEqual(schemaBefore);
    expect(appliedMigrationIds(db)).toEqual(idsBefore);
  });

  it("preserves existing data across a re-run", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'keeper', '/tmp/p1')").run();

    runMigrations(db);

    const row = db.prepare("SELECT name FROM projects WHERE id = 'p1'").get() as { name: string };
    expect(row.name).toBe("keeper");
  });
});
