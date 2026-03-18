import type { SearchEntityType, SearchResult } from "@exegol/shared";
import type Database from "libsql";

export type { SearchEntityType, SearchResult };

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IndexEntry {
  title: string;
  body: string;
  entityType: SearchEntityType;
  entityId: string;
  projectId: string;
  agentId?: string;
}

// ─── Query building ─────────────────────────────────────────────────────────

/** Sanitize and build an FTS5 query string from user input. */
function buildFts5Query(raw: string): string | null {
  // Extract quoted phrases and plain terms
  const tokens: string[] = [];
  const phraseRegex = /"([^"]+)"/g;
  let remaining = raw;
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: regex iteration pattern
  while ((match = phraseRegex.exec(raw)) !== null) {
    if (match[1]?.trim()) {
      tokens.push(`"${match[1].trim()}"`);
    }
    remaining = remaining.replace(match[0], " ");
  }

  // Plain terms: sanitize and add prefix matching
  for (const word of remaining.split(/\s+/)) {
    const sanitized = word.replace(/[^\p{L}\p{N}']/gu, "").toLowerCase();
    if (sanitized.length > 0) {
      tokens.push(`"${sanitized}"*`);
    }
  }

  if (tokens.length === 0) return null;
  return tokens.join(" AND ");
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

/** Index a single entry into the FTS5 table. */
export function indexEntry(db: Database.Database, entry: IndexEntry): void {
  db.prepare(
    `INSERT INTO search_index (title, body, entity_type, entity_id, project_id, agent_id, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())`,
  ).run(
    entry.title,
    entry.body,
    entry.entityType,
    entry.entityId,
    entry.projectId,
    entry.agentId ?? "",
  );
}

/** Index multiple entries in a transaction. */
export function indexEntries(db: Database.Database, entries: IndexEntry[]): number {
  const stmt = db.prepare(
    `INSERT INTO search_index (title, body, entity_type, entity_id, project_id, agent_id, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())`,
  );

  let count = 0;
  const insertAll = db.transaction(() => {
    for (const entry of entries) {
      stmt.run(
        entry.title,
        entry.body,
        entry.entityType,
        entry.entityId,
        entry.projectId,
        entry.agentId ?? "",
      );
      count++;
    }
  });
  insertAll();
  return count;
}

/** Remove all indexed entries for a given entity. */
export function removeFromIndex(db: Database.Database, entityId: string): void {
  db.prepare("DELETE FROM search_index WHERE entity_id = ?").run(entityId);
}

/** Check if an entity is already indexed. */
export function isIndexed(db: Database.Database, entityId: string): boolean {
  const row = db.prepare("SELECT 1 FROM search_index WHERE entity_id = ? LIMIT 1").get(entityId);
  return row !== undefined;
}

/** Full-text search with BM25 ranking and snippet extraction. */
export function search(
  db: Database.Database,
  query: string,
  opts?: { projectId?: string; limit?: number },
): SearchResult[] {
  const ftsQuery = buildFts5Query(query);
  if (!ftsQuery) return [];

  const limit = opts?.limit ?? 50;

  let sql: string;
  const params: (string | number)[] = [ftsQuery];

  if (opts?.projectId) {
    sql = `
      SELECT
        title,
        snippet(search_index, 1, '<mark>', '</mark>', '...', 40) as snippet,
        entity_type,
        entity_id,
        project_id,
        agent_id,
        bm25(search_index, 5.0, 1.0) as score
      FROM search_index
      WHERE search_index MATCH ? AND project_id = ?
      ORDER BY score
      LIMIT ?
    `;
    params.push(opts.projectId, limit);
  } else {
    sql = `
      SELECT
        title,
        snippet(search_index, 1, '<mark>', '</mark>', '...', 40) as snippet,
        entity_type,
        entity_id,
        project_id,
        agent_id,
        bm25(search_index, 5.0, 1.0) as score
      FROM search_index
      WHERE search_index MATCH ?
      ORDER BY score
      LIMIT ?
    `;
    params.push(limit);
  }

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    title: row.title as string,
    snippet: row.snippet as string,
    entityType: row.entity_type as SearchEntityType,
    entityId: row.entity_id as string,
    projectId: row.project_id as string,
    agentId: (row.agent_id as string) || null,
    score: Math.abs(row.score as number),
  }));
}

