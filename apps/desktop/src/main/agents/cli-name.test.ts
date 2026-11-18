import Database from "libsql";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations";

const mocks = vi.hoisted(() => ({
  read: null as { name: string; renamed: boolean } | null,
  pushes: [] as unknown[],
  moved: [] as unknown[],
}));
vi.mock("../inbox/threads", () => ({
  renameSession: (_db: unknown, ...args: unknown[]) => mocks.moved.push(args),
}));
vi.mock("./session-chat", () => ({
  NAME_READERS: {
    "claude-code": { at: "turn_start", everyMs: 0, read: async () => mocks.read },
  },
}));
vi.mock("../lib/event-bus", () => ({
  broadcast: (channel: string, data: unknown) => mocks.pushes.push([channel, data]),
}));

import { setAgentAlias } from "../db/queries/agents";
import { followCliName } from "./cli-name";

const SESSION = { id: "a1", cliType: "claude-code" };

describe("followCliName", () => {
  let db: Database.Database;
  const row = () =>
    db.prepare("SELECT alias, cli_name FROM agents WHERE id = 'a1'").get() as {
      alias: string;
      cli_name: string | null;
    };

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Proj', '/tmp/p1')").run();
    db.prepare(
      `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at, alias)
       VALUES ('a1', 'p1', 'claude-code', 'running', 'do things', unixepoch(), 'basalt')`,
    ).run();
    mocks.read = { name: "taskyserver", renamed: true };
    mocks.pushes.length = 0;
    mocks.moved.length = 0;
  });

  it("renames the session and its inbox threads once, and keeps a later name set in Exegol", async () => {
    await followCliName(db, SESSION, "turn_start");

    expect(row()).toMatchObject({ alias: "taskyserver", cli_name: "taskyserver" });
    expect(mocks.moved).toEqual([["p1", "basalt", "taskyserver"]]);
    expect(mocks.pushes).toEqual([
      ["agent:renamed", { agentId: "a1", cliName: "taskyserver", alias: "taskyserver" }],
    ]);

    setAgentAlias(db, "a1", "mine");
    await followCliName(db, SESSION, "turn_start");
    expect(row().alias).toBe("mine");
  });

  it("pushes a title the CLI wrote with no new name, and reads only at the reader's moment", async () => {
    mocks.read = { name: "A title the CLI wrote", renamed: false };

    await followCliName(db, SESSION, "turn_end");
    expect(row().cli_name).toBeNull();

    await followCliName(db, SESSION, "turn_start");
    expect(mocks.pushes).toEqual([
      ["agent:renamed", { agentId: "a1", cliName: "A title the CLI wrote", alias: null }],
    ]);
    expect(mocks.moved).toEqual([]);
  });
});
