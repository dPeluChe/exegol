import type { ClaudeMcpServerInfo } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { mcpLoadSummary, toggleServer } from "./ProjectMcpTab";

const servers: ClaudeMcpServerInfo[] = [
  { name: "db", scope: "local", transport: "stdio" },
  { name: "design", scope: "user", transport: "stdio" },
  { name: "tracker", scope: "user", transport: "http" },
];

describe("project MCP choice", () => {
  it("says what loads and how many processes that is", () => {
    expect(mcpLoadSummary(servers, null)).toBe("3 of 3 load, 2 start a process in every session");
    expect(mcpLoadSummary(servers, ["db", "tracker", "gone"])).toBe(
      "2 of 3 load, 1 starts a process in every session",
    );
    expect(mcpLoadSummary(servers, [])).toBe("0 of 3 load, 0 start a process in every session");
  });

  it("checks and unchecks one server without repeating a name", () => {
    expect(toggleServer(["db"], "design", true)).toEqual(["db", "design"]);
    expect(toggleServer(["db"], "db", true)).toEqual(["db"]);
    expect(toggleServer(["db", "design"], "db", false)).toEqual(["design"]);
  });
});
