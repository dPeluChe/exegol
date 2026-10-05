import { describe, expect, it } from "vitest";
import type { AgentState } from "../stores/agents";
import { applyRecoveredCrashes } from "./session-recovery";

const agent = (id: string, cliType: string, status = "waiting_input") =>
  ({ id, cliType, status, currentStep: null }) as unknown as AgentState;

describe("applyRecoveredCrashes", () => {
  it("an agent the sweep crashed turns crashed; a shell leaves the store", () => {
    const agents = { a: agent("a", "claude-code"), s: agent("s", "shell"), k: agent("k", "codex") };
    const next = applyRecoveredCrashes(agents, ["a", "s"]);
    expect(next.a?.status).toBe("crashed");
    expect(next.s).toBeUndefined();
    expect(next.k).toBe(agents.k);
  });

  it("nothing to change keeps the same object (no re-render)", () => {
    const agents = { a: agent("a", "claude-code", "crashed") };
    expect(applyRecoveredCrashes(agents, ["a", "unknown"])).toBe(agents);
    expect(applyRecoveredCrashes(agents, [])).toBe(agents);
  });
});
