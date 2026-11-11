import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { fleetOf } from "../commander/tools";
import { runMigrations } from "../db/migrations";
import { listActiveAgents } from "../db/queries/agents";
import { moveMainMark, projectMainMarks, setProjectMainMark } from "../db/queries/main-session";
import { mainSessions } from "./main-session";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Brow', '/x/p1')").run();
  const agent = db.prepare(
    `INSERT INTO agents (id, project_id, cli_type, task_description, status, started_at)
     VALUES (?, 'p1', ?, 't', ?, ?)`,
  );
  agent.run("first", "claude-code", "waiting_input", 100);
  agent.run("second", "codex", "running", 200);
  agent.run("sh", "shell", "idle", 50);
});

const fleetMain = () =>
  fleetOf(db, "none", listActiveAgents(db), { relations: true })
    .flatMap((p) => p.sessions)
    .filter((s) => s.main)
    .map((s) => s.id);

describe("a project's main session", () => {
  it("is the first opened unless the person marked a live one, for the app and the Commander alike", () => {
    expect(mainSessions(db)).toEqual({ p1: { id: "first", marked: false, live: 2 } });
    setProjectMainMark(db, "p1", "second");
    expect(mainSessions(db)).toEqual({ p1: { id: "second", marked: true, live: 2 } });
    expect(fleetMain()).toEqual(["second"]);
    db.prepare("UPDATE agents SET status = 'stopped' WHERE id = 'second'").run();
    expect(mainSessions(db)).toEqual({ p1: { id: "first", marked: false, live: 1 } });
    expect(fleetMain()).toEqual(["first"]);
  });

  it("keeps its mark across a resume", () => {
    setProjectMainMark(db, "p1", "second");
    expect(moveMainMark(db, "first", "x")).toBe(false);
    expect(moveMainMark(db, "second", "second-2")).toBe(true);
    expect(projectMainMarks(db).get("p1")).toBe("second-2");
  });
});
