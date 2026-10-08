import type { Agent } from "@exegol/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { FLEET_SYNC, isPaneAgentStale, useAgentStore } from "./agents";

const row = (id: string, projectId: string, status: string, extra: Partial<Agent> = {}) =>
  ({ id, projectId, cliType: "claude-code", status, taskDescription: "t", ...extra }) as Agent;

const suspended = row("polaris", "tennis", "stopped", { suspendedAt: 1_791_000_000 });
const stale = (agent: Agent) => isPaneAgentStale(agent, useAgentStore.getState());

describe("a pane's ended session after a restart", () => {
  beforeEach(() => useAgentStore.setState({ agents: {}, syncedProjects: {} }));

  it("the fleet list (live agents only) landing first does not release a suspended session", () => {
    useAgentStore.getState().syncFromDb(FLEET_SYNC, [row("live", "tennis", "running")]);
    expect(stale(suspended)).toBe(false);
  });

  it("another project's list landing first does not release it either", () => {
    useAgentStore.getState().syncFromDb("other", [row("o1", "other", "stopped")]);
    expect(stale(suspended)).toBe(false);
  });

  it("its own project's list keeps it: listed, so in the store", () => {
    useAgentStore.getState().syncFromDb(FLEET_SYNC, [row("live", "tennis", "running")]);
    useAgentStore.getState().syncFromDb("tennis", [suspended]);
    expect(stale(suspended)).toBe(false);
    expect(useAgentStore.getState().agents.polaris?.suspended).toBe(true);
  });

  it("an archived session (not in its project's list) is released", () => {
    useAgentStore.getState().syncFromDb("tennis", []);
    expect(stale(row("old", "tennis", "stopped"))).toBe(true);
    expect(stale(row("sh", "tennis", "crashed", { cliType: "shell" }))).toBe(false);
  });
});
