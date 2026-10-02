import { describe, expect, it } from "vitest";
import type { AgentState } from "../stores/agents";
import type { Pane } from "../stores/workspace";
import { describeClose } from "./close-guard";

const agent = (
  id: string,
  cliType: string,
  status: string,
  extra: Partial<AgentState> = {},
): AgentState => ({ id, cliType, status, ...extra }) as AgentState;
const agents = {
  a1: agent("a1", "claude-code", "waiting_input", { alias: "falcon" }),
  a2: agent("a2", "claude-code", "stopped", { alias: "old" }),
  s1: agent("s1", "shell", "running", { taskDescription: "web", currentStep: "npm run dev" }),
  s2: agent("s2", "shell", "running", { taskDescription: "Terminal" }),
};
const pane = (id: string, type: Pane["type"], extra: Partial<Pane> = {}): Pane => ({
  id,
  type,
  ...extra,
});
const none = new Set<string>();

describe("describeClose", () => {
  it("names the agent it stops, and that it can be resumed", () => {
    const s = describeClose([pane("p1", "terminal", { agentId: "a1" })], agents, none);
    expect(s?.title).toBe("Close falcon (claude-code)?");
    expect(s?.lines).toEqual([
      "falcon (claude-code): stops this session.",
      "Its session can be resumed from History.",
    ]);
  });

  it("a terminal says what it stops, or that it waits at its prompt", () => {
    expect(describeClose([pane("p1", "terminal", { agentId: "s1" })], agents, none)).toEqual({
      title: "Close Terminal web?",
      lines: ["Terminal web: ends it and stops npm run dev."],
    });
    expect(describeClose([pane("p2", "terminal", { agentId: "s2" })], agents, none)?.lines).toEqual(
      ["Terminal: ends it (at its prompt)."],
    );
  });

  it("browser, files and an ended session are named; unsaved edits are called out", () => {
    const b = pane("b", "browser", { url: "http://localhost:8007/app" });
    expect(describeClose([b], agents, none)?.title).toBe("Close Browser localhost:8007?");
    expect(describeClose([pane("t", "terminal", { agentId: "a2" })], agents, none)?.lines).toEqual([
      "old: already ended.",
    ]);
    const f = pane("f", "files", { openFile: "/repo/src/app.ts" });
    expect(describeClose([f], agents, new Set(["f"]))?.lines).toEqual([
      "Files app.ts: unsaved changes are lost.",
    ]);
  });

  it("a tab lists each pane; empty panes alone close without asking", () => {
    const s = describeClose(
      [
        pane("p1", "terminal", { agentId: "a1" }),
        pane("p2", "terminal", { agentId: "s1" }),
        pane("p3", "empty"),
      ],
      agents,
      none,
    );
    expect(s?.title).toBe("Close 2 panes?");
    expect(s?.lines).toHaveLength(3);
    expect(describeClose([pane("e", "empty")], agents, none)).toBeNull();
  });
});
