import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./ollama-client", () => ({ generateEmbeddingsBatch: vi.fn() }));
const { walkDir } = await import("./project-indexer");

describe("walkDir", () => {
  it("lists files under nested folders, skips excluded ones, never follows symlinks", async () => {
    const root = mkdtempSync(join(tmpdir(), "exegol-walk-"));
    mkdirSync(join(root, "src", "lib"), { recursive: true });
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "src", "a.ts"), "a");
    writeFileSync(join(root, "src", "lib", "b.ts"), "b");
    writeFileSync(join(root, "node_modules", "x.js"), "x");
    // A link back to the root looped the walk
    symlinkSync(root, join(root, "src", "loop"));
    symlinkSync(join(root, "src", "a.ts"), join(root, "linked.ts"));

    const files = await walkDir(root, ["node_modules"]);
    expect(files.sort()).toEqual(["src/a.ts", "src/lib/b.ts"]);
  });
});
