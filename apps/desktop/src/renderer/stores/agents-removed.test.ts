import type { Agent } from "@exegol/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { FLEET_SYNC, syncedStatus, toAgentState, useAgentStore } from "./agents";
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

  it("the fleet list omitting it does not end the guard: the archive may not have landed", () => {
    const store = useAgentStore.getState();
    store.addAgent(toAgentState(row("a1")));
    store.removeAgent("a1");
    store.syncFromDb(FLEET_SYNC, []);
    store.syncFromDb("p", [row("a1", "waiting_input")]);
    expect(useAgentStore.getState().agents.a1).toBeUndefined();
  });

  it("a list fetched before the exit does not bring an ended session back to live", () => {
    const store = useAgentStore.getState();
    store.addAgent(toAgentState(row("a1", "waiting_input")));
    store.updateAgent("a1", { status: "stopped" });
    store.syncFromDb(FLEET_SYNC, [row("a1", "waiting_input")]);
    expect(useAgentStore.getState().agents.a1?.status).toBe("stopped");
    expect(syncedStatus("crashed", "running")).toBe("crashed");
    expect(syncedStatus("running", "stopped")).toBe("stopped");
    expect(syncedStatus("running", "waiting_input")).toBe("waiting_input");
  });

  it("closing a pinned session unpins it", () => {
    useWatchStore.setState({ watched: ["a1", "a2"], open: ["a1"], cardFont: { a1: 14 } });
    useAgentStore.getState().removeAgent("a1");
    expect(useWatchStore.getState()).toMatchObject({ watched: ["a2"], open: [], cardFont: {} });
  });
});
