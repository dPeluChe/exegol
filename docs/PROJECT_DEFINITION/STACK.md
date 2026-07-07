# Technology Stack

Every technology choice is justified with data from ecosystem research. See [RESEARCH.md](./RESEARCH.md) for full analysis.

## Core Stack

| Layer | Technology | Version | Justification |
|-------|-----------|---------|---------------|
| **Desktop shell** | Electron | 41.x | Codex App uses Electron 40. Chromium guarantees identical rendering across platforms. Tauri rejected due to WebView inconsistency between macOS/Windows/Linux |
| **Frontend** | React 18 | 18.3.x | Industry standard. Used by Codex, Superset. Rich component ecosystem |
| **Styling** | TailwindCSS | 4.x | Used by Superset. Utility-first, fast iteration, consistent design. Via @tailwindcss/vite plugin |
| **Build** | electron-vite | 5.x | Electron-specific Vite wrapper. Handles main/renderer/preload builds |
| **Runtime** | Bun | 1.2.0 | Used by Superset, T3 Code. 3x faster than Node for startup and package resolution |
| **Monorepo** | Turborepo | 2.4.x | Validated by Superset (96 releases) and T3 Code |
| **Linting/Format** | Biome | 2.4.7 | Replaces ESLint + Prettier. Used by Superset. Single tool, faster |
| **Type safety** | TypeScript | 5.7.x | Universal in this ecosystem |
| **IPC** | tRPC | 11.x | Type-safe bridge between Electron main/renderer via createCaller proxy traversal |
| **State (frontend)** | Zustand | 5.x | Lightweight, React-focused. Persist middleware for session state (useAppStore) and workspace layout (useWorkspaceStore) |
| **UI primitives** | Radix UI | 1.x | Used by Codex App. Accessible, unstyled, composable. Currently using Dialog |
| **Schemas** | Zod | 3.23.x | Runtime validation. Used by Codex (Immer + Zod), Mastra, MCP SDK |

## Native Layer (Rust via napi-rs)

| Module | Crate | Purpose |
|--------|-------|---------|
| **MCP Host** | `rmcp` (v0.16.0) | Host MCP connections to N servers. JSON-RPC 2.0 over stdio/HTTP |
| **Tree-sitter** | `tree-sitter` (first-party) | Parse ASTs for repo map generation. 774K downloads/mo on crates.io |
| **AST edits** | `ast-grep` | Structure-aware code modifications. Fewer tool calls, deterministic edits |
| **Git ops** | `git2` | Worktree creation/cleanup, diff generation, status |
| **File watching** | `notify` | Filesystem events for live updates |
| **Async runtime** | `tokio` | Used by Codex's Rust backend. Async I/O for MCP, git, filesystem |
| **SQLite (heavy ops)** | `rusqlite` | Rust-side database access for performance-critical paths (tree-sitter parsing, file watching) |
| **Vector ops** | `libsql` crate | Vector embeddings for semantic search, skill matching, RAG. Used ONLY for vector operations |
| **Serialization** | `serde` + `schemars` | JSON serialization + JSON Schema generation for MCP |
| **napi bridge** | `napi-rs` | Expose Rust functions to Node.js/Bun. Zero-copy where possible |

## Electron Main Process

| Technology | Purpose |
|-----------|---------|
| `libsql` npm v0.5.x | Primary state database (sessions, agents, worktrees, history). API compatible with better-sqlite3 but adds native vector embeddings, encryption at rest, and BEGIN CONCURRENT for multi-writer |
| `node-pty` v1.x | Pseudo-terminal for spawning CLI agents. Requires `npx @electron/rebuild` against Electron version |
| `croner` v9.x | Cron expression parser for scheduled tasks (dependency installed, scheduler engine not yet implemented) |
| `nanoid` v5.x | Compact unique ID generation for all database entities |
| `tRPC server` v11.x | Type-safe API for renderer process. Uses createCaller (not HTTP) over IPC |

