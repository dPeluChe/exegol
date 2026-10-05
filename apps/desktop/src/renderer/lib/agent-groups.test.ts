import type { AgentActivityLevel, AgentStatus } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import type { AttentionItem } from "../stores/agents";
import { groupAgents } from "./agent-groups";

const agent = (
  id: string,
  status: AgentStatus,
  activityLevel: AgentActivityLevel,
  activitySince?: number,
  extra: { cliType?: string; archived?: boolean } = {},
) => ({
  id,
  cliType: (extra.cliType ?? "claude-code") as "claude-code",
  status,
  activityLevel,
  activitySince,
  archived: extra.archived,
});

const item = (agentId: string, level: AttentionItem["level"], read: boolean): AttentionItem => ({
  agentId,
  projectId: "p",
  cliType: "claude-code",
  taskDescription: "",
  level,
  reason: "",
  timestamp: 0,
  read,
  pinned: false,
});

type Agent = ReturnType<typeof agent>;

/** The group one live agent lands in */
const agentGroup = (a: Agent, attention: AttentionItem | undefined) => {
  const groups = groupAgents([a], attention ? { [a.id]: attention } : {});
  return (Object.keys(groups) as (keyof typeof groups)[]).find((g) => groups[g].length > 0);
};

describe("agent groups", () => {
  it("an unread question needs you", () => {
    expect(agentGroup(agent("a", "running", "busy"), item("a", "action_needed", false))).toBe(
      "needYou",
    );
  });

  it("a read dialog still open (waiting_input) needs you; once answered it does not", () => {
    const read = item("a", "action_needed", true);
    expect(agentGroup(agent("a", "waiting_input", "idle"), read)).toBe("needYou");
    expect(agentGroup(agent("a", "running", "busy"), read)).toBe("working");
  });

  it("info and critical alerts do not count as need you", () => {
    expect(agentGroup(agent("a", "waiting_input", "idle"), item("a", "info", false))).toBe(
      "waiting",
    );
  });

  it("busy is working, everything else is waiting", () => {
    expect(agentGroup(agent("a", "running", "busy"), undefined)).toBe("working");
    expect(agentGroup(agent("a", "waiting_input", "idle"), undefined)).toBe("waiting");
    expect(agentGroup(agent("a", "spawning", "neutral"), undefined)).toBe("waiting");
  });
});

describe("groupAgents", () => {
  it("counts live agents only, longest in state first", () => {
    const groups = groupAgents(
      [
        agent("w1", "running", "busy", 200),
        agent("w2", "running", "busy", 100),
        agent("q", "waiting_input", "idle", 50),
        agent("i", "idle", "idle"),
        agent("done", "completed", "neutral", 1),
        agent("sh", "running", "busy", 1, { cliType: "shell" }),
        agent("arch", "running", "busy", 1, { archived: true }),
      ],
      { q: item("q", "action_needed", false) },
    );
    expect(groups.needYou.map((a) => a.id)).toEqual(["q"]);
    expect(groups.working.map((a) => a.id)).toEqual(["w2", "w1"]);
    expect(groups.waiting.map((a) => a.id)).toEqual(["i"]);
  });
});
