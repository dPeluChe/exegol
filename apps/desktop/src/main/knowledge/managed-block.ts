/**
 * Project Knowledge Node (T140) — managed block in AGENTS.md / CLAUDE.md.
 * Exegol only ever writes between the delimited markers; everything else in
 * the file is left untouched (including CLIs that never used Exegol). This is
 * what makes the knowledge base visible even to agents launched outside
 * Exegol — their native context file already points at it.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../lib/logger";

const BEGIN_MARKER = "<!-- exegol:knowledge:begin -->";
const END_MARKER = "<!-- exegol:knowledge:end -->";

const MANAGED_BLOCK_BODY =
  "This project has an Exegol knowledge base at `.exegol/knowledge/`: " +
  "`PROJECT.md` (intent, decisions, roadmap), `DIGEST.md` (auto-generated structure summary), " +
  "`MEMORY.md` (distilled team facts). Read these files when relevant to the task.";

function buildManagedBlock(): string {
  return `${BEGIN_MARKER}\n${MANAGED_BLOCK_BODY}\n${END_MARKER}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Upsert the managed block in a single file's content. Returns the new content. */
export function upsertManagedBlockContent(content: string): string {
  const block = buildManagedBlock();

  if (content.includes(BEGIN_MARKER) && content.includes(END_MARKER)) {
    const pattern = new RegExp(`${escapeRegExp(BEGIN_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}`);
    return content.replace(pattern, block);
  }

  const separator = content.length > 0 && !content.endsWith("\n\n") ? "\n\n" : "";
  return `${content}${separator}${block}\n`;
}

const CANDIDATE_FILES = ["AGENTS.md", "CLAUDE.md"];

/**
 * Sync the managed knowledge pointer into every existing AGENTS.md/CLAUDE.md
 * at the project root. If neither exists, creates AGENTS.md (the more
 * CLI-agnostic convention) with just the managed block.
 */
export function syncManagedBlock(projectPath: string): void {
  const existingFiles = CANDIDATE_FILES.filter((name) => existsSync(join(projectPath, name)));
  const targets = existingFiles.length > 0 ? existingFiles : ["AGENTS.md"];

  for (const name of targets) {
    const filePath = join(projectPath, name);
    try {
      const existing = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
      const updated = upsertManagedBlockContent(existing);
      if (updated !== existing) {
        writeFileSync(filePath, updated, "utf-8");
      }
    } catch (err) {
      logger.warn(`[Knowledge] Failed to sync managed block into ${name}:`, err);
    }
  }
}