## Renderer (React)

| Technology | Purpose |
|-----------|---------|
| `@xterm/xterm` v6.x + `@xterm/addon-webgl` v0.19.x | Terminal emulation. Standard in VS Code. WebGL critical for performance (Superset reported issues without it) |
| `@xterm/addon-fit` v0.11.x | Auto-resize terminal to container |
| `@xterm/addon-web-links` v0.12.x | Clickable URLs in terminal output |
| `@monaco-editor/react` v4.x + `monaco-editor` | Read-only code viewer with VS Code-quality syntax highlighting (50+ languages). Local loading via `loader.config({ monaco })` — no CDN |
| `react-markdown` v9.x | Markdown preview for .md files in CodeViewer (toggle Code/Preview) |
| `react-resizable-panels` v2.x | Split pane layout: sidebar + workspace panes. Used for workspace splits |
| `@tanstack/react-query` v5.x | Data fetching layer used by tRPC client hooks |
| `lucide-react` v0.460.x | Icon library used throughout the UI |
| D3 or Cytoscape | Agent DAG visualization (Phase 3, not yet implemented) |

## Database: libSQL (SQLite fork by Turso)

**Why libSQL instead of plain SQLite**:
- Native vector embeddings as column type (F32_BLOB) + DiskANN index — no separate vector DB needed
- Encryption at rest (built-in, no proprietary SEE license)
- BEGIN CONCURRENT for multi-writer (multiple agents writing token usage simultaneously)
- 100% backward-compatible with SQLite file format
- `libsql` npm package has same API as better-sqlite3

**Performance strategy** (libSQL writes are 50-200x slower than rusqlite in tight loops):
- Node.js main process: `libsql` npm for all CRUD + vector queries
- Rust napi-rs: `rusqlite` for heavy operations (tree-sitter, batch inserts). `libsql` crate only for vector operations

### Schema

12 migrations implemented (`apps/desktop/src/main/db/migrations.ts`). Tables created via sequential migration IDs (001-012). Queries split into domain files under `db/queries/` (helpers, projects, agents, worktrees, token-usage, scheduler, prompts) with barrel re-export from `queries.ts`.

```sql
-- ─── Implemented tables (migrations 001-010) ───

-- Core entities
projects (
  id, name, path, git_remote, default_branch, default_ide,
  created_at, last_opened_at
)

agents (
  id, project_id, worktree_id, cli_type, status, task_description,
  current_step,          -- what the agent is currently working on (live status)
  pid, started_at, stopped_at
)
-- agent.status: idle | spawning | running | waiting_input | paused | completed | failed | stopped
-- (migration 010 adds 'stopped' status for agents killed when app exits)
-- agent.current_step: free text updated by parsing agent output (e.g. "Writing auth middleware...")

worktrees (
  id, project_id, agent_id, path, branch_name,
  auto_cleanup, disk_usage_bytes, created_at
)

sessions (
  id, project_id, layout_state, started_at, ended_at
)

-- Scheduling
scheduled_tasks (
  id, project_id, prompt, cron_expression, skill_name,
  last_run_at, next_run_at, last_result_status, enabled
)

scheduled_results (
  id, task_id, agent_id, status, summary, created_at
)

-- Intelligence layer
skills (
  id, name, description, path, source_scope,
  description_embedding F32_BLOB(1536)  -- for semantic matching
)

mcp_servers (
  id, project_id, name, transport_type, command, args, url, enabled
)

plans (
  id, project_id, track_name, status, spec_path, plan_path,
  total_steps, completed_steps, current_step_text, created_at
)
-- plan.status: draft | specifying | planning | approved | implementing | paused | complete

-- Observability
token_usage (
  id, agent_id, provider, model, input_tokens, output_tokens,
  estimated_cost_usd, tool_call_count, recorded_at,
  source              -- 'agent' | 'log_scan' (migration 012, distinguishes live agent records from JSONL scan imports)
)

port_registry (
  id, worktree_id, port, source, status, detected_at
)
-- port.source: config_parsed | runtime_detected
-- port.status: configured | listening | idle | conflict

host_metrics (
  id, agent_id, cpu_percent, memory_bytes, disk_bytes, recorded_at
)

settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
)
-- Key-value store for persisted settings (serialized as JSON)

-- ─── Tables below are PLANNED (not yet created as migrations) ───

-- Vector tables (leverage libSQL native embeddings)
code_embeddings (
  id, project_id, file_path, symbol_name, symbol_type,
  embedding F32_BLOB(1536),  -- for semantic code search
  content_hash, updated_at
)

agent_memory (
  id, project_id, agent_id, content, summary,
  embedding F32_BLOB(1536),  -- for RAG over past sessions
  session_id, created_at
)
```

