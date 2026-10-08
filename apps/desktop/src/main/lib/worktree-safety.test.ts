import { describe, expect, it } from "vitest";
import { isRegenerable } from "./worktree-safety";

describe("isRegenerable", () => {
  it("accepts build output, caches, logs and .DS_Store", () => {
    for (const p of [
      "node_modules/",
      "apps/desktop/dist/",
      "packages/core-rust/target/",
      ".turbo/",
      "a/.cache/x",
      "debug.log",
      "sub/.DS_Store",
    ]) {
      expect(isRegenerable(p)).toBe(true);
    }
  });

  it("rejects anything else ignored: secrets, local databases, notes", () => {
    for (const p of [".env", "data/local.db", "notes/", ".env.local", "logs.txt"]) {
      expect(isRegenerable(p)).toBe(false);
    }
  });
});
