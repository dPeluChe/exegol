/**
 * Project Knowledge Node (T140) — PROJECT.md: the user-editable brief.
 * Committed, section-structured to minimize merge conflicts. Agents (and the
 * UI) propose edits by rewriting a whole section, never by clobbering the
 * rest of the file.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { logger } from "../lib/logger";
import { ensureKnowledgeDir, getProjectBriefPath } from "./paths";

export const PROJECT_BRIEF_SECTIONS = [
  "What it does",
  "Where it's going",
  "Key decisions",
] as const;

function defaultBriefTemplate(): string {
  return PROJECT_BRIEF_SECTIONS.map((s) => `## ${s}\n\n_Not yet filled in._\n`).join("\n");
}

export function readProjectBrief(projectPath: string): string | null {
  const path = getProjectBriefPath(projectPath);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf-8");
  } catch (err) {
    logger.warn("[Knowledge] Failed to read PROJECT.md:", err);
    return null;
  }
}

/** Create PROJECT.md with the section-structured template if it doesn't exist yet. */
export function ensureProjectBrief(projectPath: string): string {
  const existing = readProjectBrief(projectPath);
  if (existing !== null) return existing;

  ensureKnowledgeDir(projectPath);
  const content = defaultBriefTemplate();
  writeFileSync(getProjectBriefPath(projectPath), content, "utf-8");
  return content;
}

/** Full overwrite — used by the UI's explicit save action (the user's intent is explicit). */
export function writeProjectBrief(projectPath: string, content: string): void {
  ensureKnowledgeDir(projectPath);
  writeFileSync(getProjectBriefPath(projectPath), content, "utf-8");
}
