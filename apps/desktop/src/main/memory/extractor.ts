/**
 * Memory Extractor — extracts knowledge from agent scrollback on completion.
 * Inspired by DeerFlow's async extraction and Nanobot's consolidation.
 *
 * Uses pattern matching to extract:
 * - Error patterns and their solutions
 * - Dependency/version information
 * - Code conventions discovered
 * - User preferences expressed
 */

import type Database from "libsql";
import { logger } from "../lib/logger";
import { createMemory, type MemoryCategory } from "./store";

// ─── Extraction patterns ─────────────────────────────────────────────────────

interface ExtractionRule {
  category: MemoryCategory;
  patterns: RegExp[];
  relevance: number;
  extractor: (match: RegExpMatchArray, line: string) => string | null;
}

const EXTRACTION_RULES: ExtractionRule[] = [
  // Error patterns
  {
    category: "error",
    patterns: [
      /(?:error|Error|ERROR)\s*[:\]]\s*(.{10,200})/,
      /(?:FAIL|fail|Failed)\s*[:\]]\s*(.{10,200})/,
      /(?:TypeError|ReferenceError|SyntaxError|RangeError):\s*(.{10,200})/,
    ],
    relevance: 0.7,
    extractor: (_match, line) => {
      const cleaned = line.trim().slice(0, 200);
      return cleaned.length > 15 ? cleaned : null;
    },
  },

  // Solution patterns (fix applied, resolved)
  {
    category: "solution",
    patterns: [
      /(?:fix(?:ed)?|resolv(?:ed|ing)|patch(?:ed)?)\s*[:-]\s*(.{10,200})/i,
      /(?:solution|workaround)\s*[:-]\s*(.{10,200})/i,
    ],
    relevance: 0.8,
    extractor: (match) => {
      return match[1]?.trim() ?? null;
    },
  },

  // Dependency information
  {
    category: "dependency",
    patterns: [
      /(?:install(?:ed|ing)?|add(?:ed|ing)?)\s+(?:package|dep(?:endency)?)\s*[:-]?\s*(.{5,100})/i,
      /(?:npm|yarn|bun|pip|cargo)\s+(?:install|add)\s+(.{3,100})/,
      /(?:requires?|needs?)\s+(.{5,100})\s+(?:version|v)\s*([0-9.]+)/i,
    ],
    relevance: 0.6,
    extractor: (match) => {
      return match[0]?.trim().slice(0, 150) ?? null;
    },
  },

  // Convention patterns
  {
    category: "convention",
    patterns: [
      /(?:convention|standard|rule|guideline)\s*[:-]\s*(.{10,200})/i,
      /(?:always|never|prefer|avoid)\s+(.{10,200})/i,
    ],
    relevance: 0.5,
    extractor: (match) => {
      return match[0]?.trim().slice(0, 200) ?? null;
    },
  },

  // Preference patterns
  {
    category: "preference",
    patterns: [/(?:I prefer|I like|I want|please use|please don't|don't use)\s+(.{5,200})/i],
    relevance: 0.6,
    extractor: (match) => {
      return match[0]?.trim().slice(0, 200) ?? null;
    },
  },
];

// ─── Deduplication ───────────────────────────────────────────────────────────

function normalizeForDedup(content: string): string {
  return content.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Simple Jaccard-like similarity for short strings.
 * Returns 0-1 where 1 = identical.
 */
function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeForDedup(a).split(" "));
  const wordsB = new Set(normalizeForDedup(b).split(" "));

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Main extraction function ────────────────────────────────────────────────

interface ExtractedMemory {
  category: MemoryCategory;
  content: string;
  relevance: number;
}

/**
 * Extract knowledge from agent scrollback text.
 * Non-fatal: never throws, always returns results (may be empty).
 */
export function extractFromScrollback(scrollback: string): ExtractedMemory[] {
  const results: ExtractedMemory[] = [];

  // Process line by line to find matching patterns
  const lines = scrollback.split("\n");
  for (const line of lines) {
    if (line.length < 10 || line.length > 500) continue;

    for (const rule of EXTRACTION_RULES) {
      for (const pattern of rule.patterns) {
        const match = line.match(pattern);
        if (!match) continue;

        const content = rule.extractor(match, line);
        if (!content) continue;

        // Check for near-duplicate
        const isDuplicate = results.some(
          (r) => r.category === rule.category && textSimilarity(r.content, content) > 0.8,
        );
        if (isDuplicate) continue;

        results.push({
          category: rule.category,
          content,
          relevance: rule.relevance,
        });

        // Max 3 entries per rule to avoid noise
        if (results.filter((r) => r.category === rule.category).length >= 3) break;
      }
    }
  }

  // Cap total results
  return results.slice(0, 20);
}

/**
 * Extract memories from an agent's scrollback and store them in the DB.
 * Called on agent completion. Non-fatal (best-effort, try/catch).
 */
export function extractAndStoreMemories(
  db: Database.Database,
  agentId: string,
  projectId: string,
  scrollback: string,
): number {
  try {
    const extracted = extractFromScrollback(scrollback);
    if (extracted.length === 0) return 0;

    // Check against existing memories to avoid duplicates
    const existing = db
      .prepare("SELECT content FROM memories WHERE project_id = ?")
      .all(projectId) as Array<{ content: string }>;

    const existingContents = existing.map((e) => e.content);

    let stored = 0;
    for (const mem of extracted) {
      // Skip if too similar to existing memory
      const isDuplicate = existingContents.some((c) => textSimilarity(c, mem.content) > 0.8);
      if (isDuplicate) continue;

      createMemory(db, {
        projectId,
        category: mem.category,
        content: mem.content,
        sourceAgentId: agentId,
        relevanceScore: mem.relevance,
      });
      stored++;
    }

    if (stored > 0) {
      logger.info(`[Memory] Extracted ${stored} memories from agent ${agentId}`);
    }
    return stored;
  } catch (err) {
    logger.warn(`[Memory] Failed to extract memories from agent ${agentId}:`, err);
    return 0;
  }
}
