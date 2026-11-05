import { describe, expect, it } from "vitest";
import type { AgentState, AttentionItem } from "../stores/agents";
import { buildRooms, deskActivity, deskState, nextNeedsYou, todayStrip } from "./company";

const agent = (over: Partial<AgentState> & { id: string }) =>
  ({
    projectId: "p1",
    cliType: "claude-code",
    status: "running",
    activityLevel: "idle",
    startedAt: 1,
    ...over,
  }) as AgentState;
const question = { level: "action_needed", read: false } as AttentionItem;
const stuck = { level: "info", read: false, stuck: true } as AttentionItem;

describe("deskState", () => {
  it("drops a stuck mark once the turn is over", () => {
    expect(deskState(agent({ id: "a", activityLevel: "busy" }), stuck)).toBe("stuck");
    expect(deskState(agent({ id: "a", activityLevel: "idle" }), stuck)).toBe("idle");
  });

  it("puts a suspended session before anything it left pending", () => {
    expect(deskState(agent({ id: "a", suspended: true }), question)).toBe("suspended");
  });
});

describe("deskActivity", () => {
  const busy = agent({ id: "a", activityLevel: "busy" });

  it("names what the last tool did", () => {
    expect(deskActivity(busy, undefined, "Edit")).toBe("edits");
    expect(deskActivity(busy, undefined, "Bash")).toBe("command");
    expect(deskActivity(busy, undefined, "mcp__exegol__browser_click")).toBe("browser");
    expect(deskActivity(busy, undefined, "mcp__exegol__agent_send")).toBe("message");
    expect(deskActivity(busy, undefined, "Read")).toBe("thinking");
  });

  it("is thinking with no hook, a question wins, and an idle session shows nothing", () => {
    expect(deskActivity(busy, undefined, undefined)).toBe("thinking");
    expect(deskActivity(busy, question, "Edit")).toBe("question");
    expect(deskActivity(agent({ id: "a" }), undefined, "Edit")).toBeNull();
  });
});

describe("buildRooms", () => {
  it("groups live sessions, shells included, ended and archived ones out", () => {
    const rooms = buildRooms([
      agent({ id: "b", startedAt: 2 }),
      agent({ id: "a", startedAt: 1, cliType: "shell" }),
      agent({ id: "c", status: "completed" }),
      agent({ id: "d", archived: true }),
    ]);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.desks.map((d) => d.id)).toEqual(["a", "b"]);
  });
});

describe("todayStrip", () => {
  const ctx = { levelOf: () => "all" as const, outdated: new Set<string>(), since: 100 };
  const ids = (list: AgentState[]) => list.map((a) => a.id);

  it("sorts each session into one bucket", () => {
    const strip = todayStrip(
      [
        agent({ id: "needs", status: "waiting_input" }),
        agent({ id: "stuck", activityLevel: "busy" }),
        agent({ id: "pr" }),
        agent({ id: "quiet" }),
        agent({ id: "new", status: "completed", activitySince: 200 }),
        agent({ id: "old", status: "completed", activitySince: 50 }),
      ],
      {
        needs: question,
        stuck,
        pr: { level: "info", read: false } as AttentionItem,
      },
      ctx,
    );
    expect(ids(strip.needs)).toEqual(["needs"]);
    expect(ids(strip.stuck)).toEqual(["stuck"]);
    expect(ids(strip.canWait)).toEqual(["pr"]);
    expect(ids(strip.done)).toEqual(["new"]);
  });

  it("follows the project's interruption level", () => {
    const agents = [agent({ id: "q", status: "waiting_input" }), agent({ id: "cli" })];
    const outdated = new Set(["claude-code"]);
    const levels = (level: "none" | "needs-me") =>
      todayStrip(agents, { q: question }, { ...ctx, outdated, levelOf: () => level });

    expect(levels("none").needs).toEqual([]);
    expect(ids(levels("needs-me").needs)).toEqual(["q"]);
    expect(levels("needs-me").canWait).toEqual([]);
  });

  it("counts a newer CLI as something that can wait", () => {
    const strip = todayStrip(
      [agent({ id: "a" })],
      {},
      { ...ctx, outdated: new Set(["claude-code"]) },
    );
    expect(ids(strip.canWait)).toEqual(["a"]);
  });
});

describe("nextNeedsYou", () => {
  it("walks the list and wraps around", () => {
    expect(nextNeedsYou(["a", "b"], null)).toBe("a");
    expect(nextNeedsYou(["a", "b"], "a")).toBe("b");
    expect(nextNeedsYou(["a", "b"], "b")).toBe("a");
    expect(nextNeedsYou([], "a")).toBeNull();
  });
});
