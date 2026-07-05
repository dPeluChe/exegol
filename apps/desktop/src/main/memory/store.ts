/**
 * Memory Store — manages agent memory persistence in libSQL.
 * Inspired by memU's 3-layer hierarchy, DeerFlow's category system,
 * and TinyClaw's temporal decay + FTS5 search.
 */

import type { MemoryCategory, MemoryCreate, MemoryEntry } from "@exegol/shared";
import { MEMORY_CATEGORIES } from "@exegol/shared";
import type Database from "libsql";
import { stripAnsi } from "../agents/status-parser";
import { nanoid } from "../db/queries/helpers";
import { hybridSearch, indexEntries, indexEntry, removeFromIndex } from "../db/queries/search";
import type { OllamaConfig } from "../indexer/ollama-client";
import { logger } from "../lib/logger";
import { classifyObservation, computeSalience } from "./salience";

const memorySearchEntityId = (id: string) => `memory:${id}`;

// ─── One-time backfill ───────────────────────────────────────────────────────
// Memories created before T125 landed were never indexed into search_index;
// without this, one indexed hit suppresses the LIKE fallback and pre-existing
// memories silently vanish from recall.
let memoriesBackfilled = false;

function ensureMemoriesIndexed(db: Database.Database): void {
  if (memoriesBackfilled) return;
  memoriesBackfilled = true;
  try {
    const missing = db
      .prepare(
        `SELECT m.id, m.project_id, m.content, m.source_agent_id FROM memories m
         WHERE NOT EXISTS (
           SELECT 1 FROM search_index s WHERE s.entity_id = 'memory:' || m.id
         )`,
      )
      .all() as Array<Record<string, unknown>>;
    if (missing.length === 0) return;
    indexEntries(
      db,
      missing.map((m) => ({
        title: (m.content as string).slice(0, 80),
        body: m.content as string,
        entityType: "memory" as const,
        entityId: memorySearchEntityId(m.id as string),
        projectId: m.project_id as string,
        agentId: (m.source_agent_id as string) || undefined,
      })),
    );
    logger.info(`[Memory] Backfilled ${missing.length} memories into search index`);
  } catch (err) {
    memoriesBackfilled = false; // retry on next search
    logger.warn("[Memory] Search index backfill failed:", err);
  }
}

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
    reinforcementCount: (row.reinforcement_count as number) ?? 1,
    lastReinforcedAt: (row.last_reinforced_at as number) ?? (row.created_at as number),
    supersededBy: (row.superseded_by as string) ?? null,
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function listMemories(
  db: Database.Database,
  projectId: string,
  opts?: { includeSuperseded?: boolean },
): MemoryEntry[] {
  const sql = opts?.includeSuperseded
    ? "SELECT * FROM memories WHERE project_id = ? ORDER BY relevance_score DESC, last_accessed_at DESC"
    : `SELECT * FROM memories WHERE project_id = ? AND superseded_by IS NULL
       ORDER BY relevance_score DESC, last_accessed_at DESC`;
  const rows = db.prepare(sql).all(projectId);
  return (rows as Record<string, unknown>[]).map(mapMemoryRow);
}

export function createMemory(db: Database.Database, data: MemoryCreate): MemoryEntry {
  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);
  const score = data.relevanceScore ?? 0.5;

  db.prepare(
    `INSERT INTO memories
       (id, project_id, category, content, source_agent_id, relevance_score,
        access_count, created_at, last_accessed_at, reinforcement_count, last_reinforced_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?)`,
  ).run(
    id,
    data.projectId,
    data.category,
    data.content,
    data.sourceAgentId ?? null,
    score,
    now,
    now,
    now,
  );

  indexEntry(db, {
    title: data.content.slice(0, 80),
    body: data.content,
    entityType: "memory",
    entityId: memorySearchEntityId(id),
    projectId: data.projectId,
    agentId: data.sourceAgentId,
  });

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
    reinforcementCount: 1,
    lastReinforcedAt: now,
    supersededBy: null,
  };
}

export function getMemoryById(db: Database.Database, id: string): MemoryEntry | null {
  const row = db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
  return row ? mapMemoryRow(row as Record<string, unknown>) : null;
}

export function deleteMemory(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  removeFromIndex(db, memorySearchEntityId(id));
}

export function updateMemoryRelevance(
  db: Database.Database,
  id: string,
  relevanceScore: number,
): void {
  db.prepare("UPDATE memories SET relevance_score = ? WHERE id = ?").run(relevanceScore, id);
}

// ─── Reinforcement + supersession (T126) ────────────────────────────────────

/** The same fact was re-observed: bump reinforcement_count, never duplicate. */
export function reinforceMemory(db: Database.Database, id: string): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `UPDATE memories SET reinforcement_count = reinforcement_count + 1, last_reinforced_at = ?
     WHERE id = ?`,
  ).run(now, id);
}

