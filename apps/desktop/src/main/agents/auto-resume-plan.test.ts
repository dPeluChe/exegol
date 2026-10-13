import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "libsql";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { settleAllReattach } from "../terminal/reattach-gate";
import { folderExists } from "./auto-resume";
import {
  finishAutoResume,
  KEPT_STEP,
  NO_PANE,
  NO_PANE_STEP,
  planLostResume,
} from "./auto-resume-plan";
import { setLostOnRestart, settleLost, takeLostOnRestart } from "./lost-sessions";

const DAY = 86_400_000;

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'One', '/a')").run();
  for (const id of ["recent", "old", "nopane"]) {
    db.prepare(
      `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at)
       VALUES (?, 'p1', 'claude-code', 'crashed', 't', 1)`,
    ).run(id);
  }
  return db;
}

const row = (db: Database.Database, id: string) =>
  db.prepare("SELECT status, current_step, suspended_at FROM agents WHERE id = ?").get(id) as {
    status: string;
    current_step: string | null;
    suspended_at: number | null;
  };

describe("auto-resume plan against the DB", () => {
  it("keeps old sessions suspended with their own step, hands back recent ones, settles", async () => {
    const db = setupDb();
    const now = 10 * DAY;
    setLostOnRestart([
      { id: "recent", lastActiveAt: now - DAY },
      { id: "old", lastActiveAt: now - 5 * DAY },
      { id: "nopane", lastActiveAt: now - 2 * DAY },
    ]);
    settleAllReattach();
    const plan = planLostResume(db, await takeLostOnRestart(), now);
    expect(plan.resume.map((a) => a.id)).toEqual(["recent", "nopane"]);
    expect(plan.kept.map((k) => k.agentId)).toEqual(["old"]);
    expect(row(db, "old")).toMatchObject({ status: "stopped", current_step: KEPT_STEP });
    expect(row(db, "old").suspended_at).not.toBeNull();

    // A reload mid-stagger: the kept one is settled, the others are still handed out
    expect((await takeLostOnRestart()).map((s) => s.id)).toEqual(["recent", "nopane"]);

    finishAutoResume(
      db,
      [
        { id: "recent", cliType: "claude-code", outcome: "resumed" },
        { id: "nopane", cliType: "claude-code", outcome: "skipped", reason: NO_PANE },
      ],
      100,
      plan.kept.length,
    );
    expect(row(db, "nopane")).toMatchObject({ status: "stopped", current_step: NO_PANE_STEP });
    expect(await takeLostOnRestart()).toEqual([]);
  });

  it("settleLost drops only the given ids", async () => {
    setLostOnRestart([
      { id: "a", lastActiveAt: 1 },
      { id: "b", lastActiveAt: 1 },
    ]);
    settleAllReattach();
    settleLost(["a"]);
    expect((await takeLostOnRestart()).map((s) => s.id)).toEqual(["b"]);
    settleLost(["b"]);
  });
});

describe("folderExists", () => {
  it("is false for a missing path, a file, a NUL byte; true for a directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "shell-cwd-"));
    const file = join(dir, "f");
    writeFileSync(file, "");
    expect(folderExists(dir)).toBe(true);
    expect(folderExists(file)).toBe(false);
    expect(folderExists(join(dir, "gone"))).toBe(false);
    expect(folderExists(`${dir}\0/x`)).toBe(false);
    expect(folderExists(null)).toBe(false);
  });
});
