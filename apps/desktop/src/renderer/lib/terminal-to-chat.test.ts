import { describe, expect, it } from "vitest";
import { parseTerminalToChat } from "./terminal-to-chat";

// ─── parseTerminalToChat ──────────────────────────────────────────────────

describe("parseTerminalToChat", () => {
  // ─── Empty input ────────────────────────────────────────────────────

  describe("empty input", () => {
    it("returns empty array for empty string", () => {
      expect(parseTerminalToChat("")).toEqual([]);
    });

    it("returns empty array for whitespace-only string", () => {
      expect(parseTerminalToChat("   \n  \n  ")).toEqual([]);
    });
  });

  // ─── Single agent output block ────────────────────────────────────

  describe("single agent output block", () => {
    it("parses a single agent response as one turn", () => {
      const input = "I found the issue in the code.\nThe bug is on line 42.";
      const result = parseTerminalToChat(input);
      expect(result).toHaveLength(1);
      expect(result[0]!.role).toBe("agent");
      expect(result[0]!.content).toContain("I found the issue");
      expect(result[0]!.content).toContain("line 42");
      expect(result[0]!.lineIndex).toBe(0);
    });
  });

  // ─── User prompt patterns ────────────────────────────────────────

  describe("user prompt patterns", () => {
    it("detects Aider prompt (> text)", () => {
      const result = parseTerminalToChat("> fix the bug in main.ts");
      expect(result).toHaveLength(1);
      expect(result[0]!.role).toBe("user");
      expect(result[0]!.content).toContain("fix the bug");
    });

    it("detects Gemini prompt (❯ text)", () => {
      const result = parseTerminalToChat("❯ refactor this function");
      expect(result).toHaveLength(1);
      expect(result[0]!.role).toBe("user");
      expect(result[0]!.content).toContain("refactor this function");
    });

    it("detects shell prompt ($ command)", () => {
      const result = parseTerminalToChat("$ npm run test");
      expect(result).toHaveLength(1);
      expect(result[0]!.role).toBe("user");
      expect(result[0]!.content).toContain("npm run test");
    });

    it("detects Claude format (Human: text)", () => {
      const result = parseTerminalToChat("Human: explain this code");
      expect(result).toHaveLength(1);
      expect(result[0]!.role).toBe("user");
      expect(result[0]!.content).toContain("explain this code");
    });
  });

  // ─── System patterns ──────────────────────────────────────────────

  describe("system patterns", () => {
    it("detects separator lines as system", () => {
      const result = parseTerminalToChat("───────────────────");
      expect(result).toHaveLength(1);
      expect(result[0]!.role).toBe("system");
    });

    it("detects Session ID banner as system", () => {
      const result = parseTerminalToChat("Session ID: abc123");
      expect(result).toHaveLength(1);
      expect(result[0]!.role).toBe("system");
      expect(result[0]!.content).toContain("abc123");
    });

    it("detects Tips for getting started as system", () => {
      const result = parseTerminalToChat("Tips for getting started with Claude Code");
      expect(result).toHaveLength(1);
      expect(result[0]!.role).toBe("system");
    });
  });

  // ─── Mixed conversation ───────────────────────────────────────────

  describe("mixed conversation", () => {
    it("parses user prompt → agent response → user prompt → agent response", () => {
      const input = [
        "> fix the login bug",
        "I'll look at the login module.",
        "The issue is in auth.ts line 15.",
        "> now add tests",
        "Let me create a test file for the auth module.",
      ].join("\n");

      const result = parseTerminalToChat(input);
      expect(result).toHaveLength(4);
      expect(result[0]!.role).toBe("user");
      expect(result[0]!.content).toContain("fix the login bug");
      expect(result[1]!.role).toBe("agent");
      expect(result[1]!.content).toContain("auth.ts line 15");
      expect(result[2]!.role).toBe("user");
      expect(result[2]!.content).toContain("now add tests");
      expect(result[3]!.role).toBe("agent");
      expect(result[3]!.content).toContain("test file");
    });
  });

  // ─── Claude Code tool patterns ────────────────────────────────────

  describe("Claude Code tool patterns", () => {
    it("detects Read(file) as agent output", () => {
      const input = "Read(file.ts)\nContents of the file...";
      const result = parseTerminalToChat(input);
      expect(result).toHaveLength(1);
      expect(result[0]!.role).toBe("agent");
      expect(result[0]!.content).toContain("Read(file.ts)");
    });

    it("detects Thinking... as agent output", () => {
      const result = parseTerminalToChat("Thinking...");
      expect(result).toHaveLength(1);
      expect(result[0]!.role).toBe("agent");
    });

    it("detects I'll analyze as agent output", () => {
      const result = parseTerminalToChat("I'll analyze the codebase structure.");
      expect(result).toHaveLength(1);
      expect(result[0]!.role).toBe("agent");
    });
  });

  // ─── Consecutive same-role merging ────────────────────────────────

  describe("consecutive same-role merging", () => {
    it("merges consecutive agent lines into one turn", () => {
      const input = [
        "First line of analysis.",
        "Second line of analysis.",
        "Third line of analysis.",
      ].join("\n");

      const result = parseTerminalToChat(input);
      expect(result).toHaveLength(1);
      expect(result[0]!.role).toBe("agent");
      expect(result[0]!.content).toContain("First line");
      expect(result[0]!.content).toContain("Third line");
    });

    it("merges consecutive system lines into one turn", () => {
      const input = ["───────────────────", "Session ID: xyz789"].join("\n");

      const result = parseTerminalToChat(input);
      expect(result).toHaveLength(1);
      expect(result[0]!.role).toBe("system");
    });
  });

  // ─── Empty lines within a turn ────────────────────────────────────

  describe("empty lines within a turn", () => {
    it("preserves empty lines within an agent turn", () => {
      const input = ["First paragraph of response.", "", "Second paragraph after blank line."].join(
        "\n",
      );

      const result = parseTerminalToChat(input);
      expect(result).toHaveLength(1);
      expect(result[0]!.role).toBe("agent");
      expect(result[0]!.content).toContain("First paragraph");
      expect(result[0]!.content).toContain("\n\n");
      expect(result[0]!.content).toContain("Second paragraph");
    });
  });
});
