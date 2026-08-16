import { describe, expect, it } from "vitest";
import { truncateDiffForPrompt } from "./diff-budget";

function fileSection(path: string, bodyLines: number): string {
  const body = Array.from({ length: bodyLines }, (_, i) => `+line ${i} in ${path}`).join("\n");
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n${body}\n`;
}

describe("truncateDiffForPrompt", () => {
  it("returns the diff untouched when it fits", () => {
    const diff = fileSection("src/a.ts", 3);
    expect(truncateDiffForPrompt(diff, 10_000)).toBe(diff);
  });

  it("keeps every file present instead of dropping the tail", () => {
    // The failure this replaces: a huge generated file sorts first and head
    // truncation means the model never sees the hand-written change after it.
    const diff = `${fileSection("pnpm-lock.yaml", 4_000)}\n${fileSection("src/auth.ts", 5)}`;
    const out = truncateDiffForPrompt(diff, 2_000);

    expect(out.length).toBeLessThanOrEqual(2_000);
    expect(out).toContain("diff --git a/pnpm-lock.yaml");
    expect(out).toContain("diff --git a/src/auth.ts");
    // The small file is small enough to survive whole.
    expect(out).toContain("line 4 in src/auth.ts");
  });

  it("hands slack from files that fit back to the file that doesn't", () => {
    const big = fileSection("big.ts", 2_000);
    const small = fileSection("small.ts", 1);
    const out = truncateDiffForPrompt(`${big}\n${small}`, 3_000);

    const bigKept = (out.split("diff --git a/small.ts")[0] ?? "").length;
    // An even split would give the big file ~1500; water-filling gives it far
    // more, because `small.ts` only needs ~120 characters.
    expect(bigKept).toBeGreaterThan(2_500);
  });

  it("marks what it removed and never cuts mid-line", () => {
    const out = truncateDiffForPrompt(fileSection("solo.ts", 500), 900);

    expect(out).toMatch(/\.\.\.\(diff truncated, \d+ characters omitted\)/);
    const kept = out.split("\n...(diff truncated")[0] ?? "";
    // Every retained line is whole.
    expect(kept.endsWith("\n") || kept.split("\n").pop()?.startsWith("+line")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(900);
  });

  it("degrades to the marker alone rather than overflowing a tiny budget", () => {
    const out = truncateDiffForPrompt(fileSection("x.ts", 100), 20);
    expect(out.length).toBeLessThanOrEqual(20);
  });

  it("handles a single-file diff with no boundary to split on", () => {
    const out = truncateDiffForPrompt("a".repeat(5_000), 1_000);
    expect(out.length).toBeLessThanOrEqual(1_000);
    expect(out).toContain("diff truncated");
  });
});
