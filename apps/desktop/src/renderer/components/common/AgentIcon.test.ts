import { AGENT_CLI_TYPES } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { hasAgentIcon } from "./AgentIcon";

// No license for their marks that covers bundling them: both stay on the letters fallback
const LETTERS_ONLY = new Set<string>(["shell", "custom", "grok", "cursor"]);

describe("agent icons", () => {
  it("every built-in agent CLI has its own image", () => {
    const missing = AGENT_CLI_TYPES.filter((id) => !LETTERS_ONLY.has(id) && !hasAgentIcon(id));
    expect(missing).toEqual([]);
  });

  it("IDEs with an official mark in assets resolve to it", () => {
    for (const id of ["vscode", "zed", "devin-desktop", "agy"]) expect(hasAgentIcon(id)).toBe(true);
  });
});
