import { describe, expect, it } from "vitest";
import type { AgentState, AttentionItem } from "../stores/agents";
import { isSidebarView } from "../stores/app";
import type { LiveProjectGroup } from "./live-tabs";
import { activeCards, isActiveOrWaiting, isBusy, liveSessionCount } from "./sidebar-views";
import { tabKeyTarget } from "./tab-keys";

const agent = (id: string, status: string, activityLevel: string, extra = {}) =>
  ({ id, status, activityLevel, cliType: "claude-code", ...extra }) as unknown as AgentState;

const agents: Record<string, AgentState> = {
  a: agent("a", "running", "busy"),
  b: agent("b", "waiting_input", "idle"),
  c: agent("c", "spawning", "busy"),
  d: agent("d", "completed", "neutral"),
  e: agent("e", "waiting_input", "idle"),
};

const attention = (agentId: string, read: boolean) => ({ agentId, read }) as AttentionItem;

const tab = (projectId: string, tabId: string, agentIds: string[]) => ({
  key: `${projectId}:${tabId}`,
  projectId,
  tabId,
  tabLabel: tabId,
  agentIds,
});

describe("isBusy / isActiveOrWaiting", () => {
  it("busy is a working session; active adds an unread attention item", () => {
    expect(isBusy(agents.a)).toBe(true);
    expect(isBusy(agents.b)).toBe(false);
    expect(isBusy(undefined)).toBe(false);
    expect(isActiveOrWaiting(agents.b, { b: attention("b", false) })).toBe(true);
    expect(isActiveOrWaiting(agents.b, { b: attention("b", true) })).toBe(false);
    expect(isActiveOrWaiting(undefined, {})).toBe(false);
  });
});

describe("activeCards", () => {
  it("keeps busy and waiting-on-you sessions, dropping emptied tabs and cards", () => {
    const cards: LiveProjectGroup[] = [
      { projectId: "p1", tabs: [tab("p1", "t1", ["a", "b"]), tab("p1", "t2", ["b"])] },
      { projectId: "p2", tabs: [tab("p2", "t3", ["b"])] },
      { projectId: "p3", tabs: [tab("p3", "t4", ["c"])] },
      { projectId: "p4", tabs: [tab("p4", "t5", ["e"])] },
    ];
    expect(activeCards(cards, agents, { e: attention("e", false) })).toEqual([
      { projectId: "p1", tabs: [tab("p1", "t1", ["a"])] },
      { projectId: "p3", tabs: [tab("p3", "t4", ["c"])] },
      { projectId: "p4", tabs: [tab("p4", "t5", ["e"])] },
    ]);
  });

  it("an unknown agent id is not active", () => {
    expect(activeCards([{ projectId: "p", tabs: [tab("p", "t", ["zz"])] }], agents, {})).toEqual(
      [],
    );
  });
});

describe("liveSessionCount", () => {
  it("counts live sessions, not shells, finished or suspended ones", () => {
    expect(liveSessionCount(agents)).toBe(4);
    expect(
      liveSessionCount({
        s: agent("s", "running", "busy", { cliType: "shell" }),
        z: agent("z", "running", "idle", { suspended: true }),
      }),
    ).toBe(0);
    expect(liveSessionCount({})).toBe(0);
  });
});

describe("isSidebarView", () => {
  it("accepts the three views only", () => {
    expect(isSidebarView("agents")).toBe(true);
    expect(isSidebarView("projects")).toBe(true);
    expect(isSidebarView("attention")).toBe(true);
    expect(isSidebarView("dashboard")).toBe(false);
    expect(isSidebarView(undefined)).toBe(false);
  });
});

describe("tabKeyTarget", () => {
  it("arrows move and wrap, Home and End jump, other keys do nothing", () => {
    expect(tabKeyTarget("ArrowRight", 0, 3)).toBe(1);
    expect(tabKeyTarget("ArrowRight", 2, 3)).toBe(0);
    expect(tabKeyTarget("ArrowLeft", 0, 3)).toBe(2);
    expect(tabKeyTarget("ArrowDown", 1, 3)).toBe(2);
    expect(tabKeyTarget("ArrowUp", 1, 3)).toBe(0);
    expect(tabKeyTarget("Home", 2, 3)).toBe(0);
    expect(tabKeyTarget("End", 0, 3)).toBe(2);
    expect(tabKeyTarget("Enter", 0, 3)).toBeNull();
    expect(tabKeyTarget("ArrowRight", 0, 0)).toBeNull();
  });
});
