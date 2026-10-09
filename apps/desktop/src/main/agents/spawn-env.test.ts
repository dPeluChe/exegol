import { describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({ mkdirSync: vi.fn(), writeFileSync: vi.fn() }));
vi.mock("node:fs", () => fs);
vi.mock("../mcp/exegol-mcp-config", () => ({ resolveClaimGuardPath: () => "/bundle/guard.js" }));

import { buildClaudeCodeHooksFile, deriveStatusFromSignal, slugifyBranchName } from "./spawn-env";

describe("slugifyBranchName", () => {
  it("should slugify a simple description", () => {
    expect(slugifyBranchName("Fix login bug")).toBe("exegol/fix-login-bug");
  });

  it("should prefix with exegol/", () => {
    const result = slugifyBranchName("some task");
    expect(result).toMatch(/^exegol\//);
  });

  it("should convert to lowercase", () => {
    expect(slugifyBranchName("FIX THE BUG")).toBe("exegol/fix-the-bug");
  });

  it("should replace spaces with hyphens", () => {
    expect(slugifyBranchName("add new feature")).toBe("exegol/add-new-feature");
  });

  it("should collapse multiple hyphens", () => {
    expect(slugifyBranchName("fix  --  bug")).toBe("exegol/fix-bug");
  });

  it("should remove non-alphanumeric chars (except hyphens/spaces)", () => {
    expect(slugifyBranchName("Fix bug #123!")).toBe("exegol/fix-bug-123");
  });

  it("should truncate to 50 chars after prefix", () => {
    const long = "a".repeat(100);
    const result = slugifyBranchName(long);
    // "exegol/" (8) + max 50 chars
    expect(result.length).toBeLessThanOrEqual(58);
  });

  it("should not end with a hyphen", () => {
    expect(slugifyBranchName("task ")).not.toMatch(/-$/);
  });

  it("should handle single word", () => {
    expect(slugifyBranchName("refactor")).toBe("exegol/refactor");
  });

  it("should handle already-clean input", () => {
    expect(slugifyBranchName("add-user-auth")).toBe("exegol/add-user-auth");
  });

  it("should handle empty string", () => {
    expect(slugifyBranchName("")).toBe("exegol/");
  });
});

// The hooks file is an external contract owned by Claude Code: a wrong shape
// does not throw, it silently stops delivering signals and enforcement.
describe("buildClaudeCodeHooksFile", () => {
  function written(agentId: string, opts?: { enforceClaims?: boolean }) {
    fs.writeFileSync.mockClear();
    buildClaudeCodeHooksFile(agentId, opts);
    const [, json] = fs.writeFileSync.mock.calls[0] as [string, string];
    return JSON.parse(json).hooks as Record<string, { matcher?: string; hooks: unknown[] }[]>;
  }

  it("keeps the OSC signal entries and adds an anchored, time-boxed guard", () => {
    const hooks = written("a1", { enforceClaims: true });

    expect(hooks.Notification).toHaveLength(2);
    expect(hooks.Stop).toHaveLength(1);
    const [signal, guard] = hooks.PreToolUse ?? [];
    expect(signal?.matcher).toBeUndefined(); // matcher-less = every tool
    expect(guard?.matcher).toBe("^(Edit|Write|MultiEdit|NotebookEdit)$");
    expect(guard?.hooks[0]).toMatchObject({
      type: "command",
      timeout: 5,
      command: expect.stringContaining("/bundle/guard.js"),
    });
  });

  // Claude's idle reminder ("waiting for your input", 60s after a reply) is no question: read as
  // one, an idle agent looked like it awaited an answer and dictation went to the clipboard
  it("signals attention on a question, never on the idle reminder", () => {
    const matcher = written("a1").Notification?.[0]?.matcher;
    // Claude's rule for a plain name list: split on | or , and each part equals the type
    const fires = (type: string) =>
      matcher === undefined || matcher.split(/[|,]/).some((part) => part.trim() === type);
    expect(matcher).toMatch(/^[A-Za-z0-9_|, -]+$/);
    for (const asks of [
      "permission_prompt",
      "elicitation_dialog",
      "elicitation_url_dialog",
      "agent_needs_input",
      "worker_permission_prompt",
    ]) {
      expect(fires(asks)).toBe(true);
    }
    for (const notice of ["idle_prompt", "auth_success", "elicitation_complete"]) {
      expect(fires(notice)).toBe(false);
    }
  });

  // Claude's rule for a plain name list: split on | or , and each part equals the value
  const fires = (matcher: string | undefined, value: string) =>
    matcher === undefined || matcher.split(/[|,]/).some((part) => part.trim() === value);
  const signalOf = (entry: { hooks: unknown[] } | undefined) =>
    String((entry?.hooks[0] as { command?: string } | undefined)?.command).match(
      /;a1;([a-z_]+)\\007/,
    )?.[1];

  // startup|resume fire before a CLI-arg prompt is submitted; idle_prompt covers idle starts
  it("signals idle on clear and the idle reminder, never on startup, resume or compact", () => {
    const hooks = written("a1");
    const start = hooks.SessionStart?.[0];
    expect(signalOf(start)).toBe("idle");
    expect(fires(start?.matcher, "clear")).toBe(true);
    for (const source of ["startup", "resume", "compact"]) {
      expect(fires(start?.matcher, source)).toBe(false);
    }

    const reminder = hooks.Notification?.[1];
    expect(signalOf(reminder)).toBe("idle");
    expect(fires(reminder?.matcher, "idle_prompt")).toBe(true);
    expect(fires(reminder?.matcher, "permission_prompt")).toBe(false);
    expect(signalOf(hooks.Notification?.[0])).toBe("attention");
  });

  // Claude adds SessionStart stdout to the model context
  it("never falls back to stdout on SessionStart", () => {
    const hooks = written("a1");
    const command = (entry: { hooks: unknown[] } | undefined) =>
      String((entry?.hooks[0] as { command?: string } | undefined)?.command);
    expect(command(hooks.SessionStart?.[0])).toMatch(/> \/dev\/tty 2>\/dev\/null \|\| true$/);
    expect(command(hooks.Stop?.[0])).toMatch(/\|\| printf '/);
  });

  it("omits the guard when claims cannot collide", () => {
    const hooks = written("a1", { enforceClaims: false });
    expect(hooks.PreToolUse).toHaveLength(1);
  });
});

describe("deriveStatusFromSignal", () => {
  it("idle is waiting_input with no turn end and no attention", () => {
    expect(deriveStatusFromSignal("idle")).toEqual({ status: "waiting_input", idleOnly: true });
  });

  it("finished ends a turn and attention asks", () => {
    expect(deriveStatusFromSignal("finished")).toMatchObject({ status: "waiting_input" });
    expect(deriveStatusFromSignal("finished").turnEnded).toBeTypeOf("number");
    expect(deriveStatusFromSignal("attention").needsAttention).toBe(true);
  });
});
