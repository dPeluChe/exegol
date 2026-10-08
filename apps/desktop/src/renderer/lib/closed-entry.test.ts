import { describe, expect, it } from "vitest";
import type { AgentState } from "../stores/agents";
import {
  MAX_RECENTLY_CLOSED,
  pushClosed,
  restoreClosedInto,
  tabCloseTarget,
} from "../stores/workspace/helpers";
import type { ClosedEntry, ProjectWorkspace } from "../stores/workspace/types";
import { closedEntryFor, closedTitle, freshOnly } from "./closed-entry";

const agents = {
  a1: { id: "a1", cliType: "claude-code", status: "running", alias: "besalt" },
  a2: { id: "a2", cliType: "codex", status: "waiting_input", alias: "kilo" },
  s1: { id: "s1", cliType: "shell", status: "running", taskDescription: "Terminal" },
  old: { id: "old", cliType: "claude-code", status: "stopped", alias: "old" },
} as unknown as Record<string, AgentState>;

const pw = (): ProjectWorkspace => ({
  tabs: [
    { id: "t0", label: "main", layout: { type: "pane", paneId: "e" } },
    {
      id: "t1",
      label: "api",
      layout: {
        type: "split",
        direction: "horizontal",
        sizes: [50, 50],
        children: [
          { type: "pane", paneId: "p1" },
          {
            type: "split",
            direction: "vertical",
            sizes: [50, 50],
            children: [
              { type: "pane", paneId: "p2" },
              { type: "pane", paneId: "p3" },
            ],
          },
        ],
      },
    },
  ],
  activeTabId: "t1",
  panes: {
    e: { id: "e", type: "empty" },
    p1: { id: "p1", type: "terminal", agentId: "a1" },
    p2: { id: "p2", type: "terminal", agentId: "s1" },
    p3: { id: "p3", type: "terminal", agentId: "old" },
  },
});

describe("closedEntryFor", () => {
  it("a tab keeps its layout, index and its live sessions (shell cwd included)", () => {
    const target = tabCloseTarget(pw(), "t1");
    if (!target) throw new Error("no target");
    const entry = closedEntryFor("P", pw(), target, agents, { p2: "/repo/web" }, 5);
    expect(entry?.kind).toBe("tab");
    expect(entry?.tab?.index).toBe(1);
    expect(entry?.sessions.map((s) => [s.paneId, s.name, s.cwd])).toEqual([
      ["p1", "besalt", undefined],
      ["p2", "Terminal", "/repo/web"],
    ]);
    expect(closedTitle(entry as ClosedEntry)).toBe("Closed tab api (besalt, Terminal)");
  });

  it("a pane remembers the pane it sat beside", () => {
    const entry = closedEntryFor(
      "P",
      pw(),
      { tabId: "t1", paneId: "p2", paneIds: ["p2"], closesTab: false },
      agents,
      {},
    );
    expect(entry?.slot).toEqual({
      tabId: "t1",
      siblingPaneId: "p3",
      direction: "vertical",
      before: true,
    });
  });

  it("launchers only: nothing to reopen", () => {
    const target = tabCloseTarget(pw(), "t0");
    if (!target) throw new Error("no target");
    expect(closedEntryFor("P", pw(), target, agents, {})).toBeNull();
  });

  it("a CLI that cannot resume is called out", () => {
    const entry = {
      sessions: [
        { cliType: "claude-code", name: "besalt" },
        { cliType: "codex", name: "kilo" },
        { cliType: "shell", name: "Terminal" },
      ],
    } as ClosedEntry;
    expect(freshOnly(entry, new Set(["claude-code"])).map((s) => s.name)).toEqual(["kilo"]);
  });
});

describe("restoreClosedInto", () => {
  it("a pane goes back into its slot beside the same sibling", () => {
    const before = pw();
    const entry = closedEntryFor(
      "P",
      before,
      { tabId: "t1", paneId: "p2", paneIds: ["p2"], closesTab: false },
      agents,
      {},
    ) as ClosedEntry;
    const t1 = before.tabs[1];
    if (!t1 || t1.layout.type !== "split") throw new Error("fixture");
    const without: ProjectWorkspace = {
      ...before,
      tabs: [
        before.tabs[0] as (typeof before.tabs)[0],
        {
          ...t1,
          layout: {
            ...t1.layout,
            children: [t1.layout.children[0]!, { type: "pane", paneId: "p3" }],
          },
        },
      ],
    };
    const { pw: restored, paneId } = restoreClosedInto(without, entry);
    expect(paneId).toBe("p2");
    expect(restored.tabs[1]?.layout).toMatchObject({
      children: [
        { type: "pane", paneId: "p1" },
        {
          type: "split",
          direction: "vertical",
          children: [
            { type: "pane", paneId: "p2" },
            { type: "pane", paneId: "p3" },
          ],
        },
      ],
    });
    expect(restored.panes.p2).toEqual({ id: "p2", type: "empty" });
  });

  it("a pane whose sibling is gone comes back in a tab of its own", () => {
    const entry: ClosedEntry = {
      id: "x",
      projectId: "P",
      closedAt: 1,
      kind: "pane",
      label: "Browser",
      slot: { tabId: "gone", siblingPaneId: "z", direction: "horizontal", before: false },
      panes: [{ id: "b", type: "browser", url: "http://localhost:3000" }],
      sessions: [],
    };
    const { pw: restored, tabId } = restoreClosedInto(pw(), entry);
    expect(restored.tabs.at(-1)).toMatchObject({ id: tabId, label: "Browser" });
    expect(restored.panes.b?.url).toBe("http://localhost:3000");
  });
});

describe("pushClosed", () => {
  it("newest first, capped", () => {
    let list: ClosedEntry[] = [];
    for (let i = 0; i < MAX_RECENTLY_CLOSED + 3; i++) {
      list = pushClosed(list, { id: `e${i}` } as ClosedEntry);
    }
    expect(list).toHaveLength(MAX_RECENTLY_CLOSED);
    expect(list[0]?.id).toBe(`e${MAX_RECENTLY_CLOSED + 2}`);
  });
});
