import { describe, expect, it } from "vitest";
import { useAgentStore } from "../../stores/agents";
import { resumedAgentId, startFolder } from "./use-spawn-agent";
import { canLaunchForm, sessionAfterSwitch } from "./use-spawn-form";

describe("startFolder (T204)", () => {
  const base = { folder: "/p/web", useWorktree: false, session: null, localSessionId: null };
  it("a new session, Continue last or a Claude session by name start in the launcher's folder", () => {
    expect(startFolder(base)).toBe("/p/web");
    expect(startFolder({ ...base, session: "last" })).toBe("/p/web");
    expect(startFolder({ ...base, localSessionId: "s1" })).toBe("/p/web");
  });
  it("the root and a worktree keep the normal start rules", () => {
    expect(startFolder({ ...base, folder: undefined })).toBeUndefined();
    expect(startFolder({ ...base, useWorktree: true })).toBeUndefined();
  });
  it("a past session resumes where it ran (main reads its folder)", () => {
    expect(startFolder({ ...base, session: { agentId: "old" } as never })).toBeUndefined();
  });
});

describe("form state on an agent switch (T204)", () => {
  const past = { agentId: "a1", cliType: "claude-code" } as never;
  it("drops Continue last and another agent's session, keeps its own", () => {
    expect(sessionAfterSwitch("last", "codex")).toBeNull();
    expect(sessionAfterSwitch(past, "codex")).toBeNull();
    expect(sessionAfterSwitch(past, "claude-code")).toBe(past);
    expect(sessionAfterSwitch(null, "codex")).toBeNull();
  });
  it("launches only an installed agent with a valid model", () => {
    const provider = { installed: true } as never;
    expect(canLaunchForm({ providerId: "codex", provider, model: "" }, false)).toBe(true);
    expect(canLaunchForm({ providerId: "codex", provider, model: "bad model!" }, false)).toBe(
      false,
    );
    expect(
      canLaunchForm(
        { providerId: "codex", provider: { installed: false } as never, model: "" },
        false,
      ),
    ).toBe(false);
    expect(canLaunchForm({ providerId: "codex", provider, model: "" }, true)).toBe(false);
  });
});

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
