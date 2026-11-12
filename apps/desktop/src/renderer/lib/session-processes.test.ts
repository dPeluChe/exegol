import type { SessionProcesses } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { processTotals } from "./session-processes";

const session = (groups: SessionProcesses["groups"]): SessionProcesses => ({
  agentId: "a",
  alias: null,
  taskDescription: null,
  cliType: "claude-code",
  projectId: "p",
  projectName: "Demo",
  count: groups.reduce((n, g) => n + g.count, 0),
  rssKb: groups.reduce((n, g) => n + g.rssKb, 0),
  cpu: 0,
  groups,
});

describe("processTotals", () => {
  it("adds the sessions up and says how much of it is MCP", () => {
    const totals = processTotals([
      session([
        { kind: "other", name: "claude", count: 1, rssKb: 300 },
        { kind: "bridge", name: "Exegol bridge", count: 1, rssKb: 50 },
        { kind: "mcp", name: "db", count: 2, rssKb: 100 },
      ]),
      session([{ kind: "shell", name: "zsh", count: 1, rssKb: 5 }]),
    ]);
    expect(totals).toEqual({
      sessions: 2,
      processes: 5,
      rssKb: 455,
      mcpProcesses: 3,
      mcpRssKb: 150,
    });
  });
});
