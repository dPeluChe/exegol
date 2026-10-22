import type { Agent } from "@exegol/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { FLEET_SYNC, useAgentStore } from "./agents";

const row = (id: string, extra: Partial<Agent> = {}) =>
  ({
    id,
    projectId: "p",
    cliType: "claude-code",
    status: "running",
    taskDescription: "t",
    modelRoles: { advisor: "opus" },
    ...extra,
  }) as Agent;

describe("syncFromDb keeps identities when the list brings nothing new", () => {
  beforeEach(() => {
    useAgentStore.setState({ agents: {}, attentionItems: {}, syncedProjects: {} });
    const store = useAgentStore.getState();
    store.syncFromDb("p", [row("a1"), row("a2")]);
    // The first merge fills fields a new row lacks; from here on the values are settled
    store.syncFromDb("p", [row("a1"), row("a2")]);
  });

  it("returns the same state when nothing changed, modelRoles parsed into a new object", () => {
    const before = useAgentStore.getState();
    before.syncFromDb("p", [row("a1"), row("a2")]);
    expect(useAgentStore.getState()).toBe(before);
    before.syncFromDb(FLEET_SYNC, [row("a1"), row("a2")]);
    expect(useAgentStore.getState()).toBe(before);
  });

  it("replaces only the agent that changed", () => {
    const before = useAgentStore.getState().agents;
    useAgentStore.getState().syncFromDb("p", [row("a1", { alias: "kestrel" }), row("a2")]);
    const after = useAgentStore.getState().agents;
    expect(after).not.toBe(before);
    expect(after.a1).not.toBe(before.a1);
    expect(after.a1?.alias).toBe("kestrel");
    expect(after.a2).toBe(before.a2);
  });

  it("a changed model role replaces the agent", () => {
    const before = useAgentStore.getState().agents;
    useAgentStore.getState().syncFromDb("p", [row("a1", { modelRoles: { advisor: "sonnet" } })]);
    expect(useAgentStore.getState().agents.a1).not.toBe(before.a1);
    expect(useAgentStore.getState().agents.a1?.modelRoles).toEqual({ advisor: "sonnet" });
  });

  it("a new agent from the list changes the map", () => {
    const before = useAgentStore.getState();
    before.syncFromDb("p", [row("a1"), row("a2"), row("a3")]);
    const after = useAgentStore.getState().agents;
    expect(after).not.toBe(before.agents);
    expect(after.a1).toBe(before.agents.a1);
    expect(after.a3?.id).toBe("a3");
  });
});
