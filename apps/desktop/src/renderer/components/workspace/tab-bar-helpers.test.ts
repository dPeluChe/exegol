import { describe, expect, it } from "vitest";
import type { LayoutNode, Pane } from "../../stores/workspace";
import { getTabMeta } from "./tab-bar-helpers";

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
