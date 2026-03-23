import { cpSync, existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ImportCandidate,
  ImportCandidateSkill,
  SkillInstallResult,
  SkillSource,
} from "@exegol/shared";
import { logger } from "../lib/logger";
import { readLockFile, writeLockFile } from "./installer";
import { getCanonicalSkillsDir } from "./paths";

export type { ImportCandidate, ImportCandidateSkill };

// ─── Agent import sources ───────────────────────────────────────────────────

const IMPORT_SOURCES = [
  { agent: "claude", dir: join(homedir(), ".claude", "skills") },
  { agent: "cursor", dir: join(homedir(), ".cursor", "skills") },
  { agent: "codex", dir: join(homedir(), ".codex", "skills") },
  { agent: "gemini", dir: join(homedir(), ".gemini", "skills") },
  { agent: "goose", dir: join(homedir(), ".config", "goose", "skills") },
  { agent: "opencode", dir: join(homedir(), ".config", "opencode", "skills") },
];

// ─── Scanning ───────────────────────────────────────────────────────────────

export function scanForImportCandidates(): ImportCandidate[] {
  const canonicalDir = getCanonicalSkillsDir();
  const canonicalSkills = existsSync(canonicalDir)
    ? new Set(
        readdirSync(canonicalDir).filter((e) => {
          const p = join(canonicalDir, e);
          return statSync(p).isDirectory() && existsSync(join(p, "SKILL.md"));
        }),
      )
    : new Set<string>();

  const candidates: ImportCandidate[] = [];

  for (const { agent, dir } of IMPORT_SOURCES) {
    if (!existsSync(dir)) continue;

    // Skip if dir IS a symlink (already linked to canonical)
    try {
      if (lstatSync(dir).isSymbolicLink()) continue;
    } catch {
      continue;
    }

    const skills: ImportCandidateSkill[] = [];

    try {
      for (const entry of readdirSync(dir)) {
        const entryPath = join(dir, entry);
        const entryStat = lstatSync(entryPath);

        if (!entryStat.isDirectory() && !entryStat.isSymbolicLink()) continue;

        if (!existsSync(join(entryPath, "SKILL.md"))) continue;

        skills.push({
          name: entry,
          sourcePath: entryPath,
          alreadyExists: canonicalSkills.has(entry),
          isSymlink: entryStat.isSymbolicLink(),
        });
      }
    } catch {
      // skip unreadable
    }

    if (skills.length > 0) {
      candidates.push({ agent, sourceDir: dir, skills });
    }
  }

  return candidates;
}

// ─── Import ─────────────────────────────────────────────────────────────────

export function importSkills(
  selections: Array<{ agent: string; sourcePath: string; name: string }>,
  opts?: { force?: boolean },
): SkillInstallResult {
  const result: SkillInstallResult = { installed: [], skipped: [], errors: [] };
  const canonicalDir = getCanonicalSkillsDir();
  const lock = readLockFile(canonicalDir);

  for (const { agent, sourcePath, name } of selections) {
    const destDir = join(canonicalDir, name);

    if (existsSync(destDir) && !opts?.force) {
      result.skipped.push(name);
      continue;
    }

    try {
      cpSync(sourcePath, destDir, { recursive: true });

      const source: SkillSource = {
        type: "local-import",
        installedAt: Date.now(),
        trust: "local",
      };

      const idx = lock.skills.findIndex((e) => e.name === name);
      const entry = { name, source };
      if (idx >= 0) {
        lock.skills[idx] = entry;
      } else {
        lock.skills.push(entry);
      }

      result.installed.push(name);
      logger.info(`[SkillImporter] Imported '${name}' from ${agent} (${sourcePath})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${name}: ${msg}`);
    }
  }

  writeLockFile(canonicalDir, lock);
  return result;
}
