import type { McpSessionInfo } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { sessionsSummary } from "./McpActivityTab";

const session = (id: string, state: McpSessionInfo["state"]): McpSessionInfo => ({
  id,
  alias: null,
  cliType: "claude-code",
  taskDescription: "t",
  projectName: "proj",
  state,
});

describe("sessionsSummary", () => {
  it("counts by state, the ones that need a look first, none left at zero", () => {
    const sessions = [
      session("a", "connected"),
      session("b", "connected"),
      session("c", "not_connected"),
    ];
    expect(sessionsSummary(sessions)).toBe("1 not connected, 2 connected");
  });
});
