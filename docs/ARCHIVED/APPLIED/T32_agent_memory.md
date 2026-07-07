# T32 — Agent Memory System

## Inspiration Source
- **Repo**: memU (`github.com/NevaMind-AI/memU`)
- **Files studied**: `memu/core/memory.py`, `memu/core/retrieval.py`, `memu/app/memorize.py`
- **Pattern applied**: 3-layer hierarchy (resource → item → category), typed memory categories

- **Repo**: DeerFlow (`github.com/bytedance/deer-flow`)
- **Files studied**: `backend/packages/harness/deerflow/agents/memory/updater.py`, `prompt.py`, `queue.py`
- **Pattern applied**: Category-based memory organization, confidence/relevance scoring, token-budget-aware injection

- **Repo**: Nanobot (`github.com/HKUDS/nanobot`)
- **Files studied**: `nanobot/agent/memory.py`
- **Pattern applied**: Two-layer memory model, consolidation on completion, grep-based recall

- **Repo**: TinyClaw (`github.com/warengonzaga/tinyclaw`)
- **Files studied**: `packages/memory/src/index.ts`
- **Pattern applied**: 3-factor relevance scoring (text match + temporal decay + importance), access count tracking, Jaccard similarity for deduplication

## What Changed
- `apps/desktop/src/main/memory/store.ts` — NEW: Memory CRUD, search, 3-factor relevance scoring, token-budget injection, context builder
- `apps/desktop/src/main/memory/extractor.ts` — NEW: Pattern-based knowledge extraction from scrollback, deduplication via Jaccard similarity
- `apps/desktop/src/main/db/migrations.ts` — Migration 014: memories table with indexes
- `apps/desktop/src/main/ipc/procedures/memory.ts` — NEW: tRPC router (list, search, create, delete, updateRelevance, getContext, extract)
- `apps/desktop/src/main/ipc/router.ts` — Registered memory router
- `apps/desktop/src/main/agents/manager.ts` — Memory extraction on agent completion (before scrollback flush), memory context injection on spawn
- `apps/desktop/src/renderer/hooks/use-trpc.ts` — Added useMemories, useSearchMemories, useCreateMemory, useDeleteMemory hooks
- `apps/desktop/src/renderer/components/workspace/WorkspaceTabs.tsx` — Added Memory tab
- `apps/desktop/src/renderer/components/workspace/WorkspaceView.tsx` — Added MemorySection
- `apps/desktop/src/renderer/components/workspace/sections/MemorySection.tsx` — NEW: Memory browser UI with search, categories, manual add, delete

## Architecture Decisions
- **Pattern-based extraction (no LLM)** — Extracts knowledge from scrollback using regex patterns for errors, solutions, dependencies, conventions, and preferences. Avoids LLM dependency for extraction (can be added later as Tier 2). Non-fatal: extraction never blocks agent completion.
- **3-factor relevance scoring** — Combined score from relevance (40%) + temporal recency (30%) + access frequency (30%), inspired by TinyClaw. Memories that are more relevant, more recent, and more frequently accessed rank higher.
- **Token-budget-aware injection** — `getMemoriesForInjection()` retrieves top-N memories respecting a token budget (default 2000 tokens, ~8KB). Prevents memory context from overwhelming the agent prompt.
- **Access count tracking** — Every time memories are retrieved for injection, their access count is bumped. This creates a positive feedback loop: useful memories get used more, increasing their score.
- **Jaccard similarity deduplication** — Both during extraction (from scrollback) and during storage (against existing DB entries), content is deduplicated using word-level Jaccard similarity with 0.8 threshold.
- **Category-based organization** — 6 categories (preference, pattern, error, solution, dependency, convention) inspired by DeerFlow's fact categories. Categories enable filtered views and targeted retrieval.
- **Memory context injection order** — On spawn: memory → MCP tools → skills → task description. Memory comes first as it's the most project-specific context.

## How to Test
1. Spawn an agent, let it run a task that produces errors or installs dependencies
2. After agent completes, check Memory tab — extracted memories should appear
3. Manually add a memory via the "Add" button — select category and enter content
4. Search memories using the search bar — should filter by keyword
5. Filter by category using the category buttons
6. Delete a memory via the trash icon (with confirmation)
7. Spawn a new agent — memory context should appear in the prompt prefix
8. Check relevance scoring: frequently accessed memories should rank higher over time
