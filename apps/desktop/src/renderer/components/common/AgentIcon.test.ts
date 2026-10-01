import { AGENT_CLI_TYPES } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { hasAgentIcon } from "./AgentIcon";

describe("agent icons", () => {
  it("every built-in agent CLI has its own image", () => {
    const missing = AGENT_CLI_TYPES.filter(
      (id) => id !== "shell" && id !== "custom" && !hasAgentIcon(id),
    );
    expect(missing).toEqual([]);
  });
});
