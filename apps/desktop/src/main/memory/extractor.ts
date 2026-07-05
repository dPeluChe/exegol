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

import type { MemoryCategory } from "@exegol/shared";
import type Database from "libsql";
import { stripAnsi } from "../agents/status-parser";
import { logger } from "../lib/logger";
import { textSimilarity } from "./salience";
import { observeMemory } from "./store";

// ─── Anti-ephemeral guard (T126) ─────────────────────────────────────────────
//
// Filters out transient progress noise that would otherwise slip through the
// looser conventions/preference patterns below (e.g. "always installing X").
// These lines describe what's happening right now, not a durable fact worth
// remembering across sessions.
const EPHEMERAL_PATTERNS: RegExp[] = [
  /^(building|compiling|loading|installing|fetching|downloading|starting|running|processing|initializing|waiting|retrying|reconnecting)\b/i,
  /^\[?\d{1,3}%\]?\s*(complete|done)?$/i,
  /^\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}/i,
];

function isEphemeral(content: string): boolean {
  const trimmed = content.trim();
  return EPHEMERAL_PATTERNS.some((p) => p.test(trimmed));
}

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

  // Dependency information — only from agent reasoning, not from CLI output
  {
    category: "dependency",
    patterns: [
      /(?:requires?|needs?)\s+(.{5,100})\s+(?:version|v)\s*([0-9.]+)/i,
      /(?:depends?\s+on|peer\s+dep(?:endency)?)\s*[:-]?\s*(.{5,100})/i,
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

  // Strip ANSI escape codes before processing (terminal colors, cursor movements)
  const cleanedScrollback = stripAnsi(scrollback);

  // Process line by line to find matching patterns
  const lines = cleanedScrollback.split("\n");
  for (const line of lines) {
    if (line.length < 10 || line.length > 500) continue;
    if (isEphemeral(line)) continue;

    for (const rule of EXTRACTION_RULES) {
      for (const pattern of rule.patterns) {
        const match = line.match(pattern);
        if (!match) continue;

        const content = rule.extractor(match, line);
        if (!content || isEphemeral(content)) continue;

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
 *
 * Each extracted fact goes through `observeMemory` (T126): re-stated facts
 * reinforce their existing row, contradicting/updated facts supersede it
 * (new row + old marked `superseded_by`, never overwritten), and genuinely
 * new facts get created.
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

    let stored = 0;
    for (const mem of extracted) {
      observeMemory(db, {
        projectId,
        category: mem.category,
        content: mem.content,
        sourceAgentId: agentId,
        relevanceScore: mem.relevance,
      });
      stored++;
    }

    if (stored > 0) {
      logger.info(`[Memory] Observed ${stored} memories from agent ${agentId}`);
    }
    return stored;
  } catch (err) {
    logger.warn(`[Memory] Failed to extract memories from agent ${agentId}:`, err);
    return 0;
  }
}
