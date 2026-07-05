import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeDigest } from "./digest";

describe("computeDigest (internal fallback summarizer)", () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), "exegol-digest-test-"));
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it("summarizes package.json dependencies", () => {
    writeFileSync(
      join(projectPath, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^18.0.0" } }),
    );
    const digest = computeDigest(projectPath);
    expect(digest).toContain("my-app");
    expect(digest).toContain("react");
  });

  it("lists top-level directories with file counts", () => {
    mkdirSync(join(projectPath, "src"), { recursive: true });
    writeFileSync(join(projectPath, "src", "index.ts"), "export {};");
    writeFileSync(join(projectPath, "src", "util.ts"), "export {};");

    const digest = computeDigest(projectPath);
    expect(digest).toContain("src/");
    expect(digest).toContain("2 files");
  });

  it("skips ignored directories like node_modules", () => {
    mkdirSync(join(projectPath, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(projectPath, "node_modules", "pkg", "index.js"), "");
    mkdirSync(join(projectPath, "src"), { recursive: true });
    writeFileSync(join(projectPath, "src", "index.ts"), "export {};");

    const digest = computeDigest(projectPath);
    expect(digest).not.toContain("node_modules/");
  });

  it("returns a non-empty digest for an empty project", () => {
    const digest = computeDigest(projectPath);
    expect(digest).toContain("Codebase Digest");
  });
});
