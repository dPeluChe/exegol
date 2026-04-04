import type { HandoffSummary } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import {
  detectTokenLimitWarning,
  formatHandoffForInjection,
  generateHandoffFromScrollback,
} from "./handoff";

// ─── Token Limit Detection ──────────────────────────────────────────────

describe("detectTokenLimitWarning", () => {
  it("should detect 'context window' warning", () => {
    expect(detectTokenLimitWarning("Warning: context window is almost full")).toBe(true);
  });

  it("should detect 'token limit' warning", () => {
    expect(detectTokenLimitWarning("Approaching token limit")).toBe(true);
  });

  it("should detect 'maximum context' warning", () => {
    expect(detectTokenLimitWarning("Maximum context exceeded")).toBe(true);
  });

  it("should detect 'truncating context' warning", () => {
    expect(detectTokenLimitWarning("Truncating context to fit")).toBe(true);
  });

  it("should not trigger on normal output", () => {
    expect(detectTokenLimitWarning("Writing file src/main.ts")).toBe(false);
  });

  it("should not trigger on empty line", () => {
    expect(detectTokenLimitWarning("")).toBe(false);
  });
});

// ─── Handoff Summary Generation ─────────────────────────────────────────

describe("generateHandoffFromScrollback", () => {
  it("should extract file modifications from Edit()", () => {
    const scrollback = "Editing src/main.ts\nEditing lib/parser.rs\nEditing src/main.ts";
    const result = generateHandoffFromScrollback("Fix bug", scrollback);
    expect(result.filesModified).toContain("src/main.ts");
    expect(result.filesModified).toContain("lib/parser.rs");
    expect(result.goal).toBe("Fix bug");
  });

  it("should extract file modifications from Write()", () => {
    const scrollback = 'Writing "new-file.ts"';
    const result = generateHandoffFromScrollback("Create new file", scrollback);
    expect(result.filesModified).toContain("new-file.ts");
  });

  it("should extract tool call progress", () => {
    const scrollback = "Read(file1.ts)\nEdit(file2.ts)\nBash(npm test)\nRead(file3.ts)";
    const result = generateHandoffFromScrollback("Refactor", scrollback);
    expect(result.progress).toContain("Read");
    expect(result.progress).toContain("Edit");
    expect(result.progress).toContain("Bash");
  });

  it("should extract critical context from last 500 chars", () => {
    const padding = "x".repeat(600);
    const tail = "FINAL OUTPUT: all tests pass";
    const result = generateHandoffFromScrollback("Test", padding + tail);
    expect(result.criticalContext).toContain("FINAL OUTPUT");
  });

  it("should handle empty scrollback", () => {
    const result = generateHandoffFromScrollback("Empty task", "");
    expect(result.filesModified).toBe("None detected");
    expect(result.goal).toBe("Empty task");
  });

  it("should detect aider-style edits", () => {
    const scrollback = "Applied edit to src/utils.py";
    const result = generateHandoffFromScrollback("Fix utils", scrollback);
    expect(result.filesModified).toContain("src/utils.py");
  });
});

// ─── Handoff Formatting ─────────────────────────────────────────────────

describe("formatHandoffForInjection", () => {
  it("should format a complete handoff", () => {
    const handoff: HandoffSummary = {
      id: "h1",
      agentId: "a1",
      successorAgentId: null,
      goal: "Fix login bug",
      progress: "Used tools: Edit, Bash. 5 total tool calls.",
      filesModified: "src/auth.ts, tests/auth.test.ts",
      nextSteps: "Continue from where the previous agent left off.",
      criticalContext: "Last 500 chars of output...",
      createdAt: Date.now(),
    };

    const formatted = formatHandoffForInjection(handoff);
    expect(formatted).toContain("[HANDOFF from previous agent]");
    expect(formatted).toContain("## Goal\nFix login bug");
    expect(formatted).toContain("## Progress");
    expect(formatted).toContain("## Files Modified\nsrc/auth.ts, tests/auth.test.ts");
    expect(formatted).toContain("## Next Steps");
    expect(formatted).toContain("## Critical Context");
    expect(formatted).toContain("context window was exhausted");
  });
});
