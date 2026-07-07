# Ecosystem Research

Comprehensive analysis of AI development platforms, frameworks, and foundational technologies. All data verified through primary sources (GitHub repos, official docs, reverse engineering reports).

---

## Platforms Analyzed

### 1. OpenAI Codex App

**What it is**: Desktop "command center" for agentic coding. Not the old Codex model — this is a full application.

**Stack (reverse-engineered by Yangshun Tay from build v26.212.1823)**:
- Frontend: Electron 40 + React 18 + ProseMirror + Radix UI + Shiki + Framer Motion + D3/Mermaid/Cytoscape
- Main process: better-sqlite3, node-pty, WebSocket, OAuth2, Immer + Zod
- Backend: Rust — tree-sitter, rmcp (MCP), sqlx-sqlite, tokio, reqwest, OpenTelemetry
- The desktop app and CLI share the same Rust core

**Key architecture**:
- Git worktrees: each agent = 1 isolated worktree, shared `.git` directory
- Skills system: Progressive Disclosure in 3 phases (metadata → SKILL.md → scripts/resources)
- Automations: background agents with configurable cadence, results go to inbox, state in SQLite
- Token model powering it: GPT-5 family (5.2-Codex, 5.3-Codex, 5.4)

**Pricing**: Bundled with ChatGPT — Plus $20/mo (30-150 msgs/5h), Pro $200/mo (300-1500 msgs/5h)

**Status**: Production. macOS + Windows (since March 2026). Linux pending.

**Limitations**:
- Rate limits hit quickly even on Pro ($200/mo)
- Defaults to Python/JS when no language specified
- Automations require app running and project on disk (no cloud-native background yet)

