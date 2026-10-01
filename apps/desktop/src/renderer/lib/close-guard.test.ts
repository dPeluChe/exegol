import { describe, expect, it } from "vitest";
import type { AgentState } from "../stores/agents";
import type { Pane } from "../stores/workspace";
import { describeClose } from "./close-guard";

const agent = (id: string, cliType: string, status: string, alias?: string) =>
  ({ id, cliType, status, alias }) as AgentState;
const agents = {
  a1: agent("a1", "claude-code", "waiting_input", "falcon"),
  a2: agent("a2", "claude-code", "stopped", "old"),
  s1: agent("s1", "shell", "waiting_input"),
};
const pane = (id: string, type: Pane["type"], agentId?: string): Pane => ({ id, type, agentId });
const none = new Set<string>();

describe("describeClose", () => {
  it("names the live agent it stops", () => {
    const s = describeClose([pane("p1", "terminal", "a1")], agents, none);
    expect(s?.title).toBe("Close falcon?");
    expect(s?.lines[0]).toContain("Stops falcon");
  });

  it("a live terminal says it ends what runs in it", () => {
    expect(describeClose([pane("p1", "terminal", "s1")], agents, none)?.lines).toEqual([
      "Ends 1 terminal and whatever runs in it.",
    ]);
  });

  it("browser, files and an ended session still ask; unsaved edits are called out", () => {
    expect(describeClose([pane("b", "browser")], agents, none)?.lines).toEqual([
      "Closes 1 browser pane.",
    ]);
    expect(describeClose([pane("t", "terminal", "a2")], agents, none)?.title).toBe(
      "Close this pane?",
    );
    expect(describeClose([pane("f", "files")], agents, new Set(["f"]))?.lines).toEqual([
      "Unsaved file changes in 1 pane are lost.",
    ]);
  });

  it("a tab sums it up; empty panes alone close without asking", () => {
    const s = describeClose(
      [pane("p1", "terminal", "a1"), pane("p2", "terminal", "s1"), pane("p3", "empty")],
      agents,
      none,
    );
    expect(s?.title).toBe("Close 3 panes?");
    expect(s?.lines).toHaveLength(2);
    expect(describeClose([pane("e", "empty")], agents, none)).toBeNull();
  });
});
