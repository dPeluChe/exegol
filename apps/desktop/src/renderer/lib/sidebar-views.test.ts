import { describe, expect, it } from "vitest";
import type { AgentState } from "../stores/agents";
import type { LiveProjectGroup } from "./live-tabs";
import { busyCards, isSidebarView, liveSessionCount } from "./sidebar-views";
import { tabKeyTarget } from "./tab-keys";

const agent = (id: string, status: string, activityLevel: string) =>
  ({ id, status, activityLevel }) as unknown as AgentState;

const agents: Record<string, AgentState> = {
  a: agent("a", "running", "busy"),
  b: agent("b", "waiting_input", "idle"),
  c: agent("c", "spawning", "busy"),
  d: agent("d", "completed", "neutral"),
};

const tab = (projectId: string, tabId: string, agentIds: string[]) => ({
  key: `${projectId}:${tabId}`,
  projectId,
  tabId,
  tabLabel: tabId,
  agentIds,
});

describe("busyCards", () => {
  it("keeps only busy sessions, dropping emptied tabs and cards", () => {
    const cards: LiveProjectGroup[] = [
      { projectId: "p1", tabs: [tab("p1", "t1", ["a", "b"]), tab("p1", "t2", ["b"])] },
      { projectId: "p2", tabs: [tab("p2", "t3", ["b"])] },
      { projectId: "p3", tabs: [tab("p3", "t4", ["c"])] },
    ];
    expect(busyCards(cards, agents)).toEqual([
      { projectId: "p1", tabs: [tab("p1", "t1", ["a"])] },
      { projectId: "p3", tabs: [tab("p3", "t4", ["c"])] },
    ]);
  });

  it("an unknown agent id is not busy", () => {
    expect(busyCards([{ projectId: "p", tabs: [tab("p", "t", ["zz"])] }], agents)).toEqual([]);
  });
});

describe("liveSessionCount", () => {
  it("counts running, spawning and waiting sessions", () => {
    expect(liveSessionCount(agents)).toBe(3);
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
