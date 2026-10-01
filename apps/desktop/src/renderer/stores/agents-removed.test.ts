import type { Agent } from "@exegol/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { toAgentState, useAgentStore } from "./agents";
import { useWatchStore } from "./watch";

const row = (id: string, status = "running") =>
  ({ id, projectId: "p", cliType: "claude-code", status, taskDescription: "t" }) as Agent;

describe("closing a session vs a sync already on its way", () => {
  beforeEach(() => {
    useAgentStore.setState({ agents: {} });
    useWatchStore.setState({ watched: [], open: [], cardFont: {} });
  });

  it("a stale sync that still lists it as live does not bring it back", () => {
    const store = useAgentStore.getState();
    store.addAgent(toAgentState(row("a1")));
    store.removeAgent("a1");
    store.syncFromDb("p", [row("a1")]);
    expect(useAgentStore.getState().agents.a1).toBeUndefined();
  });

  it("once the DB stops listing it, the same id can come back (a restore)", () => {
    const store = useAgentStore.getState();
    store.addAgent(toAgentState(row("a1")));
    store.removeAgent("a1");
    store.syncFromDb("p", []);
    store.syncFromDb("p", [row("a1", "stopped")]);
    expect(useAgentStore.getState().agents.a1?.status).toBe("stopped");
  });

  it("closing a pinned session unpins it", () => {
    useWatchStore.setState({ watched: ["a1", "a2"], open: ["a1"], cardFont: { a1: 14 } });
    useAgentStore.getState().removeAgent("a1");
    expect(useWatchStore.getState()).toMatchObject({ watched: ["a2"], open: [], cardFont: {} });
  });
});
