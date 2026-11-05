import { describe, expect, it } from "vitest";
import {
  AgentStatusParser,
  parseResumeCommandFromPattern,
  parseSessionId,
  stripAnsi,
} from "./status-parser";

// ─── stripAnsi ──────────────────────────────────────────────────────────

describe("stripAnsi", () => {
  it("should handle empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("should strip cursor movement sequences, a CSI with no parameters included", () => {
    expect(stripAnsi("\x1B[2Jhello\x1B[H")).toBe("hello");
  });
});

// ─── AgentStatusParser — Claude Code ────────────────────────────────────

describe("AgentStatusParser — claude-code", () => {
  it("should detect Edit tool calls", () => {
    const parser = new AgentStatusParser("test", "claude-code");
    const result = parser.parse("Edit(config.json)\n");
    expect(result?.currentStep).toBe("Tool: Edit");
  });

  it("should detect thinking state", () => {
    const parser = new AgentStatusParser("test", "claude-code");
    const result = parser.parse("Thinking about the solution...\n");
    expect(result?.currentStep).toBe("Thinking...");
  });

  it("should return null for irrelevant output", () => {
    const parser = new AgentStatusParser("test", "claude-code");
    const result = parser.parse("Some random output line\n");
    expect(result).toBeNull();
  });

  it("should handle partial lines (buffered)", () => {
    const parser = new AgentStatusParser("test", "claude-code");
    const r1 = parser.parse("Read(sr");
    expect(r1).toBeNull(); // incomplete line
    const r2 = parser.parse("c/main.ts)\n");
    expect(r2?.currentStep).toBe("Tool: Read");
  });
});

// ─── AgentStatusParser — Codex ──────────────────────────────────────────

describe("AgentStatusParser — codex", () => {
  it("should detect reasoning state", () => {
    const parser = new AgentStatusParser("test", "codex");
    const result = parser.parse("Reasoning about the problem\n");
    expect(result?.currentStep).toBe("Thinking...");
  });
});

// ─── parseResumeCommandFromPattern ─────────────────────────────────────

describe("parseResumeCommandFromPattern", () => {
  it("should return null for empty pattern", () => {
    expect(parseResumeCommandFromPattern("", "claude --resume abc123")).toBeNull();
  });

  it("should extract each CLI's resume command", () => {
    const cases = [
      ["claude --resume ", "To resume this session: claude --resume abc123def456"],
      ["gemini --resume ", "Run: gemini --resume session-xyz-789"],
      ["codex resume ", "Continue with: codex resume my-session-id-42"],
      ["opencode -s ", "Resume: opencode -s sess_abc123xyz"],
      ["cursor-agent --resume=", "To resume this session: cursor-agent --resume=3f2a-chat-id"],
    ] as const;
    expect(cases.map(([pattern, line]) => parseResumeCommandFromPattern(pattern, line))).toEqual([
      "claude --resume abc123def456",
      "gemini --resume session-xyz-789",
      "codex resume my-session-id-42",
      "opencode -s sess_abc123xyz",
      "cursor-agent --resume=3f2a-chat-id",
    ]);
  });

  it("should return null for non-matching line", () => {
    expect(parseResumeCommandFromPattern("claude --resume ", "some unrelated output")).toBeNull();
  });

  it("should return null when pattern is longer than content", () => {
    expect(parseResumeCommandFromPattern("claude --resume ", "short")).toBeNull();
  });

  it("should truncate at box-drawing character │", () => {
    const result = parseResumeCommandFromPattern("claude --resume ", "│ claude --resume abc123 │");
    expect(result).toBe("claude --resume abc123");
  });
});

// ─── parseSessionId ────────────────────────────────────────────────────

describe("parseSessionId", () => {
  it("should extract session ID from plain line", () => {
    expect(parseSessionId("Session ID: abc123def456")).toBe("abc123def456");
  });

  it("should extract session ID from box-drawn line", () => {
    expect(parseSessionId("│ Session ID: a1b2c3d4e5f6 │")).toBe("a1b2c3d4e5f6");
  });

  it("should capture full UUID format", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(parseSessionId(`Session ID: ${uuid}`)).toBe(uuid);
  });

  it("should return null for short ID (< 8 chars)", () => {
    expect(parseSessionId("Session ID: abc")).toBeNull();
  });

  it("should return null when no match", () => {
    expect(parseSessionId("some random output")).toBeNull();
  });
});