/**
 * Index agent scrollback content. Splits into chunks to avoid FTS5 bloat.
 * Called on agent completion.
 */
export function indexScrollback(
  db: Database.Database,
  agentId: string,
  projectId: string,
  taskDescription: string,
  content: string,
): number {
  // Skip if already indexed (check both single-entry and first-chunk IDs)
  if (isIndexed(db, `scrollback:${agentId}`) || isIndexed(db, `scrollback:${agentId}:0`)) return 0;

  // Chunk content into ~4KB segments for reasonable snippet extraction
  const CHUNK_SIZE = 4096;
  const entries: IndexEntry[] = [];

  if (content.length <= CHUNK_SIZE) {
    entries.push({
      title: taskDescription || `Agent ${agentId}`,
      body: content,
      entityType: "scrollback",
      entityId: `scrollback:${agentId}`,
      projectId,
      agentId,
    });
  } else {
    const chunkCount = Math.ceil(content.length / CHUNK_SIZE);
    for (let i = 0; i < chunkCount; i++) {
      const chunk = content.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      entries.push({
        title: `${taskDescription || `Agent ${agentId}`} (${i + 1}/${chunkCount})`,
        body: chunk,
        entityType: "scrollback",
        entityId: `scrollback:${agentId}:${i}`,
        projectId,
        agentId,
      });
    }
  }

  return indexEntries(db, entries);
}

/** Index a prompt into the search index. */
export function indexPrompt(
  db: Database.Database,
  promptId: string,
  projectId: string,
  title: string,
  content: string,
): void {
  removeFromIndex(db, `prompt:${promptId}`);
  indexEntry(db, {
    title,
    body: content,
    entityType: "prompt",
    entityId: `prompt:${promptId}`,
    projectId,
  });
}

/** Rebuild the entire search index from current DB state (single transaction). */
export function rebuildIndex(db: Database.Database): { indexed: number } {
  db.prepare("DELETE FROM search_index").run();

  const entries: IndexEntry[] = [];

  // Collect prompts
  const prompts = db.prepare("SELECT id, project_id, title, content FROM prompts").all() as Array<
    Record<string, unknown>
  >;
  for (const p of prompts) {
    entries.push({
      title: p.title as string,
      body: p.content as string,
      entityType: "prompt",
      entityId: `prompt:${p.id}`,
      projectId: p.project_id as string,
    });
  }

  // Collect agent task descriptions
  const agents = db.prepare("SELECT id, project_id, task_description FROM agents").all() as Array<
    Record<string, unknown>
  >;
  for (const a of agents) {
    const desc = a.task_description as string;
    if (desc) {
      entries.push({
        title: desc,
        body: desc,
        entityType: "task_description",
        entityId: `task:${a.id}`,
        projectId: a.project_id as string,
        agentId: a.id as string,
      });
    }
  }

  // Collect scheduler results
  const results = db
    .prepare(
      `SELECT sr.id, sr.summary, st.project_id, sr.agent_id
       FROM scheduled_results sr
       JOIN scheduled_tasks st ON sr.task_id = st.id`,
    )
    .all() as Array<Record<string, unknown>>;
  for (const r of results) {
    const summary = r.summary as string;
    if (summary) {
      entries.push({
        title: `Scheduler result ${r.id}`,
        body: summary,
        entityType: "scheduler_result",
        entityId: `result:${r.id}`,
        projectId: r.project_id as string,
        agentId: (r.agent_id as string) || undefined,
      });
    }
  }

  return { indexed: indexEntries(db, entries) };
}
