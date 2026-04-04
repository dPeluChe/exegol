import { describe, expect, it } from "vitest";
import { AgentStatusParser, stripAnsi } from "./status-parser";

// ─── stripAnsi ──────────────────────────────────────────────────────────

describe("stripAnsi", () => {
  it("should remove basic ANSI color codes", () => {
    expect(stripAnsi("\x1B[32mhello\x1B[0m")).toBe("hello");
  });

  it("should remove complex ANSI sequences", () => {
    expect(stripAnsi("\x1B[1;31;42mbold red on green\x1B[0m")).toBe("bold red on green");
  });

  it("should handle string without ANSI codes", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });

  it("should handle empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("should handle mixed ANSI and plain text", () => {
    expect(stripAnsi("start \x1B[33mmiddle\x1B[0m end")).toBe("start middle end");
  });
});

// ─── AgentStatusParser — Claude Code ────────────────────────────────────

describe("AgentStatusParser — claude-code", () => {
  it("should detect tool calls", () => {
    const parser = new AgentStatusParser("test", "claude-code");
    const result = parser.parse("Read(src/main.ts)\n");
    expect(result?.currentStep).toBe("Tool: Read");
  });

  it("should detect Edit tool calls", () => {
    const parser = new AgentStatusParser("test", "claude-code");
    const result = parser.parse("Edit(config.json)\n");
    expect(result?.currentStep).toBe("Tool: Edit");
  });

  it("should detect file editing", () => {
    const parser = new AgentStatusParser("test", "claude-code");
    const result = parser.parse("Editing src/utils.ts to add validation\n");
    expect(result?.currentStep).toContain("Editing");
  });

  it("should detect waiting for input", () => {
    const parser = new AgentStatusParser("test", "claude-code");
    const result = parser.parse("Do you want to proceed? (yes/no)\n");
    expect(result?.status).toBe("waiting_input");
  });

  it("should detect errors", () => {
    const parser = new AgentStatusParser("test", "claude-code");
    const result = parser.parse("error: something went wrong\n");
    expect(result?.status).toBe("failed");
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

// ─── AgentStatusParser — Aider ──────────────────────────────────────────

describe("AgentStatusParser — aider", () => {
  it("should detect applied edits", () => {
    const parser = new AgentStatusParser("test", "aider");
    const result = parser.parse("Applied edit to src/main.py\n");
    expect(result?.currentStep).toContain("Applied edit");
    expect(result?.currentStep).toContain("src/main.py");
  });

  it("should detect git diff review", () => {
    const parser = new AgentStatusParser("test", "aider");
    const result = parser.parse("Running git diff\n");
    expect(result?.currentStep).toBe("Reviewing changes...");
  });

  it("should detect traceback errors", () => {
    const parser = new AgentStatusParser("test", "aider");
    const result = parser.parse("Traceback (most recent call last):\n");
    expect(result?.status).toBe("failed");
  });
});

// ─── AgentStatusParser — Codex ──────────────────────────────────────────

describe("AgentStatusParser — codex", () => {
  it("should detect tool calls", () => {
    const parser = new AgentStatusParser("test", "codex");
    const result = parser.parse("calling read_file\n");
    expect(result?.currentStep).toBe("Tool: read_file");
  });

  it("should detect reasoning state", () => {
    const parser = new AgentStatusParser("test", "codex");
    const result = parser.parse("Reasoning about the problem\n");
    expect(result?.currentStep).toBe("Thinking...");
  });
});

// ─── AgentStatusParser — Gemini ─────────────────────────────────────────

describe("AgentStatusParser — gemini", () => {
  it("should detect tool calls", () => {
    const parser = new AgentStatusParser("test", "gemini");
    const result = parser.parse("Using search_tool\n");
    expect(result?.currentStep).toBe("Tool: search_tool");
  });

  it("should detect generating state", () => {
    const parser = new AgentStatusParser("test", "gemini");
    const result = parser.parse("Generating response...\n");
    expect(result?.currentStep).toBe("Thinking...");
  });
});

// ─── AgentStatusParser — Generic ────────────────────────────────────────

describe("AgentStatusParser — generic", () => {
  it("should detect errors for unknown CLI types", () => {
    const parser = new AgentStatusParser("test", "goose" as never);
    const result = parser.parse("error: process exited with code 1\n");
    expect(result?.status).toBe("failed");
  });

  it("should detect test results for unknown CLI types", () => {
    const parser = new AgentStatusParser("test", "goose" as never);
    const result = parser.parse("Tests passed: 42 suites\n");
    expect(result?.currentStep).toContain("Tests passed");
  });
});