### Vector-Powered Features

```sql
-- Semantic code search: "find authentication logic"
CREATE INDEX code_emb_idx ON code_embeddings(
  libsql_vector_idx(embedding, 'metric=cosine')
);

SELECT file_path, symbol_name
FROM vector_top_k('code_emb_idx', vector(?), 10) AS v
JOIN code_embeddings c ON c.id = v.id
WHERE c.project_id = ?;

-- Skill matching: find best skill for user's request
SELECT name, description
FROM vector_top_k('skill_emb_idx', vector(?), 3) AS v
JOIN skills s ON s.id = v.id;

-- Similar past tasks: "you solved something like this 3 days ago"
SELECT content, summary
FROM vector_top_k('memory_emb_idx', vector(?), 5) AS v
JOIN agent_memory m ON m.id = v.id
WHERE m.project_id = ?;
```

## Rejected Technologies

| Technology | Reason for rejection |
|-----------|---------------------|
| **Tauri 2** | WebView inconsistency across platforms (WKWebView/WebView2/WebKitGTK). Deal-breaker for complex UIs. Codex validates Electron+Rust instead |
| **Swift/AppKit** | macOS only. Cmux proves the quality but limits market to 1 platform |
| **Mastra** | Adds framework dependency for orchestration we can build simpler. Superset's fork maintenance proves the burden |
| **Drizzle + Neon** | Overengineering for local desktop app. libSQL + rusqlite covers relational + vector needs locally |
| **better-sqlite3** | Replaced by `libsql` npm package v0.5.x (same API but adds vectors, encryption, multi-writer). Codex uses better-sqlite3 but we gain vector features with libSQL |
| **Pinecone / Qdrant / pgvector** | Separate vector DB adds infra complexity. libSQL native vectors keep everything in one .db file |
| **LangChain/LangGraph** | Python ecosystem. We're TypeScript + Rust |
| **AgentFS/FUSE** | Alpha (v0.4.1), no production users, single-writer SQLite limitation. Git worktrees + SQLite snapshots cover 95% of use cases |
| **libghostty** | Requires native compilation per platform. xterm.js + WebGL is good enough for Electron and cross-platform |
| **Node.js** | Bun is faster for startup and package resolution. Validated by Superset and T3 Code |

## Dependency Risk Assessment

| Dependency | Risk | Mitigation |
|-----------|------|-----------|
| Electron | High memory usage (~300MB) | Optimize with lazy loading, process pooling |
| rmcp (Rust MCP SDK) | Pre-1.0, API may change | Pin version, community alternatives exist (rust-mcp-sdk) |
| xterm.js | Performance under load | WebGL addon mandatory. Limit visible terminal count |
| napi-rs | Bridge overhead | Zero-copy bindings, batch Rust calls |
| libsql (npm + crate) | Pre-1.0 Rust crate, 50-200x slower writes vs rusqlite | Use rusqlite for heavy writes, libsql only for vectors. Node.js side: acceptable perf for CRUD |
| tree-sitter grammars | Per-language maintenance | tree-sitter-language-pack bundles 165+ languages |
