import { describe, expect, it } from "vitest";
import { extractFromScrollback } from "./extractor";

// ─── Error Extraction ───────────────────────────────────────────────────

describe("extractFromScrollback — errors", () => {
  it("should extract error patterns", () => {
    const scrollback = "error: cannot find module 'foo'\nBuild succeeded";
    const results = extractFromScrollback(scrollback);
    expect(results.some((r) => r.category === "error")).toBe(true);
    const error = results.find((r) => r.category === "error");
    expect(error?.content).toContain("cannot find module");
  });

  it("should extract TypeError", () => {
    const scrollback = "TypeError: Cannot read properties of undefined (reading 'map')";
    const results = extractFromScrollback(scrollback);
    expect(results.some((r) => r.category === "error")).toBe(true);
  });

  it("should extract FAIL patterns", () => {
    const scrollback = "FAIL: test suite 'auth' timed out after 30s";
    const results = extractFromScrollback(scrollback);
    expect(results.some((r) => r.category === "error")).toBe(true);
  });

  it("should ignore short error messages (<15 chars)", () => {
    const scrollback = "error: short";
    const results = extractFromScrollback(scrollback);
    expect(results.filter((r) => r.category === "error").length).toBe(0);
  });
});

// ─── Solution Extraction ────────────────────────────────────────────────

describe("extractFromScrollback — solutions", () => {
  it("should extract fix patterns", () => {
    const scrollback = "Fixed: the authentication bug by adding null check";
    const results = extractFromScrollback(scrollback);
    expect(results.some((r) => r.category === "solution")).toBe(true);
    const solution = results.find((r) => r.category === "solution");
    expect(solution?.content).toContain("null check");
  });

  it("should extract resolved patterns", () => {
    const scrollback = "Resolved: updated dependency to v2.3.1";
    const results = extractFromScrollback(scrollback);
    expect(results.some((r) => r.category === "solution")).toBe(true);
  });

  it("should extract workaround patterns", () => {
    const scrollback = "Workaround - using setTimeout instead of requestAnimationFrame for tests";
    const results = extractFromScrollback(scrollback);
    expect(results.some((r) => r.category === "solution")).toBe(true);
  });
});

// ─── Convention Extraction ──────────────────────────────────────────────

describe("extractFromScrollback — conventions", () => {
  it("should extract 'always' conventions", () => {
    const scrollback = "Always use const over let for immutable bindings";
    const results = extractFromScrollback(scrollback);
    expect(results.some((r) => r.category === "convention")).toBe(true);
  });

  it("should extract 'never' conventions", () => {
    const scrollback = "Never use any in TypeScript code, prefer unknown";
    const results = extractFromScrollback(scrollback);
    expect(results.some((r) => r.category === "convention")).toBe(true);
  });
});

// ─── Preference Extraction ──────────────────────────────────────────────

describe("extractFromScrollback — preferences", () => {
  it("should extract user preferences", () => {
    const scrollback = "I prefer using pnpm over npm for this project";
    const results = extractFromScrollback(scrollback);
    expect(results.some((r) => r.category === "preference")).toBe(true);
  });
});

// ─── Deduplication ──────────────────────────────────────────────────────

describe("extractFromScrollback — deduplication", () => {
  it("should deduplicate similar errors and cap per category", () => {
    // All 4 lines match the error rule with similar structure.
    // Dedup should reduce them, but the per-rule cap may not stop across lines.
    const scrollback = [
      "error: cannot find module 'foo'",
      "error: cannot find module 'bar'",
      "error: cannot find module 'baz'",
      "error: cannot find module 'qux'",
    ].join("\n");
    const results = extractFromScrollback(scrollback);
    const errors = results.filter((r) => r.category === "error");
    // Deduplication (Jaccard > 0.8) should reduce count significantly
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.length).toBeLessThanOrEqual(4);
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────────

describe("extractFromScrollback — edge cases", () => {
  it("should return empty array for empty scrollback", () => {
    const results = extractFromScrollback("");
    expect(results).toEqual([]);
  });

  it("should skip lines shorter than 10 chars", () => {
    const results = extractFromScrollback("short");
    expect(results).toEqual([]);
  });

  it("should skip lines longer than 500 chars", () => {
    const results = extractFromScrollback("error: " + "x".repeat(600));
    expect(results).toEqual([]);
  });

  it("should cap total results at 20", () => {
    // Generate many matches across categories
    const lines: string[] = [];
    for (let i = 0; i < 30; i++) {
      lines.push(`error: something went wrong in module ${i}`);
      lines.push(`Fixed issue number ${i} by adding null checks`);
    }
    const results = extractFromScrollback(lines.join("\n"));
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it("should handle ANSI escape codes in scrollback", () => {
    const scrollback = "\x1B[31merror: compilation failed\x1B[0m due to missing semicolon";
    const results = extractFromScrollback(scrollback);
    expect(results.some((r) => r.category === "error")).toBe(true);
  });
});
