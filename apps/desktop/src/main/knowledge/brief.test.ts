import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureProjectBrief, readProjectBrief, writeProjectBrief } from "./brief";

describe("Project brief (PROJECT.md)", () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), "exegol-brief-test-"));
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it("returns null when no brief exists yet", () => {
    expect(readProjectBrief(projectPath)).toBeNull();
  });

  it("ensureProjectBrief creates the section-structured template", () => {
    const content = ensureProjectBrief(projectPath);
    expect(content).toContain("## What it does");
    expect(content).toContain("## Where it's going");
    expect(content).toContain("## Key decisions");
  });

  it("ensureProjectBrief is idempotent — doesn't overwrite an existing brief", () => {
    ensureProjectBrief(projectPath);
    writeProjectBrief(projectPath, "# Custom brief\n\nUser-written content.");
    const content = ensureProjectBrief(projectPath);
    expect(content).toBe("# Custom brief\n\nUser-written content.");
  });

  it("writeProjectBrief overwrites the full content", () => {
    writeProjectBrief(projectPath, "first");
    writeProjectBrief(projectPath, "second");
    expect(readProjectBrief(projectPath)).toBe("second");
  });
});
