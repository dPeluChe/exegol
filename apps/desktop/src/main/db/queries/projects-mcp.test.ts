import Database from "libsql";
import { expect, it } from "vitest";
import { runMigrations } from "../migrations";
import { getProject, setProjectMcpServers } from "./projects";

it("a project's MCP server list: none, a list, an empty list, none again", () => {
  const db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Proj', '/repo')").run();
  const saved = (servers: string[] | null) => {
    setProjectMcpServers(db, "p1", servers);
    return getProject(db, "p1")?.mcpServers;
  };
  expect(getProject(db, "p1")?.mcpServers).toBeNull();
  expect(saved(["db", "design"])).toEqual(["db", "design"]);
  expect(saved([])).toEqual([]);
  expect(saved(null)).toBeNull();
});
