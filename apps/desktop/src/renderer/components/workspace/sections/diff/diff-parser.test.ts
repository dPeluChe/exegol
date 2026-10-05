import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./diff-parser";

describe("parseUnifiedDiff renames", () => {
  it("names both paths of a pure rename (no ---/+++ lines)", () => {
    const raw = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 100%",
      "rename from old.ts",
      "rename to new.ts",
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ].join("\n");
    const [rename, edit] = parseUnifiedDiff(raw);
    expect(rename).toMatchObject({ oldPath: "old.ts", newPath: "new.ts", isRenamed: true });
    expect(rename?.hunks).toEqual([]);
    expect(edit).toMatchObject({ oldPath: "x.ts", newPath: "x.ts", isRenamed: false });
  });

  it("keeps the hunks of a rename with edits", () => {
    const raw = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 80%",
      "rename from old.ts",
      "rename to new.ts",
      "--- a/old.ts",
      "+++ b/new.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ].join("\n");
    const [file] = parseUnifiedDiff(raw);
    expect(file).toMatchObject({ oldPath: "old.ts", newPath: "new.ts", isRenamed: true });
    expect(file?.hunks[0]?.lines).toHaveLength(2);
  });
});
