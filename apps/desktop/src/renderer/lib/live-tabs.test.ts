import { describe, expect, it } from "vitest";
import { computeLiveTabGroups, groupShortcut, reorderKeys } from "./live-tabs";

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

  it("Cmd+1 is the Dashboard: the first group is ⌘2, the eighth ⌘9, then none", () => {
    expect([groupShortcut(0), groupShortcut(7), groupShortcut(8)]).toEqual(["⌘2", "⌘9", null]);
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
