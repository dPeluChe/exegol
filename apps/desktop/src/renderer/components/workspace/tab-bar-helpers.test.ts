import type { AgentActivityLevel, AgentStatus } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import type { LayoutNode, Pane } from "../../stores/workspace";
import { getTabMeta, tabDotClass, tabSignal } from "./tab-bar-helpers";

const layout: LayoutNode = { type: "pane", paneId: "p1" };
const panes = { p1: { id: "p1", type: "terminal", agentId: "a1" } as Pane };

describe("getTabMeta for an agent tab", () => {
  it("follows the session alias once it has one", () => {
    const agents = { a1: { cliType: "claude-code", alias: "lupus" } };
    const meta = getTabMeta("Tab 2", layout, panes, agents);
    expect(meta.displayName).toBe("lupus");
    expect(meta.agentCliType).toBe("claude-code");
  });

  it("treats a label the app copied from the agent as automatic", () => {
    const agents = { a1: { cliType: "claude-code", alias: "lupus" } };
    expect(getTabMeta("claude-code", layout, panes, agents).displayName).toBe("lupus");
    expect(getTabMeta("Claude Code", layout, panes, agents).displayName).toBe("lupus");
  });

  it("keeps a name the user typed", () => {
    const agents = { a1: { cliType: "claude-code", alias: "lupus" } };
    expect(getTabMeta("billing fix", layout, panes, agents).displayName).toBe("billing fix");
  });

  it("falls back to the CLI without an alias, and a shell gets no agent icon", () => {
    expect(getTabMeta("Tab 1", layout, panes, { a1: { cliType: "codex" } }).displayName).toBe(
      "codex",
    );
    expect(
      getTabMeta("Tab 1", layout, panes, { a1: { cliType: "shell" } }).agentCliType,
    ).toBeNull();
  });
});

describe("tabSignal", () => {
  const both = {
    p1: { id: "p1", type: "terminal", agentId: "a1" } as Pane,
    p2: { id: "p2", type: "terminal", agentId: "a2" } as Pane,
  };
  const agent = (activityLevel: AgentActivityLevel, status: AgentStatus = "running") => ({
    status,
    activityLevel,
  });

  it("sees a session in any pane of the tab, not only the first", () => {
    const signal = tabSignal(
      ["p1", "p2"],
      both,
      { a1: agent("idle"), a2: agent("busy") },
      { a2: { level: "action_needed", read: false } },
    );
    expect(signal).toEqual({ needsYou: true, unread: true, activity: "busy" });
  });

  it("keeps an open dialog as needing you once read", () => {
    const signal = tabSignal(
      ["p1"],
      both,
      { a1: agent("idle", "waiting_input") },
      { a1: { level: "action_needed", read: true } },
    );
    expect(signal).toEqual({ needsYou: true, unread: false, activity: "idle" });
  });

  it("marks an unread notice with the dot, not the badge", () => {
    const signal = tabSignal(
      ["p1"],
      both,
      { a1: agent("neutral") },
      { a1: { level: "info", read: false } },
    );
    expect(signal).toEqual({ needsYou: false, unread: true, activity: undefined });
    expect(tabDotClass(signal)).toContain("amber");
  });

  it("skips panes without a session", () => {
    const signal = tabSignal(["p1"], { p1: { id: "p1", type: "browser" } as Pane }, {}, {});
    expect(signal).toEqual({ needsYou: false, unread: false, activity: undefined });
    expect(tabDotClass(signal)).toBeNull();
  });
});
