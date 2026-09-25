import { describe, expect, it } from "vitest";
import { pickLostSession } from "./index";
import type { LocalSession } from "./types";

const at = (sessionId: string, startedAt: number | null, endedAt: number): LocalSession => ({
  provider: "claude-code",
  sessionId,
  title: null,
  cwd: "/repo",
  branch: null,
  startedAt,
  endedAt,
  version: null,
  sizeBytes: 1,
});

describe("pickLostSession", () => {
  const agentStart = 1_790_277_987;

  it("picks the session that began right after the agent (real case: 11s later)", () => {
    const sessions = [
      at("older", agentStart - 86_400, agentStart - 80_000),
      at("mine", agentStart + 11, agentStart + 4000),
    ];
    expect(pickLostSession(sessions, agentStart, new Set())?.sessionId).toBe("mine");
  });

  it("skips sessions another agent already owns", () => {
    const sessions = [
      at("taken", agentStart + 5, agentStart + 100),
      at("free", agentStart + 40, agentStart + 100),
    ];
    expect(pickLostSession(sessions, agentStart, new Set(["taken"]))?.sessionId).toBe("free");
  });

  it("falls back to a conversation already open when the agent began (a resume)", () => {
    const sessions = [
      at("resumed", agentStart - 3600, agentStart + 900),
      at("closed", agentStart - 7200, agentStart - 7000),
    ];
    expect(pickLostSession(sessions, agentStart, new Set())?.sessionId).toBe("resumed");
  });

  it("returns null rather than guess when nothing overlaps the agent", () => {
    const sessions = [
      at("unrelated", agentStart + 3600, agentStart + 4000),
      at("nostart", null, agentStart + 10),
    ];
    expect(pickLostSession(sessions, agentStart, new Set())).toBeNull();
  });
});
