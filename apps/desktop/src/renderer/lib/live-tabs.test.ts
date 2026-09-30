import { describe, expect, it } from "vitest";
import {
  assignGroupShortcuts,
  computeLiveTabGroups,
  type LiveTabGroup,
  projectShortcuts,
  reorderKeys,
} from "./live-tabs";

const pane = (paneId: string) => ({ type: "pane" as const, paneId });
const pw = (tabs: { id: string; label: string; panes: Record<string, string> }[]) =>
  ({
    tabs: tabs.map((t) => ({
      id: t.id,
      label: t.label,
      layout:
        Object.keys(t.panes).length === 1
          ? pane(Object.keys(t.panes)[0] ?? "")
          : {
              type: "split",
              direction: "horizontal",
              children: Object.keys(t.panes).map(pane),
              sizes: [50, 50],
            },
    })),
    activeTabId: null,
    panes: Object.fromEntries(
      tabs.flatMap((t) =>
        Object.entries(t.panes).map(([p, agentId]) => [p, { id: p, type: "terminal", agentId }]),
      ),
    ),
  }) as never;

const agents = {
  a: { id: "a", status: "running" },
  b: { id: "b", status: "waiting_input" },
  c: { id: "c", status: "crashed" },
  d: { id: "d", status: "running" },
} as never;

describe("computeLiveTabGroups", () => {
  const workspaces = {
    wed: pw([{ id: "t1", label: "Main", panes: { p1: "a", p2: "b" } }]),
    ex: pw([
      { id: "t2", label: "Old", panes: { p3: "c" } },
      { id: "t3", label: "Dev", panes: { p4: "d" } },
    ]),
  };

  it("one group per tab with live sessions; ended ones do not count", () => {
    const groups = computeLiveTabGroups(workspaces, agents, []);
    expect(groups.map((g) => [g.key, g.agentIds])).toEqual([
      ["wed:t1", ["a", "b"]],
      ["ex:t3", ["d"]],
    ]);
  });

  it("follows the user's drag order, new tabs after it", () => {
    expect(computeLiveTabGroups(workspaces, agents, ["ex:t3"]).map((g) => g.key)).toEqual([
      "ex:t3",
      "wed:t1",
    ]);
  });
});

describe("reorderKeys", () => {
  it("dropping on the group below moves it down (it used to land back in place)", () => {
    expect(reorderKeys(["a", "b", "c"], "a", "b")).toEqual(["b", "a", "c"]);
    expect(reorderKeys(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
  });
  it("dropping on a group above moves it up", () => {
    expect(reorderKeys(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });
});

const group = (key: string, projectId: string, agentIds = [`${key}-agent`]): LiveTabGroup => ({
  key,
  projectId,
  tabId: key,
  tabLabel: key,
  agentIds,
});

describe("assignGroupShortcuts", () => {
  it("numbers 2..9 then 0 in the sidebar's order; the tenth group has none", () => {
    const groups = "abcdefghij".split("").map((k) => group(k, k));
    const map = assignGroupShortcuts(groups, {}, new Set());
    expect(groups.map((g) => map.get(g.key) ?? null)).toEqual([
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "0",
      null,
    ]);
  });

  it("groups whose every session is pinned go last (Cmd+1 already reaches them)", () => {
    const groups = [group("pinned", "p1"), group("free", "p2")];
    const map = assignGroupShortcuts(groups, {}, new Set(["pinned-agent"]));
    expect([map.get("free"), map.get("pinned")]).toEqual(["2", "3"]);
  });

  it("a mixed group (one pinned session, one not) keeps its place", () => {
    const groups = [group("mixed", "p1", ["x", "y"]), group("other", "p2")];
    const map = assignGroupShortcuts(groups, {}, new Set(["x"]));
    expect([map.get("mixed"), map.get("other")]).toEqual(["2", "3"]);
  });

  it("a number given in Edit project stays, even pinned; the rest fill around it", () => {
    const groups = [group("a", "pa"), group("b", "pb"), group("c", "pc")];
    const map = assignGroupShortcuts(groups, { pc: "2", pb: "8" }, new Set(["b-agent"]));
    expect([map.get("a"), map.get("b"), map.get("c")]).toEqual(["3", "8", "2"]);
  });

  it("an assigned number stays reserved while its project is idle", () => {
    const map = assignGroupShortcuts([group("a", "pa")], { idle: "2" }, new Set());
    expect(map.get("a")).toBe("3");
  });

  it("only a project's first live tab takes its number; its other tabs fill free ones", () => {
    const groups = [group("t1", "p1"), group("t2", "p1")];
    const map = assignGroupShortcuts(groups, { p1: "5" }, new Set());
    expect([map.get("t1"), map.get("t2")]).toEqual(["5", "2"]);
  });
});

describe("projectShortcuts", () => {
  it("gives each project the digit of its first live group that has one", () => {
    const groups = [group("a1", "a"), group("b1", "b"), group("a2", "a")];
    const map = projectShortcuts(groups, assignGroupShortcuts(groups, {}, new Set()));
    expect([map.get("a"), map.get("b")]).toEqual(["2", "3"]);
  });
});
