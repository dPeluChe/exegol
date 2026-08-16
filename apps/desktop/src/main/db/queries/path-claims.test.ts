import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../migrations";
import { claimPaths, listProjectClaims, releasePaths } from "./path-claims";

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Proj', '/repo')").run();
  for (const [id, alias, status] of [
    ["a1", "rigel", "running"],
    ["a2", "draco", "running"],
    ["a3", "ghost", "completed"],
  ]) {
    db.prepare(
      `INSERT INTO agents (id, project_id, cli_type, status, task_description, alias, started_at)
       VALUES (?, 'p1', 'opencode', ?, 't', ?, unixepoch())`,
    ).run(id, status, alias);
  }
  return db;
}

describe("path claims", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = setupDb();
  });

  const claim = (agentId: string, paths: string[], note?: string) =>
    claimPaths(db, { agentId, projectId: "p1", paths, note });

  it("grants free paths and blocks a second agent from the same file", () => {
    expect(claim("a1", ["/repo/src/a.ts"]).granted).toEqual(["/repo/src/a.ts"]);

    const blocked = claim("a2", ["/repo/src/a.ts"]);
    expect(blocked.granted).toEqual([]);
    expect(blocked.conflicts[0]).toMatchObject({ path: "/repo/src/a.ts", heldByName: "rigel" });
  });

  it("is all-or-nothing: one conflict grants nothing", () => {
    claim("a1", ["/repo/src/a.ts"]);
    const res = claim("a2", ["/repo/src/b.ts", "/repo/src/a.ts", "/repo/src/c.ts"]);

    expect(res.granted).toEqual([]);
    // A partial grant would read as success and send the agent into the very
    // collision it asked us to prevent.
    expect(listProjectClaims(db, "p1").filter((c) => c.agentId === "a2")).toHaveLength(0);
  });

  it("treats a directory claim as covering everything under it, both ways", () => {
    claim("a1", ["/repo/convex"]);
    expect(claim("a2", ["/repo/convex/ai.ts"]).conflicts).toHaveLength(1);

    releasePaths(db, "a1");
    claim("a2", ["/repo/convex/ai.ts"]);
    expect(claim("a1", ["/repo/convex"]).conflicts).toHaveLength(1);
  });

  it("does not conflict on a sibling whose name merely shares a prefix", () => {
    claim("a1", ["/repo/src/auth"]);
    expect(claim("a2", ["/repo/src/authorization.ts"]).granted).toHaveLength(1);
  });

  it("re-claiming your own path succeeds without duplicating it", () => {
    claim("a1", ["/repo/src/a.ts"]);
    expect(claim("a1", ["/repo/src/a.ts", "/repo/src/b.ts"]).granted).toHaveLength(2);
    expect(listProjectClaims(db, "p1")).toHaveLength(2);
  });

  it("ignores claims held by agents that are no longer live", () => {
    db.prepare("UPDATE agents SET status = 'running' WHERE id = 'a3'").run();
    claim("a3", ["/repo/src/a.ts"]);
    db.prepare("UPDATE agents SET status = 'completed' WHERE id = 'a3'").run();

    expect(claim("a1", ["/repo/src/a.ts"]).granted).toHaveLength(1);
    expect(listProjectClaims(db, "p1").map((c) => c.agentId)).toEqual(["a1"]);
  });

  it("releases selectively and wholesale", () => {
    claim("a1", ["/repo/a", "/repo/b", "/repo/c"]);
    expect(releasePaths(db, "a1", ["/repo/b"])).toEqual({ released: 1 });
    expect(listProjectClaims(db, "p1")).toHaveLength(2);
    expect(releasePaths(db, "a1")).toEqual({ released: 2 });
    expect(listProjectClaims(db, "p1")).toHaveLength(0);
  });
});
