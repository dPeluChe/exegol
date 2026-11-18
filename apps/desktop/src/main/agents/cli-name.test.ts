import Database from "libsql";
import { describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations";

const mocks = vi.hoisted(() => ({
  read: { name: "taskyserver", renamed: true },
  pushes: [] as unknown[],
  moved: [] as unknown[],
}));
vi.mock("../inbox/threads", () => ({
  renameSession: (_db: unknown, ...args: unknown[]) => mocks.moved.push(args),
}));
vi.mock("./session-chat", () => ({ cliNameOf: async () => mocks.read }));
vi.mock("../lib/event-bus", () => ({
  broadcast: (channel: string, data: unknown) => mocks.pushes.push([channel, data]),
}));

import { setAgentAlias } from "../db/queries/agents";
import { followCliName } from "./cli-name";

describe("followCliName", () => {
  it("renames the session and its inbox threads once, and keeps a later name set in Exegol", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Proj', '/tmp/p1')").run();
    db.prepare(
      `INSERT INTO agents (id, project_id, cli_type, status, task_description, started_at, alias)
       VALUES ('a1', 'p1', 'claude-code', 'running', 'do things', unixepoch(), 'basalt')`,
    ).run();
    const row = () =>
      db.prepare("SELECT alias, cli_name FROM agents WHERE id = 'a1'").get() as {
        alias: string;
        cli_name: string;
      };

    await followCliName(db, "a1");

    expect(row()).toMatchObject({ alias: "taskyserver", cli_name: "taskyserver" });
    expect(mocks.moved).toEqual([["p1", "basalt", "taskyserver"]]);
    expect(mocks.pushes).toContainEqual([
      "agent:renamed",
      { agentId: "a1", cliName: "taskyserver", alias: "taskyserver" },
    ]);

    setAgentAlias(db, "a1", "mine");
    await followCliName(db, "a1");
    expect(row().alias).toBe("mine");

    mocks.read = { name: "A title the CLI wrote", renamed: false };
    await followCliName(db, "a1");
    expect(row()).toMatchObject({ alias: "mine", cli_name: "A title the CLI wrote" });
  });
});
