import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isRegenerable, pathKey } from "./worktree-safety";

describe("pathKey", () => {
  it("is the realpath, so a symlinked spelling of a folder is the same key", () => {
    const dir = mkdtempSync(join(tmpdir(), "exegol-pathkey-"));
    try {
      const link = `${dir}-link`;
      symlinkSync(dir, link);
      expect(pathKey(link, "darwin")).toBe(realpathSync(dir));
      rmSync(link);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps case off Windows and folds it on Windows, a missing path resolved", () => {
    expect(pathKey("/No/Such/Dir", "linux")).toBe(resolve("/No/Such/Dir"));
    expect(pathKey("/No/Such/Dir", "win32")).toBe(resolve("/No/Such/Dir").toLowerCase());
  });
});

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
