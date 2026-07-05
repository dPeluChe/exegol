/**
 * Project Knowledge Node (T140) — MEMORY.md: the memU-synthesizer-pattern
 * bridge. Periodic/manual distillation of top-salience DB facts into a
 * committed file, so a `git clone` (or an agent launched outside Exegol)
 * still gets the team's accumulated knowledge. Import runs the same
 * `observeMemory` classification used by the extractor, so re-importing
 * never duplicates facts already in the DB.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { MemoryCategory } from "@exegol/shared";
import { MEMORY_CATEGORIES } from "@exegol/shared";
import type Database from "libsql";
import { logger } from "../lib/logger";
import { computeSalience } from "../memory/salience";
import { listMemories, observeMemory } from "../memory/store";
import { ensureKnowledgeDir, getMemoryBridgePath } from "./paths";

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  preference: "Preferences",
  pattern: "Patterns",
  error: "Known Errors",
  solution: "Solutions",
  dependency: "Dependencies",
  convention: "Conventions",
};

const LABEL_TO_CATEGORY = new Map<string, MemoryCategory>(
  MEMORY_CATEGORIES.map((c) => [CATEGORY_LABELS[c].toLowerCase(), c]),
);

const DEFAULT_MAX_FACTS = 50;

/** Regenerate MEMORY.md from the top-salience active facts in the DB. */
export function syncMemoryBridge(
  db: Database.Database,
  projectId: string,
  projectPath: string,
  maxFacts = DEFAULT_MAX_FACTS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const ranked = listMemories(db, projectId)
    .slice()
    .sort((a, b) => computeSalience(b, now) - computeSalience(a, now))
    .slice(0, maxFacts);

  const grouped = new Map<MemoryCategory, string[]>();
  for (const mem of ranked) {
    const list = grouped.get(mem.category) ?? [];
    list.push(mem.content);
    grouped.set(mem.category, list);
  }

  const sections = MEMORY_CATEGORIES.filter((c) => grouped.has(c)).map((c) => {
    const items = (grouped.get(c) ?? []).map((content) => `- ${content}`).join("\n");
    return `## ${CATEGORY_LABELS[c]}\n\n${items}`;
  });

  const header =
    "# Project Memory\n\n_Synced from Exegol's memory store — top-salience facts only. " +
    'Edits here are not read back automatically; use "Import as seed" to bring manual edits into the DB._';

  // No facts → no file. A header-only MEMORY.md would still be advertised to
  // every spawned agent as "distilled team facts" and waste a read.
  if (sections.length === 0) {
    const path = getMemoryBridgePath(projectPath);
    if (existsSync(path)) rmSync(path);
    return "";
  }

  const content = `${header}\n\n${sections.join("\n\n")}\n`;
  ensureKnowledgeDir(projectPath);
  writeFileSync(getMemoryBridgePath(projectPath), content, "utf-8");
  return content;
}

export function readMemoryBridge(projectPath: string): string | null {
  const path = getMemoryBridgePath(projectPath);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf-8");
  } catch (err) {
    logger.warn("[Knowledge] Failed to read MEMORY.md:", err);
    return null;
  }
}

/**
 * Parse MEMORY.md's `## Category` + `- fact` structure and route each fact
 * through `observeMemory` (reinforce/supersede/create) — safe to re-run.
 */
export function importMemoryBridgeAsSeed(
  db: Database.Database,
  projectId: string,
  projectPath: string,
): number {
  const raw = readMemoryBridge(projectPath);
  if (!raw) return 0;

  let currentCategory: MemoryCategory | null = null;
  let imported = 0;

  for (const line of raw.split("\n")) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading?.[1]) {
      currentCategory = LABEL_TO_CATEGORY.get(heading[1].trim().toLowerCase()) ?? null;
      continue;
    }

    const bullet = line.match(/^-\s+(.+)$/);
    if (bullet?.[1] && currentCategory) {
      observeMemory(db, {
        projectId,
        category: currentCategory,
        content: bullet[1].trim(),
        relevanceScore: 0.6,
      });
      imported++;
    }
  }

  return imported;
}
