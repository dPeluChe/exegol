import { describe, expect, it } from "vitest";
import type { AgentState } from "../stores/agents";
import type { Pane } from "../stores/workspace";
import { resolveCloseTarget } from "../stores/workspace/helpers";
import type { ProjectWorkspace } from "../stores/workspace/types";
import { closeTargetPanes, describeClose } from "./close-guard";

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
const REOPEN = "You can reopen it with Cmd+Shift+T.";

describe("describeClose", () => {
  it("names the agent it stops, and that it can be resumed", () => {
    const s = describeClose([pane("p1", "terminal", { agentId: "a1" })], agents, none);
    expect(s?.title).toBe("Close pane falcon (claude-code)?");
    expect(s?.lines).toEqual([
      "falcon (claude-code): stops this session.",
      "Its session can be resumed from History.",
      REOPEN,
    ]);
  });

  it("a terminal says what it stops, or that it waits at its prompt", () => {
    expect(describeClose([pane("p1", "terminal", { agentId: "s1" })], agents, none)).toEqual({
      title: "Close pane Terminal web?",
      lines: ["Terminal web: ends it and stops npm run dev.", REOPEN],
    });
    expect(describeClose([pane("p2", "terminal", { agentId: "s2" })], agents, none)?.lines).toEqual(
      ["Terminal: ends it (at its prompt).", REOPEN],
    );
  });

  it("browser, files and an ended session are named; unsaved edits are called out", () => {
    const b = pane("b", "browser", { url: "http://localhost:8007/app" });
    expect(describeClose([b], agents, none)?.title).toBe("Close pane Browser localhost:8007/app?");
    expect(describeClose([pane("t", "terminal", { agentId: "a2" })], agents, none)?.lines).toEqual([
      "old: already ended.",
      REOPEN,
    ]);
    const f = pane("f", "files", { openFile: "/repo/src/app.ts" });
    expect(describeClose([f], agents, new Set(["f"]))?.lines).toEqual([
      "Files app.ts: unsaved changes are lost.",
      REOPEN,
    ]);
  });

  it("a tab is named and lists each pane; empty panes alone close without asking", () => {
    const s = describeClose(
      [
        pane("p1", "terminal", { agentId: "a1" }),
        pane("p2", "terminal", { agentId: "s1" }),
        pane("p3", "empty"),
      ],
      agents,
      none,
      { kind: "tab", label: "api" },
    );
    expect(s?.title).toBe("Close tab api?");
    expect(s?.lines).toEqual([
      "falcon (claude-code): stops this session.",
      "Terminal web: ends it and stops npm run dev.",
      "Its session can be resumed from History.",
      REOPEN,
    ]);
    expect(
      describeClose([pane("e", "empty")], agents, none, { kind: "tab", label: "x" }),
    ).toBeNull();
  });
});

describe("closeTargetPanes", () => {
  const pw: ProjectWorkspace = {
    tabs: [
      { id: "live", label: "besalt", layout: { type: "pane", paneId: "agent" } },
      { id: "blank", label: "Tab 2", layout: { type: "pane", paneId: "launcher" } },
    ],
    activeTabId: "blank",
    panes: {
      agent: { id: "agent", type: "terminal", agentId: "a1" },
      launcher: { id: "launcher", type: "empty" },
    },
  };

  it("what the dialog lists is what the close takes: the empty tab asks nothing", () => {
    const target = resolveCloseTarget(pw, "agent");
    expect(target).toEqual({
      tabId: "blank",
      paneId: "launcher",
      paneIds: ["launcher"],
      closesTab: true,
    });
    const { panes, scope } = closeTargetPanes(pw, target as NonNullable<typeof target>);
    expect(panes.map((p) => p.id)).toEqual(["launcher"]);
    expect(describeClose(panes, agents, none, scope)).toBeNull();
  });
});
