import Database from "libsql";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { resumedInto, setAgentResumedFrom, watchedInfo } from "../db/queries/agents";
import { followChain, noteShellFolder, splitLost, takeShellFolder } from "./auto-resume";

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Argos', '/a')").run();
  let t = 1;
  for (const id of ["A", "B", "C", "lone"]) {
    db.prepare(
      `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at, alias)
       VALUES (?, 'p1', 'claude-code', 'crashed', 't', ?, 'nyx')`,
    ).run(id, t++);
  }
  return db;
}

describe("resume chain", () => {
  it("follows A -> B -> C to the newest continuation, even after A's row is deleted", () => {
    const db = setupDb();
    setAgentResumedFrom(db, "B", "A");
    setAgentResumedFrom(db, "C", "B");
    db.prepare("DELETE FROM agents WHERE id = 'A'").run();
    expect(followChain("A", (id) => resumedInto(db, id))).toBe("C");
    expect(followChain("lone", (id) => resumedInto(db, id))).toBe("lone");
  });

  it("a double resume of one session ends on the newest of the two", () => {
    const db = setupDb();
    setAgentResumedFrom(db, "B", "A");
    setAgentResumedFrom(db, "C", "A");
    expect(resumedInto(db, "A")).toBe("C");
  });

  it("stops on a cycle instead of looping", () => {
    const next: Record<string, string> = { A: "B", B: "A" };
    expect(followChain("A", (id) => next[id])).toBe("B");
  });

  it("an archived session still says what it was", () => {
    const db = setupDb();
    db.prepare("UPDATE agents SET archived_at = unixepoch() WHERE id = 'lone'").run();
    expect(watchedInfo(db, "lone")).toMatchObject({
      alias: "nyx",
      cliType: "claude-code",
      projectName: "Argos",
      status: "crashed",
    });
    expect(watchedInfo(db, "nope")).toBeNull();
  });
});

describe("pinned sessions in the lost list", () => {
  it("are resumed even when idle past 3 days", () => {
    const now = 100 * 86_400_000;
    const { resume, keep } = splitLost(
      [
        { id: "pinned-old", lastActiveAt: 0 },
        { id: "old", lastActiveAt: 0 },
      ],
      now,
      undefined,
      new Set(["pinned-old"]),
    );
    expect(resume.map((s) => s.id)).toEqual(["pinned-old"]);
    expect(keep.map((s) => s.id)).toEqual(["old"]);
  });
});

describe("shell folder decision for the [AutoResume] line", () => {
  it("is noted at spawn and read once", () => {
    noteShellFolder("s1", "kept");
    noteShellFolder("s2", "gone");
    expect(takeShellFolder("s1")).toBe("folder kept");
    expect(takeShellFolder("s2")).toBe("folder gone, project root");
    expect(takeShellFolder("s1")).toBeUndefined();
  });
});
