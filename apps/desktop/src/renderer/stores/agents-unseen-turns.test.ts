import type { Agent } from "@exegol/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { toAgentState, useAgentStore } from "./agents";
import { useAppStore } from "./app";

const row = (id: string, cliType = "claude-code") =>
  ({ id, projectId: "p", cliType, status: "waiting_input", taskDescription: "t" }) as Agent;
const unseen = () => useAgentStore.getState().unseenTurns;

describe("unseen turns", () => {
  beforeEach(() => {
    useAgentStore.setState({ agents: {}, unseenTurns: {}, focusedAgentId: null });
    useAppStore.setState({ activeView: "workspace" });
    useAgentStore.getState().addAgent(toAgentState(row("a")));
  });

  it("marks a session you were not on, until you focus it", () => {
    const store = useAgentStore.getState();
    store.noteTurnUnseen("a");
    expect(unseen()).toEqual({ a: "p" });
    store.setFocusedAgent("a");
    expect(unseen()).toEqual({});
  });

  it("skips the focused pane, unless the Dashboard covers it", () => {
    const store = useAgentStore.getState();
    store.setFocusedAgent("a");
    store.noteTurnUnseen("a");
    expect(unseen()).toEqual({});
    useAppStore.setState({ activeView: "dashboard" });
    store.noteTurnUnseen("a");
    expect(unseen()).toEqual({ a: "p" });
  });

  it("raises no attention item or unread count", () => {
    useAgentStore.getState().noteTurnUnseen("a");
    expect(useAgentStore.getState().attentionItems.a).toBeUndefined();
    expect(useAgentStore.getState().unreadAttentionCount).toBe(0);
  });

  it("forgets a session the DB no longer lists, only in that project", () => {
    useAgentStore.setState({ unseenTurns: { a: "p", gone: "p", other: "q" } });
    useAgentStore.getState().syncFromDb("p", [row("a")]);
    expect(unseen()).toEqual({ a: "p", other: "q" });
  });
});
