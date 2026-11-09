import type { Agent } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { withStatusPush } from "./floating-chat";

const row = {
  id: "a1",
  projectId: "p1",
  cliType: "claude-code",
  status: "running",
  currentStep: "Thinking",
  launchedInShell: false,
  statusChangedAt: 100,
  claudeSessionId: "s1",
} as Agent;

describe("withStatusPush", () => {
  it("takes the pushed status and keeps what the push leaves out", () => {
    const next = withStatusPush(row, {
      status: "stopped",
      currentStep: null,
      cliType: "claude-code",
    });
    expect(next).toMatchObject({
      status: "stopped",
      currentStep: null,
      statusChangedAt: 100,
      claudeSessionId: "s1",
      launchedInShell: false,
    });
  });

  it("moves the status time when main sends one", () => {
    const next = withStatusPush(row, {
      status: "waiting_input",
      currentStep: null,
      cliType: "claude-code",
      statusChangedAt: 200,
    });
    expect(next.statusChangedAt).toBe(200);
  });
});
