import { describe, expect, it } from "vitest";
import { useAgentStore } from "../../stores/agents";
import { resumedAgentId } from "./use-spawn-agent";

describe("resumedAgentId", () => {
  it("a past session picked in the launcher is the one resumed", () => {
    const session = { agentId: "old" } as never;
    expect(resumedAgentId({ session, localSessionId: null })).toBe("old");
  });

  it("Claude's own session picked by name maps to the agent that ran it", () => {
    useAgentStore.setState({
      agents: { a1: { id: "a1", claudeSessionId: "sess-1" } as never },
    });
    expect(resumedAgentId({ session: null, localSessionId: "sess-1" })).toBe("a1");
    expect(resumedAgentId({ session: null, localSessionId: "other" })).toBeNull();
    expect(resumedAgentId({ session: "last", localSessionId: null })).toBeNull();
  });
});
