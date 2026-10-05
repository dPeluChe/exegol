import type { Agent } from "@exegol/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { turnTime } from "../lib/busy-time";
import { toAgentState, useAgentStore } from "./agents";

const HOUR = 3_600_000;
const row = (id: string, statusChangedAt: number | null, status = "waiting_input") =>
  ({
    id,
    projectId: "p",
    cliType: "claude-code",
    status,
    taskDescription: "t",
    statusChangedAt,
  }) as Agent;

describe("time in state survives an app start", () => {
  beforeEach(() => useAgentStore.setState({ agents: {} }));

  it("a session first seen from the DB counts from its status change, not from now", () => {
    const changed = Date.now() - 2 * HOUR;
    useAgentStore.getState().syncFromDb("p", [row("a1", changed)]);
    const a = useAgentStore.getState().agents.a1;
    expect(a?.activitySince).toBe(changed);
    expect(turnTime(a as NonNullable<typeof a>, changed + 2 * HOUR)?.seconds).toBe(7200);
  });

  it("toAgentState and addAgent keep the durable stamp; a row without one starts now", () => {
    const changed = Date.now() - HOUR;
    const store = useAgentStore.getState();
    store.addAgent(toAgentState(row("a1", changed)));
    const before = Date.now();
    store.addAgent(toAgentState(row("a2", null)));
    expect(useAgentStore.getState().agents.a1?.activitySince).toBe(changed);
    expect(useAgentStore.getState().agents.a2?.activitySince).toBeGreaterThanOrEqual(before);
  });

  it("a status push carries the change time into a new level", () => {
    const store = useAgentStore.getState();
    store.addAgent(toAgentState(row("a1", Date.now() - HOUR, "running")));
    const pushed = Date.now() - 5_000;
    store.updateAgent("a1", { status: "waiting_input", activitySince: pushed });
    expect(useAgentStore.getState().agents.a1?.activitySince).toBe(pushed);
  });
});
