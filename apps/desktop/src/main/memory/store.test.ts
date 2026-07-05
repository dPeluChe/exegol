import type { MemoryCategory, MemoryEntry } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { buildMemoryContext } from "./store";

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: "mem1",
    projectId: "proj1",
    category: "error" as MemoryCategory,
    content: "TypeError: Cannot read undefined",
    sourceAgentId: null,
    relevanceScore: 0.8,
    accessCount: 0,
    createdAt: Math.floor(Date.now() / 1000),
    lastAccessedAt: Math.floor(Date.now() / 1000),
    reinforcementCount: 1,
    lastReinforcedAt: Math.floor(Date.now() / 1000),
    supersededBy: null,
    ...overrides,
  };
}

describe("buildMemoryContext", () => {
  it("should return empty string for empty memories", () => {
    expect(buildMemoryContext([])).toBe("");
  });

  it("should group memories by category", () => {
    const memories = [
      makeEntry({ category: "error", content: "TypeError: Cannot read undefined" }),
      makeEntry({ category: "solution", content: "Fixed by adding null check" }),
      makeEntry({ category: "error", content: "FAIL: test suite timed out" }),
    ];
    const context = buildMemoryContext(memories);
    expect(context).toContain("# Project Memory");
    expect(context).toContain("### Known Errors");
    expect(context).toContain("### Solutions");
    expect(context).toContain("TypeError");
    expect(context).toContain("null check");
    expect(context).toContain("timed out");
  });

  it("should include all category labels", () => {
    const categories: MemoryCategory[] = [
      "preference",
      "pattern",
      "error",
      "solution",
      "dependency",
      "convention",
    ];
    const memories = categories.map((category) =>
      makeEntry({ category, content: `Content for ${category}` }),
    );
    const context = buildMemoryContext(memories);
    expect(context).toContain("### Preferences");
    expect(context).toContain("### Patterns");
    expect(context).toContain("### Known Errors");
    expect(context).toContain("### Solutions");
    expect(context).toContain("### Dependencies");
    expect(context).toContain("### Conventions");
  });

  it("should format items as bullet list", () => {
    const memories = [makeEntry({ content: "Use strict mode always" })];
    const context = buildMemoryContext(memories);
    expect(context).toContain("- Use strict mode always");
  });
});
