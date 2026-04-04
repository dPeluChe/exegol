import { describe, expect, it } from "vitest";
import { parseTier1FromScrollback } from "./scoring";

// ─── Tier 1: File Modifications ─────────────────────────────────────────

describe("parseTier1FromScrollback — file modifications", () => {
  it("should detect Edit() calls", () => {
    const scrollback = "Edit(src/main.ts)\nEdit(lib/parser.rs)";
    const result = parseTier1FromScrollback(scrollback);
    expect(result.filesChanged).toBe(2);
    expect(result.filesModifiedCount).toBe(2);
  });

  it("should detect Write() calls", () => {
    const scrollback = "Write(config.json)";
    const result = parseTier1FromScrollback(scrollback);
    expect(result.filesChanged).toBe(1);
  });

  it("should deduplicate files from Edit and Write", () => {
    const scrollback = "Edit(src/main.ts)\nWrite(src/main.ts)";
    const result = parseTier1FromScrollback(scrollback);
    expect(result.filesChanged).toBe(1);
  });

  it("should detect aider edit pattern", () => {
    const scrollback = "Applied edit to src/utils.py";
    const result = parseTier1FromScrollback(scrollback);
    expect(result.filesChanged).toBe(1);
    expect(result.filesModifiedCount).toBe(1);
  });

  it("should return 0 files for no modifications", () => {
    const scrollback = "Thinking...\nAnalyzing the task...\nDone!";
    const result = parseTier1FromScrollback(scrollback);
    expect(result.filesChanged).toBe(0);
  });
});

// ─── Tier 1: Compilation ────────────────────────────────────────────────

describe("parseTier1FromScrollback — compilation", () => {
  it("should detect successful compilation", () => {
    const scrollback = "Build succeeded\nAll checks passed";
    const result = parseTier1FromScrollback(scrollback);
    expect(result.compiles).toBe(true);
  });

  it("should detect failed compilation", () => {
    const scrollback = "Build failed: 3 errors\ncompilation failed";
    const result = parseTier1FromScrollback(scrollback);
    expect(result.compiles).toBe(false);
  });

  it("should return null when no compilation signals", () => {
    const scrollback = "Editing files...\nDone!";
    const result = parseTier1FromScrollback(scrollback);
    expect(result.compiles).toBeNull();
  });

  it("should detect tsc errors", () => {
    const scrollback = "tsc error TS2304: Cannot find name 'foo'";
    const result = parseTier1FromScrollback(scrollback);
    expect(result.compiles).toBe(false);
  });
});

// ─── Tier 1: Tests ──────────────────────────────────────────────────────

describe("parseTier1FromScrollback — tests", () => {
  it("should detect passing tests", () => {
    const scrollback = "Tests passed: 42\nAll green!";
    const result = parseTier1FromScrollback(scrollback);
    expect(result.testsPassed).toBe(true);
  });

  it("should detect failing tests", () => {
    const scrollback = "Tests failed: 3\nFAIL test_foo";
    const result = parseTier1FromScrollback(scrollback);
    expect(result.testsPassed).toBe(false);
  });

  it("should return null when no test signals", () => {
    const scrollback = "Writing code...\nEditing...";
    const result = parseTier1FromScrollback(scrollback);
    expect(result.testsPassed).toBeNull();
  });
});

// ─── Tier 1: Task Completion ────────────────────────────────────────────

describe("parseTier1FromScrollback — task completion", () => {
  it("should detect task completion", () => {
    const scrollback = "Successfully completed all changes";
    const result = parseTier1FromScrollback(scrollback);
    expect(result.taskCompleted).toBe(true);
  });

  it("should detect 'Task completed' signal", () => {
    const scrollback = "Task completed!";
    const result = parseTier1FromScrollback(scrollback);
    expect(result.taskCompleted).toBe(true);
  });

  it("should default to false without signals", () => {
    const scrollback = "Working on it...";
    const result = parseTier1FromScrollback(scrollback);
    expect(result.taskCompleted).toBe(false);
  });
});

// ─── Tier 1: Turn Counting ──────────────────────────────────────────────

describe("parseTier1FromScrollback — turn counting", () => {
  it("should count tool calls", () => {
    const scrollback = "Read(file.ts)\nEdit(file.ts)\nBash(npm test)\nGlob(**/*.ts)";
    const result = parseTier1FromScrollback(scrollback);
    expect(result.turnsUsed).toBe(4);
  });

  it("should count 0 turns without tool calls", () => {
    const scrollback = "Thinking...\nDone!";
    const result = parseTier1FromScrollback(scrollback);
    expect(result.turnsUsed).toBe(0);
  });
});

// ─── Tier 1: Empty scrollback ───────────────────────────────────────────

describe("parseTier1FromScrollback — edge cases", () => {
  it("should handle empty scrollback", () => {
    const result = parseTier1FromScrollback("");
    expect(result.filesChanged).toBe(0);
    expect(result.compiles).toBeNull();
    expect(result.testsPassed).toBeNull();
    expect(result.taskCompleted).toBe(false);
    expect(result.turnsUsed).toBe(0);
  });
});
