import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Skill } from "@exegol/shared";
import { logger } from "../lib/logger";
import { DEFAULT_SKILLS } from "./defaults";
import { loadSkillFromFile } from "./loader";
import { getCanonicalSkillsDir, getLegacyProjectSkillsDir, getProjectSkillsDir } from "./paths";

// ─── Default skills installation ─────────────────────────────────────────────

export function ensureDefaultSkills(): void {
  const globalDir = getCanonicalSkillsDir();
  mkdirSync(globalDir, { recursive: true });

  for (const [dirName, content] of Object.entries(DEFAULT_SKILLS)) {
    const skillDir = join(globalDir, dirName);
    const skillFile = join(skillDir, "SKILL.md");

    if (!existsSync(skillFile)) {
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(skillFile, content, "utf-8");
      logger.info(`[Skills] Installed default skill: ${dirName}`);
    }
  }
}

// ─── Discovery ───────────────────────────────────────────────────────────────

function discoverSkillsInDir(dir: string, scope: "global" | "project"): Skill[] {
  if (!existsSync(dir)) return [];

  const skills: Skill[] = [];

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const entryPath = join(dir, entry);
      if (!statSync(entryPath).isDirectory()) continue;

      const skillFile = join(entryPath, "SKILL.md");
      if (!existsSync(skillFile)) continue;

      const skill = loadSkillFromFile(skillFile, scope);
      if (skill) {
        skills.push(skill);
      }
    }
  } catch (err) {
    logger.warn(`[Skills] Failed to scan ${dir}:`, err);
  }

  return skills;
}

/**
 * Discover all available skills. Project skills override global by name.
 */
export function discoverSkills(projectPath: string | null): Skill[] {
  const globalSkills = discoverSkillsInDir(getCanonicalSkillsDir(), "global");

  if (!projectPath) return globalSkills;

  const projectSkills = discoverSkillsInDir(getProjectSkillsDir(projectPath), "project");

  // Legacy fallback: also check .exegol/skills/ for one release cycle
  const legacyDir = getLegacyProjectSkillsDir(projectPath);
  const legacySkills = discoverSkillsInDir(legacyDir, "project");
  const projectNames = new Set(projectSkills.map((s) => s.name));
  for (const ls of legacySkills) {
    if (!projectNames.has(ls.name)) {
      projectSkills.push(ls);
      projectNames.add(ls.name);
    }
  }

  // Project skills override global by name
  const merged = [...projectSkills, ...globalSkills.filter((s) => !projectNames.has(s.name))];

  return merged.sort((a, b) => a.name.localeCompare(b.name));
}