/** A contradicting/updated fact: insert the new row, mark the old one superseded. Never overwrites. */
export function supersedeMemory(
  db: Database.Database,
  oldId: string,
  data: MemoryCreate,
): MemoryEntry {
  // Transactional: a crash between INSERT and UPDATE must not leave both
  // rows active (duplicate near-identical facts injected into agents).
  const run = db.transaction(() => {
    const created = createMemory(db, data);
    db.prepare("UPDATE memories SET superseded_by = ? WHERE id = ?").run(created.id, oldId);
    return created;
  });
  const created = run();
  // Deindex the superseded row so hybrid search stops surfacing it.
  removeFromIndex(db, memorySearchEntityId(oldId));
  return created;
}

/**
 * Record an observed fact, deciding among reinforce / supersede / create by
 * comparing it against active (non-superseded) memories in the same project
 * + category. Returns the id of the row that now represents this fact.
 */
export function observeMemory(db: Database.Database, data: MemoryCreate): string {
  const candidates = db
    .prepare(
      "SELECT id, content FROM memories WHERE project_id = ? AND category = ? AND superseded_by IS NULL",
    )
    .all(data.projectId, data.category) as Array<{ id: string; content: string }>;

  const decision = classifyObservation(data.content, candidates);
  switch (decision.action) {
    case "reinforce":
      reinforceMemory(db, decision.matchId);
      return decision.matchId;
    case "supersede":
      return supersedeMemory(db, decision.matchId, data).id;
    case "create":
      return createMemory(db, data).id;
  }
}

// ─── Search ──────────────────────────────────────────────────────────────────

/**
 * Hybrid RRF search over memories (T125): FTS5 keyword ranking fused with
 * Ollama-embedding similarity when `ollamaConfig` is given. Falls back to a
 * LIKE scan when the query has no usable FTS5 tokens (e.g. punctuation-only).
 */
export async function searchMemories(
  db: Database.Database,
  projectId: string,
  query: string,
  ollamaConfig?: OllamaConfig,
): Promise<MemoryEntry[]> {
  ensureMemoriesIndexed(db);

  // Structural guarantee: memory recall never hard-fails — any hybrid-search
  // exception degrades to the LIKE scan instead of rejecting the IPC call.
  let hits: Awaited<ReturnType<typeof hybridSearch>> = [];
  try {
    hits = await hybridSearch(db, query, {
      projectId,
      entityType: "memory",
      limit: 20,
      ollamaConfig,
    });
  } catch (err) {
    logger.warn("[Memory] hybridSearch failed, falling back to LIKE:", err);
  }

  if (hits.length === 0) {
    const pattern = `%${query}%`;
    const rows = db
      .prepare(
        `SELECT * FROM memories WHERE project_id = ? AND superseded_by IS NULL AND content LIKE ?
         ORDER BY relevance_score DESC LIMIT 20`,
      )
      .all(projectId, pattern);
    return (rows as Record<string, unknown>[]).map(mapMemoryRow);
  }

  // T126: superseded rows are filtered here too — the search index may still
  // hold entries indexed before their row was superseded.
  const ids = hits.map((h) => h.entityId.replace(/^memory:/, ""));
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM memories WHERE id IN (${placeholders}) AND superseded_by IS NULL`)
    .all(...ids) as Record<string, unknown>[];

  const byId = new Map(rows.map((r) => [r.id as string, mapMemoryRow(r)]));
  return ids.map((id) => byId.get(id)).filter((m): m is MemoryEntry => m !== undefined);
}

// ─── Retrieval for injection ─────────────────────────────────────────────────

/**
 * Retrieve top-N most relevant memories for injection into an agent prompt.
 * Ranked by salience v2 (T126): similarity × log(reinforcement+1) × half-life
 * decay — computed in JS since sqlite has no LN/EXP without an extension.
 * Superseded facts are always excluded.
 */
export function getMemoriesForInjection(
  db: Database.Database,
  projectId: string,
  maxCount = 10,
  maxTokenBudget = 2000,
): MemoryEntry[] {
  // Bounded scan: salience needs JS math, but sorting by last_reinforced_at in
  // SQL first keeps the spawn critical path O(500) instead of O(all memories).
  const rows = db
    .prepare(
      `SELECT * FROM memories WHERE project_id = ? AND superseded_by IS NULL
       ORDER BY last_reinforced_at DESC LIMIT 500`,
    )
    .all(projectId);

  const now = Math.floor(Date.now() / 1000);
  const memories = (rows as Record<string, unknown>[])
    .map(mapMemoryRow)
    .sort((a, b) => computeSalience(b, now) - computeSalience(a, now));

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
    const items = entries.map((e) => `- ${stripAnsi(e.content)}`).join("\n");
    sections.push(`### ${label}\n${items}`);
  }

  return `# Project Memory\n\n${sections.join("\n\n")}\n`;
}
