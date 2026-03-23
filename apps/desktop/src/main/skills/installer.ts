import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type {
  SkillInstallRequest,
  SkillInstallResult,
  SkillLockEntry,
  SkillLockFile,
  SkillSource,
} from "@exegol/shared";
import { logger } from "../lib/logger";
import { getTrustLevel } from "./curated-registry";
import { getCanonicalSkillsDir, getProjectSkillsDir } from "./paths";

const LOCK_FILE_NAME = "skills-lock.json";
const NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_SKILL_SIZE = 100 * 1024; // 100KB

// ─── Public API ─────────────────────────────────────────────────────────────

export async function installFromGitHub(request: SkillInstallRequest): Promise<SkillInstallResult> {
  const result: SkillInstallResult = { installed: [], skipped: [], errors: [] };

  const parsed = parseRepoIdentifier(request.repo);
  if (!parsed) {
    result.errors.push(`Invalid repo identifier: ${request.repo}`);
    return result;
  }

  const targetDir =
    request.scope === "project" && request.projectPath
      ? getProjectSkillsDir(request.projectPath)
      : getCanonicalSkillsDir();

  mkdirSync(targetDir, { recursive: true });

  // Clone to temp
  const tmpDir = mkdtempSync(join(tmpdir(), "exegol-skill-"));
  try {
    const cloneUrl = `https://github.com/${parsed.owner}/${parsed.repo}.git`;
    try {
      await execFileAsync("git", ["clone", "--depth", "1", cloneUrl, `${tmpDir}/repo`], {
        timeout: 60_000,
      });
    } catch {
      result.errors.push(`Failed to clone ${cloneUrl}`);
      return result;
    }

    const repoDir = join(tmpDir, "repo");

    // Get commit SHA
    let commitSha: string | undefined;
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: repoDir,
        encoding: "utf-8",
      });
      commitSha = stdout.trim();
    } catch {
      // non-critical
    }

    // Discover SKILL.md files
    const skillDirs = discoverSkillDirs(repoDir);
    if (skillDirs.length === 0) {
      result.errors.push("No SKILL.md files found in repository");
      return result;
    }

    const trust = getTrustLevel(`${parsed.owner}/${parsed.repo}`);
    const lock = readLockFile(targetDir);

    for (const skillDir of skillDirs) {
      const skillFile = join(skillDir, "SKILL.md");
      const validation = validateSkillFile(skillFile);
      if (!validation.valid) {
        result.errors.push(`${basename(skillDir)}: ${validation.reason}`);
        continue;
      }

      const name = basename(skillDir);
      const destDir = join(targetDir, name);

      if (existsSync(destDir)) {
        result.skipped.push(name);
        continue;
      }

      cpSync(skillDir, destDir, { recursive: true });

      // Update lock entry
      const checksum = hashFile(skillFile);
      const source: SkillSource = {
        type: "github",
        repo: `${parsed.owner}/${parsed.repo}`,
        commitSha,
        installedAt: Date.now(),
        trust,
      };

      upsertLockEntry(lock, { name, source, checksum });
      result.installed.push(name);
    }

    writeLockFile(targetDir, lock);
    logger.info(
      `[SkillInstaller] Installed ${result.installed.length} skills from ${parsed.owner}/${parsed.repo}`,
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  return result;
}

export function uninstallSkill(
  skillName: string,
  scope: "global" | "project",
  projectPath?: string,
): boolean {
  const targetDir =
    scope === "project" && projectPath ? getProjectSkillsDir(projectPath) : getCanonicalSkillsDir();

  const skillDir = join(targetDir, skillName);
  if (!existsSync(skillDir)) return false;

  rmSync(skillDir, { recursive: true });

  const lock = readLockFile(targetDir);
  lock.skills = lock.skills.filter((e) => e.name !== skillName);
  writeLockFile(targetDir, lock);

  logger.info(`[SkillInstaller] Uninstalled skill: ${skillName}`);
  return true;
}

// ─── Repo parsing ───────────────────────────────────────────────────────────

export function parseRepoIdentifier(input: string): { owner: string; repo: string } | null {
  // Accept "owner/repo" or "https://github.com/owner/repo"
  const cleaned = input
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");

  const parts = cleaned.split("/");
  if (parts.length !== 2) return null;

  const [owner, repo] = parts;
  if (!owner || !repo) return null;

  // Basic validation — alphanumeric + hyphens + underscores + dots
  const validPart = /^[a-zA-Z0-9._-]+$/;
  if (!validPart.test(owner) || !validPart.test(repo)) return null;

  return { owner, repo };
}

// ─── Skill discovery in cloned repo ─────────────────────────────────────────

function discoverSkillDirs(rootDir: string): string[] {
  const dirs: string[] = [];

  // Search order: root subdirs, skills/, .agents/skills/, .claude/skills/
  const searchRoots = [
    rootDir,
    join(rootDir, "skills"),
    join(rootDir, ".agents", "skills"),
    join(rootDir, ".claude", "skills"),
  ];

  for (const searchRoot of searchRoots) {
    if (!existsSync(searchRoot)) continue;

    // Check if searchRoot itself has SKILL.md (single-skill repo)
    if (existsSync(join(searchRoot, "SKILL.md")) && searchRoot !== rootDir) {
      dirs.push(searchRoot);
      continue;
    }

    try {
      for (const entry of readdirSync(searchRoot)) {
        const entryPath = join(searchRoot, entry);
        if (!statSync(entryPath).isDirectory()) continue;
        if (existsSync(join(entryPath, "SKILL.md"))) {
          dirs.push(entryPath);
        }
      }
    } catch {
      // skip unreadable
    }
  }

  // Deduplicate by dir name
  const seen = new Set<string>();
  return dirs.filter((d) => {
    const name = basename(d);
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validateSkillFile(filePath: string): { valid: boolean; reason?: string } {
  if (!existsSync(filePath)) {
    return { valid: false, reason: "SKILL.md not found" };
  }

  const stat = statSync(filePath);
  if (stat.size > MAX_SKILL_SIZE) {
    return { valid: false, reason: `SKILL.md exceeds ${MAX_SKILL_SIZE / 1024}KB` };
  }

  const dirName = basename(join(filePath, ".."));
  if (!NAME_RE.test(dirName)) {
    return { valid: false, reason: `Invalid directory name: ${dirName}` };
  }

  // Check for path traversal patterns in content
  const content = readFileSync(filePath, "utf-8");
  if (/\.\.[\\/]/.test(content)) {
    return { valid: false, reason: "Content contains path traversal patterns" };
  }

  return { valid: true };
}

// ─── Lock file ──────────────────────────────────────────────────────────────

export function readLockFile(skillsDir: string): SkillLockFile {
  const lockPath = join(skillsDir, LOCK_FILE_NAME);
  if (!existsSync(lockPath)) {
    return { version: 1, skills: [] };
  }
  try {
    const raw = readFileSync(lockPath, "utf-8");
    return JSON.parse(raw) as SkillLockFile;
  } catch {
    return { version: 1, skills: [] };
  }
}

export function writeLockFile(skillsDir: string, lock: SkillLockFile): void {
  const lockPath = join(skillsDir, LOCK_FILE_NAME);
  writeFileSync(lockPath, JSON.stringify(lock, null, 2), "utf-8");
}

function upsertLockEntry(lock: SkillLockFile, entry: SkillLockEntry): void {
  const idx = lock.skills.findIndex((e) => e.name === entry.name);
  if (idx >= 0) {
    lock.skills[idx] = entry;
  } else {
    lock.skills.push(entry);
  }
}

function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}
