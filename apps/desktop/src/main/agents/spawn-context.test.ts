import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSkillContext } from "./spawn-context";

function writeSkill(projectPath: string, name: string, frontmatter: string, body: string): void {
  const dir = join(projectPath, ".agents", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n${body}\n`, "utf-8");
}

describe("buildSkillContext (T127 progressive disclosure)", () => {
  let projectPath: string;
  let globalSkillsDir: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), "exegol-skill-test-"));
    // Isolate discovery from the developer's real ~/.agents/skills — a global
    // skill with always:true would otherwise leak into every assertion.
    globalSkillsDir = mkdtempSync(join(tmpdir(), "exegol-global-skills-"));
    process.env.EXEGOL_SKILLS_DIR = globalSkillsDir;
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
    rmSync(globalSkillsDir, { recursive: true, force: true });
    delete process.env.EXEGOL_SKILLS_DIR;
  });

  it("returns empty string when no skills match", () => {
    writeSkill(projectPath, "unselected-skill", "name: unselected-skill\ndescription: not picked", "Full body");
    expect(buildSkillContext(projectPath, ["some-other-skill"])).toBe("");
  });

  it("injects only metadata pointers for selected non-always skills", () => {
    writeSkill(
      projectPath,
      "test-progressive",
      "name: test-progressive\ndescription: Runs the test suite",
      "Full instructions that should NOT appear inline",
    );
    const context = buildSkillContext(projectPath, ["test-progressive"]);
    expect(context).toContain("Runs the test suite");
    expect(context).toContain("read `");
    expect(context).not.toContain("Full instructions that should NOT appear inline");
  });

  it("always inlines full content for always:true skills regardless of selection", () => {
    writeSkill(
      projectPath,
      "test-always",
      "name: test-always\ndescription: Critical house rule\nalways: true",
      "Critical inline body",
    );
    const context = buildSkillContext(projectPath, []);
    expect(context).toContain("## Skill: test-always");
    expect(context).toContain("Critical inline body");
  });
});
