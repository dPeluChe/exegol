import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type {
  Skill,
  SkillCategory,
  SkillLockFile,
  SkillRequirements,
  SkillSource,
} from "@exegol/shared";
import { SKILL_CATEGORIES } from "@exegol/shared";
import { logger } from "../lib/logger";

// ─── Frontmatter parser ──────────────────────────────────────────────────────

interface ParsedSkillFile {
  meta: Record<string, string>;
  body: string;
}

function parseFrontmatter(content: string): ParsedSkillFile {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, string> = {};
  const yamlBlock = match[1] ?? "";
  for (const line of yamlBlock.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }

  return { meta, body: match[2] ?? "" };
}

function parseCommaSeparated(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── Requirement checking ────────────────────────────────────────────────────

// Cached: discovery runs on every spawn, and each execSync blocks the main
// process up to 3s. Installed binaries don't churn — 5 min TTL is plenty.
const binCache = new Map<string, { ok: boolean; ts: number }>();
const BIN_CACHE_TTL = 300_000;

function isBinAvailable(bin: string): boolean {
  // Validate bin name to prevent command injection
  if (!/^[a-zA-Z0-9._-]+$/.test(bin)) {
    logger.warn(`[Skills] Rejected suspicious binary name: ${bin}`);
    return false;
  }
  const cached = binCache.get(bin);
  if (cached && Date.now() - cached.ts < BIN_CACHE_TTL) return cached.ok;

  let ok: boolean;
  try {
    execSync(`command -v ${bin}`, { stdio: "ignore", timeout: 3_000 });
    ok = true;
  } catch {
    ok = false;
  }
  binCache.set(bin, { ok, ts: Date.now() });
  return ok;
}

function checkRequirements(requires: SkillRequirements): boolean {
  for (const bin of requires.bins) {
    if (!isBinAvailable(bin)) return false;
  }
  for (const envVar of requires.env) {
    if (!process.env[envVar]) return false;
  }
  return true;
}

// ─── Skill loading ───────────────────────────────────────────────────────────

export function loadSkillFromFile(filePath: string, scope: "global" | "project"): Skill | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const skill = parseSkillContent(raw, filePath, scope);
    if (skill) {
      skill.source = resolveSource(filePath);
    }
    return skill;
  } catch (err) {
    logger.warn(`[Skills] Failed to load skill from ${filePath}:`, err);
    return null;
  }
}

export function parseSkillContent(
  raw: string,
  filePath: string,
  scope: "global" | "project",
): Skill | null {
  const { meta, body } = parseFrontmatter(raw);

  const name = meta.name;
  if (!name) {
    logger.warn(`[Skills] Missing 'name' in frontmatter: ${filePath}`);
    return null;
  }

  // Validate name format: lowercase + hyphens, max 64 chars
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
    logger.warn(`[Skills] Invalid name '${name}' in ${filePath}`);
    return null;
  }

  const description = meta.description || "";
  const role = meta.role || null;
  const categoryRaw = meta.category || "custom";
  const category: SkillCategory = (SKILL_CATEGORIES as readonly string[]).includes(categoryRaw)
    ? (categoryRaw as SkillCategory)
    : "custom";

  const requires: SkillRequirements = {
    bins: parseCommaSeparated(meta["requires-bins"]),
    env: parseCommaSeparated(meta["requires-env"]),
  };

  const allowedTools = parseCommaSeparated(meta["allowed-tools"]);
  const available = checkRequirements(requires);
  const alwaysRaw = meta.always?.trim().toLowerCase();
  const always = alwaysRaw === "true";
  if (alwaysRaw && alwaysRaw !== "true" && alwaysRaw !== "false") {
    logger.warn(
      `[Skills] Unrecognized 'always: ${meta.always}' in ${filePath} — only 'true' enables it, treating as false`,
    );
  }

  return {
    name,
    description,
    category,
    role,
    requires,
    allowedTools,
    content: body.trim(),
    filePath,
    scope,
    available,
    always,
  };
}

// ─── Lock file source resolution ────────────────────────────────────────────

const lockCache = new Map<string, { lock: SkillLockFile; ts: number }>();
const LOCK_TTL = 10_000; // 10s cache

function readLockFileCached(skillsDir: string): SkillLockFile {
  const cached = lockCache.get(skillsDir);
  if (cached && Date.now() - cached.ts < LOCK_TTL) return cached.lock;

  const empty: SkillLockFile = { version: 1, skills: [] };
  try {
    const lockPath = join(skillsDir, "skills-lock.json");
    if (!existsSync(lockPath)) return empty;
    const lock = JSON.parse(readFileSync(lockPath, "utf-8")) as SkillLockFile;
    lockCache.set(skillsDir, { lock, ts: Date.now() });
    return lock;
  } catch {
    return empty;
  }
}

function resolveSource(filePath: string): SkillSource | undefined {
  // filePath is e.g. ~/.agents/skills/my-skill/SKILL.md
  const skillDir = dirname(filePath);
  const skillName = basename(skillDir);
  const skillsDir = dirname(skillDir);

  const lock = readLockFileCached(skillsDir);
  const entry = lock.skills.find((e) => e.name === skillName);
  return entry?.source;
}
