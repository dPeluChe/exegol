import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "../lib/logger";

// ─── Canonical paths ────────────────────────────────────────────────────────

const CANONICAL_DIR = join(homedir(), ".agents", "skills");
const LEGACY_DIR = join(homedir(), ".exegol", "skills");
const SETUP_MARKER = join(homedir(), ".agents", ".skills-setup");

export function getCanonicalSkillsDir(): string {
  return CANONICAL_DIR;
}

export function getProjectSkillsDir(projectPath: string): string {
  return join(projectPath, ".agents", "skills");
}

export function getLegacySkillsDir(): string {
  return LEGACY_DIR;
}

/** Legacy project path — used as read-only fallback for one release cycle. */
export function getLegacyProjectSkillsDir(projectPath: string): string {
  return join(projectPath, ".exegol", "skills");
}

// ─── Agent symlink targets ──────────────────────────────────────────────────

const AGENT_SKILL_DIRS = [
  // ── CLIs with native skills support ──
  { configDir: join(homedir(), ".claude"), skillsSubdir: "skills" },
  { configDir: join(homedir(), ".cursor"), skillsSubdir: "skills" },
  { configDir: join(homedir(), ".codex"), skillsSubdir: "skills" },
  { configDir: join(homedir(), ".gemini"), skillsSubdir: "skills" },
  { configDir: join(homedir(), ".config", "goose"), skillsSubdir: "skills" },
  { configDir: join(homedir(), ".config", "opencode"), skillsSubdir: "skills" },
  { configDir: join(homedir(), ".config", "crush"), skillsSubdir: "skills" },
  { configDir: join(homedir(), ".kilocode"), skillsSubdir: "skills" },
  { configDir: join(homedir(), ".kiro"), skillsSubdir: "skills" },
  { configDir: join(homedir(), ".config", "amp"), skillsSubdir: "skills" },
  { configDir: join(homedir(), ".factory"), skillsSubdir: "skills" },
];

// ─── Setup ──────────────────────────────────────────────────────────────────

/**
 * One-time migration to ~/.agents/skills/ + symlink creation for each agent.
 * Idempotent — safe to call on every startup. Skips fast via marker file.
 */
export function ensureCanonicalPaths(): void {
  try {
    // 1. Create canonical dir
    mkdirSync(CANONICAL_DIR, { recursive: true });

    // 2. Migrate legacy dir if needed
    migrateLegacyDir();

    // 3. Symlink agent skill dirs
    for (const { configDir, skillsSubdir } of AGENT_SKILL_DIRS) {
      ensureAgentSymlink(configDir, skillsSubdir);
    }

    // 4. Write marker
    writeFileSync(SETUP_MARKER, JSON.stringify({ timestamp: Date.now(), version: 1 }), "utf-8");

    logger.info("[SkillPaths] Canonical paths ensured");
  } catch (err) {
    logger.error("[SkillPaths] Failed to ensure canonical paths:", err);
  }
}

function migrateLegacyDir(): void {
  if (!existsSync(LEGACY_DIR)) return;

  // Already a symlink — nothing to do
  if (isSymlinkTo(LEGACY_DIR, CANONICAL_DIR)) return;

  const legacyStat = lstatSync(LEGACY_DIR);

  // If it's already a symlink (to something else), remove and recreate
  if (legacyStat.isSymbolicLink()) {
    rmSync(LEGACY_DIR);
    symlinkSync(CANONICAL_DIR, LEGACY_DIR);
    logger.info("[SkillPaths] Re-pointed legacy symlink to canonical dir");
    return;
  }

  // Real directory — migrate contents if canonical is empty
  if (legacyStat.isDirectory()) {
    const legacyEntries = readdirSync(LEGACY_DIR);
    const canonicalEntries = readdirSync(CANONICAL_DIR);

    if (legacyEntries.length > 0 && canonicalEntries.length === 0) {
      // Copy each skill directory
      for (const entry of legacyEntries) {
        const src = join(LEGACY_DIR, entry);
        if (!statSync(src).isDirectory()) continue;
        copyDirRecursive(src, join(CANONICAL_DIR, entry));
      }
      logger.info(`[SkillPaths] Migrated ${legacyEntries.length} skills from legacy dir`);
    }

    // Replace legacy dir with symlink
    rmSync(LEGACY_DIR, { recursive: true });
    symlinkSync(CANONICAL_DIR, LEGACY_DIR);
    logger.info("[SkillPaths] Replaced legacy dir with symlink");
  }
}

function ensureAgentSymlink(configDir: string, skillsSubdir: string): void {
  // Skip if agent config dir doesn't exist (agent not installed)
  if (!existsSync(configDir)) return;

  const skillsDir = join(configDir, skillsSubdir);

  // Already correct symlink
  if (isSymlinkTo(skillsDir, CANONICAL_DIR)) return;

  if (existsSync(skillsDir)) {
    const stat = lstatSync(skillsDir);

    if (stat.isSymbolicLink()) {
      // Symlink to wrong target — fix it
      rmSync(skillsDir);
    } else if (stat.isDirectory()) {
      // Real directory with files — skip (Phase C handles import)
      const entries = readdirSync(skillsDir);
      if (entries.length > 0) {
        logger.info(
          `[SkillPaths] Skipping ${skillsDir} — has ${entries.length} files (import candidate)`,
        );
        return;
      }
      // Empty dir — remove and symlink
      rmSync(skillsDir, { recursive: true });
    }
  }

  try {
    symlinkSync(CANONICAL_DIR, skillsDir);
    logger.info(`[SkillPaths] Created symlink: ${skillsDir} -> canonical`);
  } catch (err) {
    logger.warn(`[SkillPaths] Failed to create symlink at ${skillsDir}:`, err);
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

export function isSetupComplete(): boolean {
  return existsSync(SETUP_MARKER);
}

export type SymlinkStatus = "ok" | "missing" | "broken" | "has-files";

export function validateSymlinks(): { agent: string; dir: string; status: SymlinkStatus }[] {
  const results: { agent: string; dir: string; status: SymlinkStatus }[] = [];

  for (const { configDir, skillsSubdir } of AGENT_SKILL_DIRS) {
    if (!existsSync(configDir)) continue;

    const skillsDir = join(configDir, skillsSubdir);
    const agent = configDir.split("/").pop() ?? configDir;

    if (!existsSync(skillsDir)) {
      results.push({ agent, dir: skillsDir, status: "missing" });
    } else if (isSymlinkTo(skillsDir, CANONICAL_DIR)) {
      results.push({ agent, dir: skillsDir, status: "ok" });
    } else if (lstatSync(skillsDir).isSymbolicLink()) {
      results.push({ agent, dir: skillsDir, status: "broken" });
    } else {
      results.push({ agent, dir: skillsDir, status: "has-files" });
    }
  }

  return results;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isSymlinkTo(linkPath: string, target: string): boolean {
  try {
    const stat = lstatSync(linkPath);
    if (!stat.isSymbolicLink()) return false;
    return readlinkSync(linkPath) === target;
  } catch {
    return false;
  }
}

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}
