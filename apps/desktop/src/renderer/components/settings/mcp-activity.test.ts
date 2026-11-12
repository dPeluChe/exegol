import type { McpSessionInfo } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { sessionName, sessionsSummary } from "./McpActivityTab";

const session = (id: string, state: McpSessionInfo["state"], alias: string | null = null) => ({
  id,
  alias,
  cliType: "claude-code",
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

  it("names a session by its alias, else a short id", () => {
    expect(sessionName(session("abcdefghijkl", "connected", "Vega"))).toBe("Vega");
    expect(sessionName(session("abcdefghijkl", "connected"))).toBe("abcdefgh");
  });
});
