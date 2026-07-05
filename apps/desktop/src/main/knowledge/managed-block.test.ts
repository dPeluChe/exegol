import { describe, expect, it } from "vitest";
import { upsertManagedBlockContent } from "./managed-block";

describe("upsertManagedBlockContent", () => {
  it("appends the managed block to an empty file", () => {
    const result = upsertManagedBlockContent("");
    expect(result).toContain("<!-- exegol:knowledge:begin -->");
    expect(result).toContain("<!-- exegol:knowledge:end -->");
    expect(result).toContain(".exegol/knowledge/");
  });

  it("appends the managed block after existing content", () => {
    const result = upsertManagedBlockContent("# My Project\n\nSome existing instructions.\n");
    expect(result).toContain("# My Project");
    expect(result).toContain("Some existing instructions.");
    expect(result).toContain("<!-- exegol:knowledge:begin -->");
  });

  it("replaces an existing managed block in place, preserving surrounding content", () => {
    const before = [
      "# My Project",
      "",
      "<!-- exegol:knowledge:begin -->",
      "stale pointer text",
      "<!-- exegol:knowledge:end -->",
      "",
      "## Other section",
    ].join("\n");

    const result = upsertManagedBlockContent(before);
    expect(result).toContain("# My Project");
    expect(result).toContain("## Other section");
    expect(result).not.toContain("stale pointer text");
    expect(result.match(/<!-- exegol:knowledge:begin -->/g)?.length).toBe(1);
  });

  it("is idempotent — running twice produces the same result", () => {
    const once = upsertManagedBlockContent("# My Project\n");
    const twice = upsertManagedBlockContent(once);
    expect(twice).toBe(once);
  });
});
