import { describe, expect, it } from "vitest";
import {
  assignProjectShortcuts,
  computeLiveTabGroups,
  groupByProject,
  type LiveTabGroup,
  PANELESS_TAB,
  reorderKeys,
  reorderProjectOrder,
  withPanelessSessions,
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

  it("follows the user's project order, new projects after it", () => {
    expect(computeLiveTabGroups(workspaces, agents, ["ex"]).map((g) => g.key)).toEqual([
      "ex:t3",
      "wed:t1",
    ]);
  });

  it("an unnamed tab reads as Tab N, by its place in the project", () => {
    const unnamed = {
      p: pw([
        { id: "t1", label: "", panes: { p1: "c" } },
        { id: "t2", label: "", panes: { p2: "a" } },
      ]),
    };
    expect(computeLiveTabGroups(unnamed, agents, []).map((g) => g.tabLabel)).toEqual(["Tab 2"]);
  });

  it("a project's tabs stay together in tab order, wherever its project sits", () => {
    const many = {
      a: pw([
        { id: "a1", label: "A1", panes: { p1: "a" } },
        { id: "a2", label: "A2", panes: { p2: "b" } },
      ]),
      b: pw([{ id: "b1", label: "B1", panes: { p3: "d" } }]),
    };
    expect(computeLiveTabGroups(many, agents, ["b", "a"]).map((g) => g.key)).toEqual([
      "b:b1",
      "a:a1",
      "a:a2",
    ]);
  });

  it("the shortcut numbers follow the project order", () => {
    const many = {
      a: pw([{ id: "a1", label: "A1", panes: { p1: "a" } }]),
      b: pw([{ id: "b1", label: "B1", panes: { p2: "d" } }]),
    };
    const map = assignProjectShortcuts(
      computeLiveTabGroups(many, agents, ["b", "a"]),
      {},
      new Set(),
    );
    expect([map.get("b"), map.get("a")]).toEqual(["2", "3"]);
  });
});

describe("groupByProject", () => {
  it("one card per project with its tabs, in the groups' order", () => {
    const cards = groupByProject([group("a1", "a"), group("a2", "a"), group("b1", "b")]);
    expect(cards.map((c) => [c.projectId, c.tabs.map((t) => t.key)])).toEqual([
      ["a", ["a1", "a2"]],
      ["b", ["b1"]],
    ]);
  });
});

describe("withPanelessSessions", () => {
  const live = (id: string, projectId: string, extra: object = {}) => ({
    id,
    projectId,
    status: "waiting_input",
    cliType: "devin",
    ...extra,
  });

  it("a live session no pane shows joins its project's card, never a second one", () => {
    const tabs = [group("t1", "p", ["a"])];
    const all = {
      a: live("a", "p"),
      orphan: live("orphan", "p"),
      other: live("other", "q"),
    } as never;
    const cards = groupByProject(withPanelessSessions(tabs, all));
    expect(cards.map((c) => [c.projectId, c.tabs.map((t) => [t.tabId, t.agentIds])])).toEqual([
      [
        "p",
        [
          ["t1", ["a"]],
          [PANELESS_TAB, ["orphan"]],
        ],
      ],
      ["q", [[PANELESS_TAB, ["other"]]]],
    ]);
  });

  it("archived, suspended, ended sessions and shells without a pane are not listed", () => {
    const all = {
      archived: live("archived", "p", { archived: true }),
      suspended: live("suspended", "p", { suspended: true }),
      stopped: live("stopped", "p", { status: "stopped" }),
      shell: live("shell", "p", { cliType: "shell" }),
    } as never;
    expect(withPanelessSessions([], all)).toEqual([]);
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

describe("reorderProjectOrder", () => {
  it("reorders the live cards and keeps idle saved projects after them, in their order", () => {
    expect(reorderProjectOrder(["b", "d"], ["a", "b", "c", "d", "e"], "d", "b")).toEqual([
      "d",
      "b",
      "a",
      "c",
      "e",
    ]);
  });
  it("a live project the saved order never had joins it", () => {
    expect(reorderProjectOrder(["a", "n"], ["a", "x"], "a", "n")).toEqual(["n", "a", "x"]);
  });
});

const group = (key: string, projectId: string, agentIds = [`${key}-agent`]): LiveTabGroup => ({
  key,
  projectId,
  tabId: key,
  tabLabel: key,
  agentIds,
});

describe("assignProjectShortcuts", () => {
  it("numbers 2..9 then 0 in the sidebar's order; the tenth project has none", () => {
    const groups = "abcdefghij".split("").map((k) => group(k, k));
    const map = assignProjectShortcuts(groups, {}, new Set());
    expect(groups.map((g) => map.get(g.projectId) ?? null)).toEqual([
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

  it("one number per project, placed at its first group", () => {
    const groups = [group("a1", "a"), group("a2", "a"), group("b1", "b"), group("a3", "a")];
    const map = assignProjectShortcuts(groups, {}, new Set());
    expect([...map]).toEqual([
      ["a", "2"],
      ["b", "3"],
    ]);
  });

  it("projects whose every session is pinned go last (Cmd+1 already reaches them)", () => {
    const groups = [group("pinned", "p1"), group("free", "p2")];
    const map = assignProjectShortcuts(groups, {}, new Set(["pinned-agent"]));
    expect([map.get("p2"), map.get("p1")]).toEqual(["2", "3"]);
  });

  it("a project with one unpinned session in any of its tabs keeps its place", () => {
    const groups = [group("t1", "p1", ["x"]), group("other", "p2"), group("t2", "p1", ["y"])];
    const map = assignProjectShortcuts(groups, {}, new Set(["x"]));
    expect([map.get("p1"), map.get("p2")]).toEqual(["2", "3"]);
  });

  it("a number given in Edit project stays, even pinned; the rest fill around it", () => {
    const groups = [group("a", "pa"), group("b", "pb"), group("c", "pc")];
    const map = assignProjectShortcuts(groups, { pc: "2", pb: "8" }, new Set(["b-agent"]));
    expect([map.get("pa"), map.get("pb"), map.get("pc")]).toEqual(["3", "8", "2"]);
  });

  it("an assigned number stays with its idle project; idle projects get no automatic one", () => {
    const map = assignProjectShortcuts([group("a", "pa")], { idle: "2" }, new Set());
    expect([...map]).toEqual([
      ["idle", "2"],
      ["pa", "3"],
    ]);
  });
});
