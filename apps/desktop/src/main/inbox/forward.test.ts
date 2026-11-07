import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { getThread, listMessages } from "../db/queries/inbox";
import { forward, transcript } from "./forward";
import { openThread, PERSON, replyTo } from "./threads";

let db: Database.Database;
const agent = {
  ...PERSON,
  authorKind: "agent" as const,
  agentId: "a1",
  projectId: "p1",
  repo: "landing",
  cli: "codex",
};
const open = () =>
  openThread(
    db,
    agent,
    { scope: "project", projectId: "p1" },
    {
      title: "Hero breaks on Safari",
      body: "Found it in the clone",
      url: null,
      refs: [],
    },
  ).thread.id;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  for (const id of ["p1", "p2"]) {
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(
      id,
      `Proj ${id}`,
      `/x/${id}`,
    );
  }
  db.prepare(
    "INSERT INTO agents (id, project_id, cli_type, task_description, status) VALUES ('a1', 'p1', 'codex', 't', 'running')",
  ).run();
});

describe("forward", () => {
  it("opens a thread there with the messages and the origin, and closes this one", () => {
    const key = open();
    replyTo(db, PERSON, key, "Please look at it");
    const moved = forward(db, key, { scope: "project", projectId: "p2" });
    expect(moved).toMatchObject({
      forwardedFrom: key,
      ownerProject: "p2",
      title: "Hero breaks on Safari",
    });
    const body = listMessages(db, moved.id)[0]?.body ?? "";
    expect(body).toContain(`Forwarded from ${key}`);
    expect(body).toContain("Agent, Proj p1, landing, codex");
    expect(body).toContain("Please look at it");
    expect(getThread(db, key, null)).toMatchObject({
      status: "resolved",
      resolution: `Forwarded to ${moved.id}`,
    });
    expect(() => forward(db, key, { scope: "personal" })).toThrow("closed");
  });

  it("refuses the place it is already in", () => {
    expect(() => forward(db, open(), { scope: "project", projectId: "p1" })).toThrow(
      "already there",
    );
  });

  it("keeps the newest messages when the transcript is too long", () => {
    const key = open();
    replyTo(db, PERSON, key, "x".repeat(300));
    replyTo(db, PERSON, key, "newest");
    const thread = getThread(db, key, null);
    if (!thread) throw new Error("no thread");
    const body = transcript(db, thread, "Head.", 200);
    expect(body).toContain("earlier messages left out");
    expect(body).toContain("newest");
    expect(body).not.toContain("Found it in the clone");
  });
});
