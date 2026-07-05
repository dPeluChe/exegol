/**
 * Project Knowledge Node (T140) — path helpers for `.exegol/knowledge/`.
 * Storage model: PROJECT.md + MEMORY.md are git-tracked (committed, reviewable
 * in PRs); DIGEST.md is derivable/high-churn and gitignored by default.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function getKnowledgeDir(projectPath: string): string {
  return join(projectPath, ".exegol", "knowledge");
}

export function getProjectBriefPath(projectPath: string): string {
  return join(getKnowledgeDir(projectPath), "PROJECT.md");
}

export function getDigestPath(projectPath: string): string {
  return join(getKnowledgeDir(projectPath), "DIGEST.md");
}

export function getMemoryBridgePath(projectPath: string): string {
  return join(getKnowledgeDir(projectPath), "MEMORY.md");
}

export function ensureKnowledgeDir(projectPath: string): void {
  mkdirSync(getKnowledgeDir(projectPath), { recursive: true });
}

const DIGEST_GITIGNORE_ENTRY = ".exegol/knowledge/DIGEST.md";

/**
 * DIGEST.md is derivable + high-churn — gitignore it by default so it never
 * pollutes PRs. Idempotent: only appends if the entry isn't already present.
 */
export function ensureDigestGitignored(projectPath: string): void {
  const gitignorePath = join(projectPath, ".gitignore");
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
  if (existing.includes(DIGEST_GITIGNORE_ENTRY)) return;

  const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
  const entry = `${needsLeadingNewline ? "\n" : ""}${DIGEST_GITIGNORE_ENTRY}\n`;
  if (existing.length === 0) {
    writeFileSync(gitignorePath, entry, "utf-8");
  } else {
    appendFileSync(gitignorePath, entry, "utf-8");
  }
}
