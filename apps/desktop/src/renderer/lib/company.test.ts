import { toolActivity } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import type { AgentState, AttentionItem } from "../stores/agents";
import type { ProjectWorkspace } from "../stores/workspace/types";
import { buildRooms, deskActivity, deskState, groupByTab, todayStrip } from "./company";

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
const stuck = { level: "info", read: false, stuck: true, timestamp: 100 } as AttentionItem;

describe("deskState", () => {
  it("drops a stuck mark once the turn is over", () => {
    expect(deskState(agent({ id: "a", activityLevel: "busy" }), stuck)).toBe("stuck");
    expect(deskState(agent({ id: "a", activityLevel: "idle" }), stuck)).toBe("idle");
  });

  it("ignores a stuck mark from an earlier turn", () => {
    const later = agent({ id: "a", activityLevel: "busy", activitySince: 200 });
    expect(deskState(later, stuck)).toBe("working");
  });

  it("puts a suspended session before anything it left pending", () => {
    expect(deskState(agent({ id: "a", suspended: true }), question)).toBe("suspended");
  });
});

describe("deskActivity", () => {
  const busy = agent({ id: "a", activityLevel: "busy" });

  it("names what the last tool did", () => {
    expect(toolActivity("Edit")).toBe("edits");
    expect(toolActivity("Bash")).toBe("command");
    expect(toolActivity("mcp__exegol__browser_click")).toBe("browser");
    expect(toolActivity("mcp__exegol__agent_send")).toBe("message");
    expect(toolActivity("Read")).toBe("thinking");
  });

  it("is thinking with no hook, and a question or an idle session shows nothing", () => {
    expect(deskActivity(busy, undefined, undefined)).toBe("thinking");
    expect(deskActivity(busy, question, "edits")).toBeNull();
    expect(deskActivity(agent({ id: "a" }), undefined, "edits")).toBeNull();
  });
});

describe("buildRooms", () => {
  it("groups live sessions, shells included, ended and archived ones out", () => {
    const rooms = buildRooms(
      [
        agent({ id: "b" }),
        agent({ id: "a", cliType: "shell" }),
        agent({ id: "c", status: "completed" }),
        agent({ id: "d", archived: true }),
      ],
      {},
    );
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.desks.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("puts what needs you first, then working, then the most recent", () => {
    const idle = { status: "waiting_input", activityLevel: "idle" } as const;
    const rooms = buildRooms(
      [
        agent({ id: "old", projectId: "p1", ...idle, activitySince: 100 }),
        agent({ id: "recent", projectId: "p1", ...idle, activitySince: 900 }),
        agent({ id: "busy", projectId: "p2", activityLevel: "busy", activitySince: 1 }),
        agent({ id: "asks", projectId: "p3", ...idle, activitySince: 2 }),
      ],
      { asks: question },
    );
    expect(rooms.map((r) => r.projectId)).toEqual(["p3", "p2", "p1"]);
    expect(rooms[2]?.desks.map((d) => d.id)).toEqual(["recent", "old"]);
  });
});

describe("unread desks", () => {
  it("rank under what asks for you and land in Can wait, not Needs you", () => {
    const seenOne = agent({ id: "seen", activityLevel: "idle", projectId: "p" });
    const unread = agent({ id: "new", activityLevel: "idle", projectId: "p" });
    const unseen = { new: "p" };
    expect(buildRooms([seenOne, unread], {}, unseen)[0]?.desks.map((d) => d.id)).toEqual([
      "new",
      "seen",
    ]);
    const strip = todayStrip(
      [seenOne, unread],
      {},
      {
        levelOf: () => "all",
        outdated: new Set(),
        unseen,
      },
    );
    expect(strip.needs).toEqual([]);
    expect(strip.canWait.map((a) => a.id)).toEqual(["new"]);
  });
});

describe("todayStrip", () => {
  const ctx = { levelOf: () => "all" as const, outdated: new Set<string>() };
  const ids = (list: AgentState[]) => list.map((a) => a.id);

  it("sorts each session into one bucket", () => {
    const strip = todayStrip(
      [
        agent({ id: "needs", status: "waiting_input" }),
        agent({ id: "stuck", activityLevel: "busy" }),
        agent({ id: "pr" }),
        agent({ id: "quiet" }),
        agent({ id: "ended", status: "completed" }),
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

describe("groupByTab", () => {
  const tab = (id: string, paneId: string) => ({
    id,
    label: id.toUpperCase(),
    layout: { type: "pane", paneId },
  });
  const workspace = {
    tabs: [tab("t1", "p1"), tab("t2", "p2")],
    panes: { p1: { agentId: "calm" }, p2: { agentId: "urgent" } },
  } as unknown as ProjectWorkspace;

  it("orders tabs by their first desk and keeps sessions in no tab apart", () => {
    const desks = [agent({ id: "urgent" }), agent({ id: "calm" }), agent({ id: "loose" })];
    const groups = groupByTab(desks, workspace);
    expect(groups.map((g) => g.tabId)).toEqual(["t2", "t1", null]);
    expect(groups[0]?.label).toBe("T2");
    expect(groups[2]?.desks.map((d) => d.id)).toEqual(["loose"]);
  });

  it("says which tab holds a browser pane", () => {
    const beside = {
      tabs: [
        {
          id: "t1",
          label: "T1",
          layout: {
            type: "split",
            children: [
              { type: "pane", paneId: "p1" },
              { type: "pane", paneId: "web" },
            ],
          },
        },
      ],
      panes: { p1: { agentId: "a" }, web: { type: "browser" } },
    } as unknown as ProjectWorkspace;
    const groups = groupByTab([agent({ id: "a" }), agent({ id: "loose" })], beside);
    expect(groups.map((g) => g.browser)).toEqual([true, false]);
  });
});
