import type { ClaudeMcpServerInfo } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { mcpLoadSummary } from "./project-mcp";

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
});
