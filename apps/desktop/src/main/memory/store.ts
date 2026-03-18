/**
 * Memory Store — manages agent memory persistence in libSQL.
 * Inspired by memU's 3-layer hierarchy, DeerFlow's category system,
 * and TinyClaw's temporal decay + FTS5 search.
 */

import type { MemoryCategory, MemoryCreate, MemoryEntry } from "@exegol/shared";
import { MEMORY_CATEGORIES } from "@exegol/shared";
import type Database from "libsql";
import { nanoid } from "../db/queries/helpers";

export type { MemoryCategory, MemoryCreate, MemoryEntry };
export { MEMORY_CATEGORIES };

// ─── Row mapper ──────────────────────────────────────────────────────────────

function mapMemoryRow(row: Record<string, unknown>): MemoryEntry {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    category: row.category as MemoryCategory,
    content: row.content as string,
    sourceAgentId: (row.source_agent_id as string) ?? null,
    relevanceScore: (row.relevance_score as number) ?? 0.5,
    accessCount: (row.access_count as number) ?? 0,
    createdAt: row.created_at as number,
    lastAccessedAt: (row.last_accessed_at as number) ?? (row.created_at as number),
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function listMemories(db: Database.Database, projectId: string): MemoryEntry[] {
  const rows = db
    .prepare(
      "SELECT * FROM memories WHERE project_id = ? ORDER BY relevance_score DESC, last_accessed_at DESC",
    )
    .all(projectId);
  return (rows as Record<string, unknown>[]).map(mapMemoryRow);
}

export function createMemory(db: Database.Database, data: MemoryCreate): MemoryEntry {
  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);
  const score = data.relevanceScore ?? 0.5;

  db.prepare(
    `INSERT INTO memories (id, project_id, category, content, source_agent_id, relevance_score, access_count, created_at, last_accessed_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id,
    data.projectId,
    data.category,
    data.content,
    data.sourceAgentId ?? null,
    score,
    now,
    now,
  );

  return {
    id,
    projectId: data.projectId,
    category: data.category,
    content: data.content,
    sourceAgentId: data.sourceAgentId ?? null,
    relevanceScore: score,
    accessCount: 0,
    createdAt: now,
    lastAccessedAt: now,
  };
}

export function deleteMemory(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM memories WHERE id = ?").run(id);
}

export function updateMemoryRelevance(
  db: Database.Database,
  id: string,
  relevanceScore: number,
): void {
  db.prepare("UPDATE memories SET relevance_score = ? WHERE id = ?").run(relevanceScore, id);
}

// ─── Search ──────────────────────────────────────────────────────────────────

export function searchMemories(
  db: Database.Database,
  projectId: string,
  query: string,
): MemoryEntry[] {
  // Simple keyword search using LIKE (FTS5 can be added in T23)
  const pattern = `%${query}%`;
  const rows = db
    .prepare(
      `SELECT * FROM memories WHERE project_id = ? AND content LIKE ?
       ORDER BY relevance_score DESC LIMIT 20`,
    )
    .all(projectId, pattern);
  return (rows as Record<string, unknown>[]).map(mapMemoryRow);
}

// ─── Retrieval for injection ─────────────────────────────────────────────────

/**
 * Retrieve top-N most relevant memories for injection into an agent prompt.
 * Uses a combined score: relevance (40%) + recency (30%) + access frequency (30%).
 * Inspired by TinyClaw's 3-factor relevance scoring.
 */
export function getMemoriesForInjection(
  db: Database.Database,
  projectId: string,
  maxCount = 10,
  maxTokenBudget = 2000,
): MemoryEntry[] {
  const rows = db
    .prepare(
      `SELECT *,
        (relevance_score * 0.4 +
         (1.0 / (1.0 + (unixepoch() - last_accessed_at) / 86400.0)) * 0.3 +
         MIN(access_count / 10.0, 1.0) * 0.3
        ) AS combined_score
       FROM memories
       WHERE project_id = ?
       ORDER BY combined_score DESC
       LIMIT ?`,
    )
    .all(projectId, maxCount * 2);

  const memories = (rows as Record<string, unknown>[]).map(mapMemoryRow);

  // Apply token budget (rough estimate: 1 token ~= 4 chars)
  const selected: MemoryEntry[] = [];
  let tokenCount = 0;
  for (const mem of memories) {
    const estimatedTokens = Math.ceil(mem.content.length / 4);
    if (tokenCount + estimatedTokens > maxTokenBudget) break;
    selected.push(mem);
    tokenCount += estimatedTokens;
    if (selected.length >= maxCount) break;
  }

  // Bump access count for retrieved memories
  if (selected.length > 0) {
    const now = Math.floor(Date.now() / 1000);
    const ids = selected.map((m) => m.id);
    for (const id of ids) {
      db.prepare(
        "UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?",
      ).run(now, id);
    }
  }

  return selected;
}

/**
 * Build a context string from memories for agent prompt injection.
 */
export function buildMemoryContext(memories: MemoryEntry[]): string {
  if (memories.length === 0) return "";

  const grouped = new Map<MemoryCategory, MemoryEntry[]>();
  for (const mem of memories) {
    const list = grouped.get(mem.category) ?? [];
    list.push(mem);
    grouped.set(mem.category, list);
  }

  const categoryLabels: Record<MemoryCategory, string> = {
    preference: "Preferences",
    pattern: "Patterns",
    error: "Known Errors",
    solution: "Solutions",
    dependency: "Dependencies",
    convention: "Conventions",
  };

  const sections: string[] = [];
  for (const [category, entries] of grouped) {
    const label = categoryLabels[category] ?? category;
    const items = entries.map((e) => `- ${e.content}`).join("\n");
    sections.push(`### ${label}\n${items}`);
  }

  return `# Project Memory\n\n${sections.join("\n\n")}\n`;
}
