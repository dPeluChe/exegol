# T23 — Project-Wide Full-Text Search

## Inspiration Source
- **Repo**: QMD (`github.com/tobi/qmd`)
- **Files studied**: `src/store.ts` (FTS5 virtual table creation with `porter unicode61` tokenizer, BM25 scoring, trigger-based sync), `src/store.ts:2650-2814` (query building with phrase support, negation, prefix matching, sanitization)
- **Repo**: OpenClaw/memU (`github.com/NevaMind-AI/memU`)
- **Files studied**: `memu/storage/` (dual retrieval patterns), `openclaw/src/memory/memory-schema.ts` (UNINDEXED columns pattern), `openclaw/src/memory/hybrid.ts` (BM25 rank-to-score conversion)
- **Pattern applied**: FTS5 virtual table with porter stemmer + unicode61 tokenizer. BM25 ranking with `bm25(table, 5.0, 1.0)` weights. UNINDEXED metadata columns (entity_type, entity_id, project_id, agent_id) to avoid index bloat. Safe query building with phrase support and prefix matching.

## What Changed
- `apps/desktop/src/main/db/migrations.ts` — Migration 013: FTS5 virtual table `search_index` with `title`, `body` (indexed) + metadata (UNINDEXED), `porter unicode61` tokenizer
- `apps/desktop/src/main/db/queries/search.ts` — NEW: FTS5 query builder (phrase + prefix support), `indexEntry`, `indexEntries`, `indexScrollback` (4KB chunking), `indexPrompt`, `search` (BM25 ranked), `rebuildIndex`, `removeFromIndex`, `isIndexed`
- `apps/desktop/src/main/db/queries.ts` — Re-export search queries
- `apps/desktop/src/main/ipc/procedures/search.ts` — NEW: tRPC router with `query` (search), `indexAgent` (index scrollback with ANSI stripping), `rebuild` (full reindex)
- `apps/desktop/src/main/ipc/router.ts` — Register search router
- `apps/desktop/src/renderer/hooks/use-trpc.ts` — Added `useSearch`, `useIndexAgent`, `useRebuildSearchIndex` hooks
- `apps/desktop/src/renderer/components/workspace/sections/SearchSection.tsx` — NEW: Search UI with debounced input, result cards with safe snippet rendering (mark tag parsing), entity type icons, rebuild button
- `apps/desktop/src/renderer/components/workspace/WorkspaceTabs.tsx` — Added "Search" tab
- `apps/desktop/src/renderer/components/workspace/WorkspaceView.tsx` — Added SearchSection rendering

## Architecture Decisions
- **FTS5 over manual text search**: SQLite FTS5 provides BM25 ranking, snippet extraction, and porter stemming out of the box. libSQL supports FTS5 natively.
- **UNINDEXED metadata columns**: Following QMD/OpenClaw pattern, metadata (entity_type, entity_id, project_id, agent_id) stored in FTS table but not indexed, avoiding JOINs while keeping the FTS index lean.
- **4KB chunking for scrollback**: Agent output can be large (1MB). Chunked into ~4KB segments so snippets are meaningful and FTS index stays performant.
- **ANSI stripping on index**: Raw PTY output contains escape codes. These are stripped before indexing so search matches are on visible text only.
- **Safe snippet rendering**: Instead of `dangerouslySetInnerHTML`, the `renderSnippet()` function parses `<mark>` tags from FTS5 into React elements, avoiding XSS.
- **Rebuild button**: Full reindex from current DB state (prompts, agent task descriptions, scheduler results). Scrollback indexing triggered per-agent via `indexAgent` mutation.

## How to Test
1. Create some prompts and agent sessions with varied content
2. Navigate to Search tab in workspace
3. Click "Rebuild Index" to index existing content
4. Type search queries — results should appear with highlighted matches
5. Try phrase search with "quotes", prefix matching (partial words)
6. Results show entity type icon, title, snippet with highlighted matches, and BM25 score
