import { describe, expect, it } from "vitest";
import { sessionNameIndex } from "./index";
import type { LocalSession } from "./types";

const session = (
  provider: string,
  sessionId: string,
  title: string | null,
  name?: string | null,
): LocalSession => ({
  provider,
  sessionId,
  title,
  name,
  cwd: "/repo",
  branch: null,
  startedAt: null,
  endedAt: null,
  version: null,
  sizeBytes: 1,
});

describe("sessionNameIndex", () => {
  it("prefers the /rename name, falls back to the title, keys by provider and id", () => {
    const names = sessionNameIndex([
      session("claude-code", "a", "fix the build", "X equal Dev"),
      session("codex", "a", "codex title"),
      session("claude-code", "b", "only a title", "  "),
      session("opencode", "c", null),
    ]);
    expect(names.get("claude-code:a")).toBe("X equal Dev");
    expect(names.get("codex:a")).toBe("codex title");
    expect(names.get("claude-code:b")).toBe("only a title");
    expect(names.has("opencode:c")).toBe(false);
  });
});
