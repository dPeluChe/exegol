import { describe, expect, it } from "vitest";
import { slugifyBranchName } from "./spawn-env";

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