**Sources**: [GitHub](https://github.com/openai/codex), [Docs](https://developers.openai.com/codex/), [Reverse engineering](https://www.linkedin.com/posts/yangshun_i-reversed-engineered-openai-codex-desktop-activity-7424676759347822593-WNN-)

---

### 2. Superset

**What it is**: "IDE for the AI Agents Era" — desktop app to run 10+ CLI agents simultaneously on local machine.

**Stack (verified from GitHub repo)**:
- Electron + React + TailwindCSS + Bun + Drizzle ORM + Neon + tRPC + Turborepo + Vite + Biome + xterm.js
- TypeScript primary language
- Built by three ex-YC CTOs (Adam, Untether Labs, Onlook)

**Key architecture**:
- Git worktrees: core concept — 1 worktree per agent/task
- Mastracode: internal fork of Mastra (superset-sh/mastra) with HookManager for intercepting agent lifecycle
- Built-in chat panel via @superset/chat-mastra using createMastraCode()
- Versioned tarballs for deterministic installs of fork

**GitHub**: [superset-sh/superset](https://github.com/superset-sh/superset) — 7,208 stars, 507 forks, 56 contributors, Apache 2.0

**Pricing**: Free + open source. Pro plan $20/seat/mo (features unclear)

**Status**: Production (v1.1.7, 96 releases since Oct 2025)

**Real limitations**:
- 10 worktrees = 10 dependency installs, 10 dev servers, 10 DB instances
- xterm.js performance issues reported by multiple developers
- "Converts typing time into reading time, which is usually worse" — HN feedback
- Senior engineers report workflow not intuitive

**Sources**: [GitHub](https://github.com/superset-sh/superset), [Website](https://superset.sh/), [HN thread](https://news.ycombinator.com/item?id=46368739)

---

### 3. Cmux

**What it is**: Native macOS terminal app for managing multiple AI coding agents. Built by Manaflow (YC company).

**Stack (verified)**:
- Swift + AppKit (native macOS, no Electron)
- libghostty for GPU-accelerated terminal rendering
- WebKit embedded browser (not Chromium)

**Key architecture**:
- OSC escape sequence interception: captures OSC 9/99/777 from any CLI agent
- Translates to: notification rings around panes, unread badges in sidebar, native macOS notifications
- Vertical tabs sidebar: git branch, PR status, working dir, listening ports, last notification per workspace
- WebKit browser with socket API for agent DOM interaction
- Works with ANY terminal-based agent (Claude Code, Codex, Aider, Gemini CLI, etc.)

**GitHub**: [manaflow-ai/cmux](https://github.com/manaflow-ai/cmux) — 5,200+ stars, AGPL license, free

**Real limitations**:
- macOS only (no Windows/Linux — unofficial fork exists)
- No unified search across panes
- No process state restoration after restart (layout restored, active sessions lost)
- Requires Ghostty config familiarity

**Sources**: [GitHub](https://github.com/manaflow-ai/cmux), [Website](https://www.cmux.dev/), [HN](https://news.ycombinator.com/item?id=47079718)

---

### 4. Conductor (TWO distinct products)

#### 4a. Conductor.build (Melty Labs)

**What it is**: Free macOS app for running parallel Claude Code agents. YC-backed.

- Creates isolated git worktrees per agent
- Review diffs and merge changes
- Used by engineers at Linear, Vercel, Notion, Stripe
- Closed source, no public GitHub repo

**Controversy**: Requested full read-write access to entire GitHub accounts. Team acknowledged issue, migrating to GitHub App auth with fine-grained permissions.

**Sources**: [Website](https://www.conductor.build/), [Docs](https://docs.conductor.build/), [YC](https://www.ycombinator.com/companies/conductor)

#### 4b. Conductor for Gemini CLI (Google)

**What it is**: Open-source Gemini CLI extension implementing "Context-Driven Development".

**Key architecture**:
- Setup phase: `/conductor:setup` generates product.md, product-guidelines.md, tech-stack.md, workflow.md
- Track system: `/conductor:newTrack` → spec.md + plan.md → `/conductor:implement`
- Plan.md FSM: agent works through checkboxes sequentially, state persisted in file
- Resumable: stop, close terminal, resume later without context loss
- tracks.md as central registry of all work and status
- Multi-agent parallelism proposed (GitHub issue #66) but not implemented yet

**Sources**: [GitHub](https://github.com/gemini-cli-extensions/conductor), [Google Developers Blog](https://developers.googleblog.com/conductor-introducing-context-driven-development-for-gemini-cli/)

---

### 5. T3 Code (t3coder)

**What it is**: Minimal web-based GUI wrapper for CLI coding agents. Built by Theo Browne (t3.gg).

**Stack (verified)**: TypeScript + Bun + Turborepo + Vite + Vitest

**Key features**:
- GitCore 3-tier: low-level ops → GitManager → workflow orchestration
- Diff viewer with staging and commit from UI
- Git worktree support per task with conflict detection

**GitHub**: [pingdotgg/t3code](https://github.com/pingdotgg/t3code) — 6,100 stars

**Status**: Alpha v0.0.0-alpha.22. Codex only (Claude "coming soon"). Buggy. Not accepting PRs.

**Sources**: [GitHub](https://github.com/pingdotgg/t3code), [Website](https://t3.codes/)

---

### 6. Aider

**What it is**: CLI tool for AI pair programming. The most popular open-source option.

**GitHub**: [Aider-AI/aider](https://github.com/Aider-AI/aider) — 41,000+ stars, v0.86.2

**Key architecture**:

Edit formats:
- `whole`: LLM returns entire file (simple, expensive)
- `diff`: SEARCH/REPLACE blocks with git merge conflict syntax (no line numbers)
- `udiff`: simplified unified diff format. Made GPT-4 Turbo 3x less lazy
- `architect/editor`: two-model approach — expensive model plans, cheap model executes

Repo map system:
1. Tree-sitter parses all files → Concrete Syntax Trees
2. Extract definitions (where symbols declared) and references (where used)
3. Build NetworkX MultiDiGraph (files as nodes, dependencies as edges)
4. PageRank with personalization toward files in chat context
5. Select top-ranked definitions within token budget (binary search for optimal fit)

**Performance**: 4.2x fewer tokens than Claude Code on Morph benchmark. 4.3-6.5% context window utilization vs 54-70% for iterative search agents.

**Limitations**:
- diff format ~70-80% accuracy on complex codebases
- No autonomous agent loop (interactive, not fully agentic)
- Adding too many files degrades LLM performance

**Sources**: [Website](https://aider.chat/), [Repo map blog](https://aider.chat/2023/10/22/repomap.html), [GitHub](https://github.com/Aider-AI/aider)

---

## Frameworks and Technologies

### 7. Mastra

**What it is**: Open-source TypeScript framework for AI agents. Created by Gatsby.js founders. $13M seed (YC). 300K+ weekly npm downloads.

**GitHub**: [mastra-ai/mastra](https://github.com/mastra-ai/mastra) — 16,100 stars, 198 contributors

**Core features**:
- Agents with Zod-typed inputs/outputs
- Workflows as DAGs with .then(), .parallel(), .branch()
- RAG pipeline (pgvector, Pinecone, Qdrant, MongoDB, libSQL)
- Observational Memory: 94.87% LongMemEval (claimed SOTA), 5-40x compression
- MCP client + server support
- Mastra Studio: local visual playground for debugging
- ast-grep integration (v1.6.0+): `mastra_workspace_ast_edit` for structure-aware code transforms

**Enterprise users**: Replit, SoftBank, PayPal, Adobe, Docker

**Limitations**:
- No built-in UI components
- Serverless friction with file-based libSQL
- Young ecosystem (1 year old)
- TypeScript only

**Sources**: [Docs](https://mastra.ai/docs), [GitHub](https://github.com/mastra-ai/mastra), [YC](https://www.ycombinator.com/companies/mastra)

---

### 8. AgentFS (Turso)

**What it is**: Virtual filesystem for AI agents backed by SQLite.

**Architecture**:
- FUSE mount (Linux) / NFS (macOS) — provides POSIX-compatible filesystem
- Copy-on-write overlay: host filesystem as read-only base, SQLite as writable delta
- Whiteout mechanism for deletions
- Snapshots via `cp agent.db snapshot.db` (leverages SQLite WAL)
- SDK: Filesystem + Key-Value Store + Toolcall Audit Trail

**GitHub**: [tursodatabase/agentfs](https://github.com/tursodatabase/agentfs) — v0.4.1

**Status**: ALPHA — explicitly "development and testing only, not for critical data"

**Real-world adoption**: None documented in production. Critical Medium article: "File-based agent memory: great demo, good luck in prod"

**Limitations**:
- SQLite single-writer model limits concurrency
- Write amplification (4KB page granularity)
- Text files primarily (PDF/binary not well supported)
- POSIX metadata recorded but NOT enforced

**Sources**: [GitHub](https://github.com/tursodatabase/agentfs), [Turso blog](https://turso.tech/blog/agentfs)

---

### 9. Tree-sitter

**What it is**: Incremental parser generator that builds concrete syntax trees at millisecond speed.

**Performance**: 10K-line C file in <100ms. Incremental re-parse 70% faster than full parse. 36x faster than JavaParser.

**Language support**: 165+ grammars via community-maintained packages.

**Rust bindings**: First-party, maintained in official repo. 774K downloads/month on crates.io. Used by 1,057+ crates.

**vs grep/regex**: Tree-sitter understands code structure (distinguishes definitions from references, handles multi-line constructs, tolerates syntax errors). Regex matches text patterns with no structural awareness.

**Sources**: [GitHub](https://github.com/tree-sitter/tree-sitter), [crates.io](https://crates.io/crates/tree-sitter), [Aider repo map](https://aider.chat/2023/10/22/repomap.html)

---

### 10. Model Context Protocol (MCP)

**What it is**: Open standard (by Anthropic) for connecting AI applications to external data/tools. JSON-RPC 2.0 based.

**Spec version**: 2025-11-25. Previous: 2025-06-18, 2025-03-26, 2024-11-05.

**Transports**:
- stdio: client spawns server as subprocess, newline-delimited JSON-RPC over stdin/stdout
- Streamable HTTP: single endpoint, POST for messages, GET for SSE stream, session management via MCP-Session-Id

**Three primitives**:
- Tools (model-controlled): executable functions the LLM decides when to invoke
- Resources (application-controlled): passive data identified by URIs
- Prompts (user-controlled): reusable templates invoked explicitly (slash commands)

**Ecosystem**: 10,850+ servers on PulseMCP. 50+ known hosts/clients (Claude Desktop, ChatGPT, VS Code, Cursor, JetBrains, etc.)

**SDKs**:
- TypeScript: Tier 1 (reference), v1.27.1, 11.8K stars
- Rust `rmcp`: Tier 2, v0.16.0, pre-1.0, actively maintained. Supports tools, resources, prompts, sampling, OAuth, logging
- Also: Python (Tier 1), C# (Tier 1), Go (Tier 1), Java (Tier 2), Swift (Tier 3)

**Security concerns**:
- DNS rebinding attacks on local servers
- Tool description prompt injection
- Arbitrary code execution via tool calls
- Supply chain attacks via npx/package managers
- No standard discovery mechanism

**Sources**: [Spec](https://modelcontextprotocol.io/specification/2025-11-25), [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [Rust SDK](https://github.com/modelcontextprotocol/rust-sdk), [PulseMCP](https://www.pulsemcp.com/servers)

---

### 11. Tauri 2

**What it is**: Framework for building desktop apps with web frontends and Rust backends.

**Current version**: 2.10.3 (March 2026). Stable since October 2024.

**vs Electron**:
| Metric | Tauri 2 | Electron |
|--------|---------|----------|
| Memory (idle) | 30-50 MB | 200-300 MB |
| Startup | 0.3-0.5s | 1-4s |
| Binary size | 2.5-10 MB | 100+ MB |

**Key features**: Plugin architecture, ACL permissions, multiwebview (unstable), mobile support (iOS/Android), HMR on mobile.

**SQLite options**: tauri-plugin-sql (sqlx), tauri-plugin-rusqlite2 (community), direct rusqlite.

**xterm.js**: Works well. Terminon and tauri-terminal as reference implementations.

**Limitations**:
- WebView inconsistency across platforms (WKWebView/WebView2/WebKitGTK)
- Rust compilation time (first build slow)
- Mobile support immature
- Smaller ecosystem than Electron
- Rust learning curve for backend

**Why we chose Electron instead**: WebView inconsistency is a deal-breaker for complex UIs with terminals, diff viewers, and editors. Codex App (market leader) validates the Electron + Rust pattern. Chromium guarantees identical rendering across platforms.

**Sources**: [Tauri 2.0 release](https://v2.tauri.app/blog/tauri-20/), [GitHub](https://github.com/tauri-apps/tauri), [Plugin docs](https://v2.tauri.app/plugin/)

---

## libSQL (SQLite fork by Turso)

**What it is**: Open-source, open-contribution fork of SQLite. 100% backward-compatible with SQLite file format and C API, but adds native vector search, encryption, multi-writer, WASM UDFs, and server mode.

**Key advantage for Exegol**: Native vector embeddings as a column type — no separate vector DB needed.

**Vector capabilities**:
- 6 vector types: F32_BLOB, F64_BLOB, F16_BLOB, FB16_BLOB, F8_BLOB, F1BIT_BLOB
- Max 65,536 dimensions
- DiskANN index for approximate nearest neighbor search
- Distance metrics: cosine, L2/Euclidean, Hamming
- SQL syntax: `CREATE INDEX idx ON table(libsql_vector_idx(col, 'metric=cosine'))`
- Query: `SELECT * FROM vector_top_k('idx', vector(?), 10)`

**Node.js packages**:
- `libsql` npm: **better-sqlite3 compatible API** + vector support + encryption. Recommended for Electron
- `@libsql/client`: async/Promise-based client for local + remote

**Rust crates**:
- `libsql` (v0.9.24): local, remote, replica modes. Pre-1.0, ~20% doc coverage
- `rusqlite`: for performance-critical paths (50-200x faster writes than libsql crate in local mode)

**Performance reality**:
- Reads: identical to SQLite (~200ns per query with prepared statements)
- Writes: **50-200x slower** than rusqlite/better-sqlite3 in tight insert loops (documented GitHub issues)
- Strategy: use rusqlite for heavy writes, libsql only for vector operations

**How Mastra uses it**: Default storage AND vector store. Same DB for relational data + embeddings for RAG. `@mastra/libsql` package.

**Runs fully local**: `file:myapp.db` — no Turso cloud needed. MIT licensed.

**Sources**: [GitHub](https://github.com/tursodatabase/libsql), [Docs](https://docs.turso.tech/libsql), [Vector docs](https://turso.tech/vector)

---

## Token Usage Monitoring Ecosystem

### CodexBar (reference for built-in token tracking)

**What it is**: macOS menu bar app showing AI coding agent usage stats. By Peter Steinberger.

**GitHub**: [steipete/CodexBar](https://github.com/steipete/CodexBar) — MIT license, Swift/SwiftUI

**How it reads usage** (we replicate these techniques built-in):
- **Claude Code**: reads JSONL logs from `~/.claude/projects/**/`
- **Codex CLI**: local JSONL session logs
- **Gemini CLI**: CLI RPC protocol or PTY fallback
- **Browser cookies**: Safari/Chrome/Firefox for web dashboard data (opt-in)
- **IDE configs**: XML from JetBrains installations
- **OAuth**: macOS Keychain for Vertex AI via gcloud

**Supports 17+ providers**: Codex, Claude Code, Cursor, Gemini, Copilot, OpenRouter, Augment, Amp, Kiro, z.ai, Kimi, JetBrains AI, and more.

**Similar CLI tools**:
- [ccusage](https://github.com/ryoppippi/ccusage) — Node.js, reads JSONL, daily/monthly/session reports
- [tokscale](https://github.com/junhoyeo/tokscale) — Global leaderboard + 2D/3D contributions graph, real-time pricing via LiteLLM
- [toktrack](https://github.com/mag123c/toktrack) — Rust-based, ultra-fast, supports Claude/Codex/Gemini/OpenCode
- [cccost](https://github.com/badlogic/cccost) — Hooks Node.js fetch() to intercept API requests

**Key insight for Exegol**: All these are separate apps. No orchestration platform integrates token tracking natively. By reading the same JSONL logs + our own process tracking, Exegol provides cost visibility without external tools.

---

## Claude Code Architecture (Reference Implementation)

Studied as the primary reference for Exegol's design patterns. See [DESIGN_PATTERNS.md](./DESIGN_PATTERNS.md) for extracted patterns.

**Key systems**:
- Hooks: 4 handler types (command, http, prompt, agent), lifecycle events (PreToolUse, PostToolUse, etc.), exit code semantics (0=ok, 2=block)
- Skills: SKILL.md with YAML frontmatter, progressive disclosure, 2% context budget, auto-discovery via description matching
- Memory: layered hierarchy (managed > project > user), auto-compaction at ~83.5%, rule adherence degrades past 200 lines
- Worktrees: `--worktree` flag, auto-cleanup if no changes, /batch uses worktrees internally
- MCP: acts as Host, connects to N servers via .mcp.json

**Sources**: [Claude Code docs](https://code.claude.com/docs/en/overview), [GitHub](https://github.com/anthropics/claude-code), [Skills deep dive](https://mikhail.io/2025/10/claude-code-skills/)
