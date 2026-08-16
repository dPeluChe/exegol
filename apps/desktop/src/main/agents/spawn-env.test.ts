import { describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({ mkdirSync: vi.fn(), writeFileSync: vi.fn() }));
vi.mock("node:fs", () => fs);
vi.mock("../mcp/exegol-mcp-config", () => ({ resolveClaimGuardPath: () => "/bundle/guard.js" }));

import { buildClaudeCodeHooksFile, slugifyBranchName } from "./spawn-env";

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

    expect(hooks.Notification).toHaveLength(1);
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

  it("omits the guard when claims cannot collide", () => {
    const hooks = written("a1", { enforceClaims: false });
    expect(hooks.PreToolUse).toHaveLength(1);
  });
});
