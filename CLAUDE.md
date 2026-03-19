# Exegol

Electron + React + Rust desktop app for orchestrating AI coding agents (Claude Code, Codex, Gemini CLI, Aider, etc.).

## Current State (March 2026)

### What Works
- App launches, UI renders with dark/light/system theme and hidden titlebar (macOS traffic lights)
- Project management: add/remove/list projects, persist to libSQL
- Agent spawning: spawn CLI agents via node-pty through user's login shell, with Rust processing pipeline
- Agent provider registry: 9 built-in providers (Claude Code, Codex, Gemini, Aider, Goose, OpenCode, Amp, Kiro, Shell) + custom providers via settings
- Plain shell terminal: spawn `$SHELL` in project directory without agent CLI
- Workspace system: 3 main tabs (Agents, Project, Monitor) with sub-tabs
- Pane types: terminal (agent), browser (webview), files (FileExplorer), git (diff+oplog), empty (responsive agent grid)
- SVG agent icons: 19 icons from svgl.app with dark/light theme support via `import.meta.glob`
- Responsive EmptyPane: 3 breakpoints (full/compact/mini) via ResizeObserver
- Terminal emulation: xterm.js with WebGL addon, SerializeAddon for buffer persistence
- Terminal scrollback: stopped agents show read-only history with re-launch button, 30s periodic flush
- Monaco Editor: read-only code viewer with VS Code-quality syntax highlighting (50+ languages)
- Diff viewer + Oplog: Git pane with changes (diff) and agent operations (oplog/undo) toggle
- Agent status parsing: Rust native `AgentOutputStream` (50-100x faster ANSI strip + status parse), JS fallback
- Push-first status updates: IPC events from main process, polling reduced to 30s fallback
- Resources dashboard: CPU/RAM/disk with sparklines, per-agent process metrics, threshold colors
- Token usage dashboard: per-model cost breakdown, per-agent costs, daily trend, period selector (7d/14d/30d)
- Activity feed: timeline of agent lifecycle events with type filters
- Full-text search: FTS5 virtual table indexing scrollback, prompts, tasks with BM25 ranking
- Tab recovery tokens: workspace panes reconstruct on restart, graceful handling of deleted agents
- Skills system: markdown-based expert personas with YAML frontmatter, 5 defaults (architect, qa, debugger, reviewer, documenter), dual-tier discovery (project + global)
- MCP host: JSON-RPC 2.0 client with stdio/HTTP transports, tool discovery, context injection
- Agent memory: pattern extraction from scrollback, 3-factor relevance scoring, category filters, token-budget injection
- Quality scoring: 3-tier (auto-parse stdout, structured metrics, LLM-as-judge stub)
- Inter-agent messaging: SQLite-backed typed messages (text, handoff, status, request, result)
- Task queue: sequential/parallel/priority execution, concurrency limits, dependency tracking
- Dependency-aware scheduler: cron + dependency graph, concurrency guard
- Context handoff: token limit detection, structured handoff summaries, successor spawn
- Provider registry: dynamic agent CLI registration, custom providers via settings
- Crash recovery: detect interrupted sessions on startup (PID check), "crashed" status, scrollback preserved
- Agent cleanup: close pane/tab/Cmd+W stops agent + deletes from DB + removes from sidebar
- Shell auto-cleanup: shells auto-remove from sidebar on exit, pane converts to empty
- Settings: 5 tabs (General, Agent CLIs, Terminal, Shortcuts, API Keys), auto-save
- Sidebar: collapsible sections (Projects, Recent Sessions), footer with Schedulers/Resources
- Keyboard shortcuts: Cmd+B sidebar, Cmd+T new tab, Cmd+W close (with agent cleanup), Cmd+D/Shift+D split
- API key management: encrypted storage via OS keychain (safeStorage)
- Prompts & templates: CRUD per project, category filters, pin, copy, inject
- Port detection: lsof + config parsing
- CronBuilder: visual cron expression editor
- Open in IDE: VS Code, Cursor, Zed, IntelliJ, WebStorm

### What's Placeholder / Not Yet Functional
- Plan FSM, Hook Engine, Repo Maps — not started
- Tasks kanban (parse TODO.md → cards → worktree → agent pipeline) — planned
- Cmd+K search modal (spotlight-style) — planned
- Activity in sidebar (move from tab) — planned

## Tech Stack

Electron 41, React 18, TailwindCSS 4, Rust (napi-rs + memchr), libSQL, tRPC 11, xterm.js 6 (+ SerializeAddon), Monaco Editor, react-markdown, Zustand 5, Bun, Turborepo, Biome 2.4.7

## Monorepo Structure

```
exegol/
├── apps/desktop/                   # Electron app
│   ├── src/
│   │   ├── main/                   # Main process
│   │   │   ├── index.ts            # App entry: window, IPC, lifecycle, crash recovery
│   │   │   ├── agents/
│   │   │   │   ├── manager.ts      # AgentManager: spawn/stop/write/resize, Rust pipeline integration
│   │   │   │   ├── spawn-env.ts    # Shell PATH, constants, status broadcast, API keys, agent finalization
│   │   │   │   ├── spawn-context.ts # Memory/MCP/skill context injection, command assembly
│   │   │   │   ├── status-parser.ts # JS fallback: parses agent stdout for live status
│   │   │   │   ├── registry.ts     # AgentProviderRegistry: 9 built-in + custom providers
│   │   │   │   ├── handoff.ts      # Token limit detection, handoff summary generation
│   │   │   │   ├── scoring.ts      # 3-tier quality scoring engine
│   │   │   │   └── queue.ts        # Task queue executor (poll-based, concurrency limits)
│   │   │   ├── lib/
│   │   │   │   └── logger.ts       # Structured logger utility
│   │   │   ├── tokens/
│   │   │   │   └── log-parser.ts   # Claude Code JSONL log parser
│   │   │   ├── db/
│   │   │   │   ├── client.ts       # libSQL database init + WAL mode
│   │   │   │   ├── migrations.ts   # 23 migrations (projects → crashed status)
│   │   │   │   ├── queries.ts      # Barrel re-export of 12 domain query modules
│   │   │   │   └── queries/
│   │   │   │       ├── helpers.ts, projects.ts, agents.ts, worktrees.ts
│   │   │   │       ├── token-usage.ts, scheduler.ts, prompts.ts
│   │   │   │       ├── activities.ts, search.ts, messages.ts
│   │   │   │       ├── queue.ts, oplog.ts, scoring.ts, skills.ts
│   │   │   ├── ipc/
│   │   │   │   ├── router.ts       # tRPC appRouter (20 procedure modules)
│   │   │   │   ├── trpc.ts, trpc-ipc.ts, context.ts
│   │   │   │   └── procedures/     # 20 procedure files
│   │   │   ├── mcp/
│   │   │   │   ├── host.ts         # MCP client: stdio/HTTP, JSON-RPC 2.0, tool discovery
│   │   │   │   └── registry.ts     # MCP server config registry
│   │   │   ├── memory/
│   │   │   │   ├── extractor.ts    # Pattern extraction from scrollback (ANSI-stripped)
│   │   │   │   └── store.ts        # Memory CRUD, relevance scoring, context building
│   │   │   ├── skills/
│   │   │   │   ├── loader.ts       # SKILL.md parser with YAML frontmatter
│   │   │   │   ├── discovery.ts    # Dual-tier discovery (project + global)
│   │   │   │   └── defaults.ts     # 5 default skill personas
│   │   │   ├── security/
│   │   │   │   └── keystore.ts     # API key encryption via safeStorage
│   │   │   ├── scheduler/
│   │   │   │   └── engine.ts       # Cron jobs + dependency-aware dispatch
│   │   │   ├── system/
│   │   │   │   ├── resources.ts    # Background metrics collector (CPU/RAM/disk)
│   │   │   │   └── ports.ts        # Port detection (lsof + config parsing)
│   │   │   ├── ide/
│   │   │   │   └── opener.ts       # IDE launcher
│   │   │   └── terminal/
│   │   │       └── pty-manager.ts
│   │   ├── renderer/               # React UI
│   │   │   ├── App.tsx
│   │   │   ├── assets/icons/       # 19 SVG agent/IDE icons (dark/light variants)
│   │   │   ├── contexts/
│   │   │   │   └── ProjectContext.tsx  # Project + agents provider, push event subscription
│   │   │   ├── hooks/
│   │   │   │   ├── use-hotkeys.ts      # Keyboard shortcuts + agent cleanup on Cmd+W
│   │   │   │   ├── use-mount-effect.ts
│   │   │   │   ├── use-theme.ts        # useTheme + useThemeValue (resolved dark/light)
│   │   │   │   ├── use-trpc.ts         # Barrel re-export of domain hook files
│   │   │   │   ├── use-trpc-tokens.ts, use-trpc-resources.ts
│   │   │   │   ├── use-trpc-scheduler.ts, use-trpc-scoring.ts
│   │   │   │   ├── use-trpc-search.ts, use-trpc-mcp.ts
│   │   │   │   ├── use-trpc-memory.ts, use-trpc-skills.ts
│   │   │   ├── stores/
│   │   │   │   ├── app.ts          # Zustand: activeView, activeProjectId, sidebarCollapsed
│   │   │   │   ├── agents.ts       # Zustand: agent state, push events, shell auto-cleanup
│   │   │   │   ├── terminals.ts    # Zustand: terminal instances
│   │   │   │   └── workspace.ts    # Zustand: tabs, panes (5 types), layout tree, recovery
│   │   │   ├── lib/
│   │   │   │   ├── trpc-client.ts
│   │   │   │   └── markdown-tasks.ts
│   │   │   └── components/
│   │   │       ├── layout/         # Sidebar, SidebarSection, ProjectsSection, StatusBar, etc.
│   │   │       ├── agents/
│   │   │       │   └── AgentLauncher.tsx  # Portal dropdown with SVG icons, spawn/queue modes
│   │   │       ├── workspace/
│   │   │       │   ├── WorkspaceView.tsx      # 3 tabs: Agents (always mounted), Project, Monitor
│   │   │       │   ├── WorkspaceTabs.tsx      # Main tabs + sub-tabs (Project: 3, Monitor: 2)
│   │   │       │   ├── WorkspacePane.tsx      # 5 pane types + responsive EmptyPane + agent cleanup
│   │   │       │   ├── WorkspaceTabBar.tsx    # Tab bar + quick terminal button + agent cleanup
│   │   │       │   ├── WorkspaceLayout.tsx    # Recursive split layout (Panel id/order)
│   │   │       │   ├── GitPane.tsx            # Diff + Oplog toggle pane
│   │   │       │   ├── CodeViewer.tsx, FileExplorer.tsx
│   │   │       │   └── sections/
│   │   │       │       ├── AgentsSection.tsx, TasksSection.tsx
│   │   │       │       ├── PromptsSkillsSection.tsx   # Merged: Prompts + Skills toggle
│   │   │       │       ├── ResourcesTokensSection.tsx  # Merged: Resources + Tokens toggle
│   │   │       │       ├── MemorySection.tsx, ScoringSection.tsx
│   │   │       │       ├── DiffSection.tsx, OplogSection.tsx
│   │   │       │       ├── SearchSection.tsx, ActivitySection.tsx
│   │   │       │       ├── MessagesSection.tsx, QueueSection.tsx
│   │   │       │       ├── SchedulerSection.tsx
│   │   │       │       └── diff/ (parser, DiffFileView, DiffHunkView)
│   │   │       ├── terminal/
│   │   │       │   ├── TerminalPanel.tsx   # Live + read-only + crashed banner
│   │   │       │   └── TerminalInstance.tsx # xterm.js + WebGL + SerializeAddon
│   │   │       ├── common/
│   │   │       │   ├── AgentIcon.tsx       # SVG icons via import.meta.glob + theme-aware
│   │   │       │   ├── EmptyState, LoadingSpinner, StatusDot, ConfirmDialog
│   │   │       │   ├── KeyValue, CronBuilder
│   │   │       ├── settings/ and projects/
│   │   └── preload/
│   │       └── index.ts        # contextBridge: trpc, terminal, dialog, window, push events
├── packages/
│   ├── shared/                 # @exegol/shared — types + schemas
│   │   └── src/types/          # agent, project, prompt, settings, scheduler, token-usage,
│   │                           # worktree, activity, dashboard, search, scoring, mcp, memory, skill
│   ├── ui/                     # @exegol/ui (Radix primitives + cn utility)
│   └── core-rust/              # Rust native module (napi-rs)
│       ├── Cargo.toml          # git2, napi, serde, memchr
│       └── src/
│           ├── lib.rs          # Module registration + health check
│           ├── git/            # Git ops: worktree, diff, oplog, repo info
│           │   ├── mod.rs, types.rs, diff.rs, oplog.rs
│           └── processing/     # PTY output processing pipeline
│               ├── mod.rs
│               ├── strip_ansi.rs    # ANSI escape stripper (50-100x faster than JS)
│               └── status_parser.rs # AgentOutputStream: streaming status parse per CLI type
├── docs/
│   ├── project_definition/
│   ├── tasks_completed/
│   ├── review_notes/
│   ├── applied/                # Per-task documentation (T17-T34)
│   ├── agent_prompts/          # Reusable quality_review + pre_pr_validation prompts
│   ├── UI_RESTRUCTURE.md       # Agreed UI restructure plan (6 phases)
│   ├── TASK_TODO.md            # V1 task board (16 tasks completed)
│   └── TASK_TODO_V2.md         # V2 task board (19 tasks, 5 agent clusters)
├── turbo.json
├── biome.json                  # Biome 2.4.7
└── package.json                # Bun workspace root
```

## Development

```bash
bun install                         # Install all dependencies
bun run dev                         # Build Rust + start Electron (full pipeline)
bun run dev:ui                      # Start Electron only (JS fallback, faster)
bun run build                       # Production build
bun run build:rust                  # Build Rust native module only
bun run rebuild:native              # Build Rust + rebuild node-pty for Electron

# Lint (Biome):
npx @biomejs/biome check apps/ packages/shared/src/ packages/ui/src/

# Type check:
bun run typecheck                   # Runs typecheck:node + typecheck:web

# Rust:
cd packages/core-rust
cargo check                         # Type-check
cargo test                          # Run 12 tests (strip_ansi + status_parser)
cargo clippy                        # Lint
```

## Architecture Notes

- **Rust processing pipeline**: PTY output processed by Rust `AgentOutputStream` (napi-rs). Strip ANSI (zero-copy fast path via memchr) + status parsing (state machine per CLI type) + token limit detection. Falls back to JS `AgentStatusParser` if native module not compiled. `bun run dev` auto-builds Rust.
- **tRPC over IPC**: 20 tRPC routers in main process. Renderer calls via `window.api.trpc.invoke(path, input)`.
- **libSQL**: v0.5.x with WAL mode. 23 migrations. Database at `~/.exegol/data/exegol.db`.
- **Agent spawn flow**: AgentManager resolves provider from registry → builds context (memory + MCP + skills) → spawns PTY (`$SHELL -ilc "command"`) → output piped through Rust processor → status broadcast via IPC push events. Plain shells (`cliType: "shell"`) skip all processing.
- **Push-first updates**: `broadcastAgentStatus()` sends IPC events on every status change. Renderer subscribes via `startAgentStatusPush()` in agents store. Polling reduced to 30s fallback.
- **Crash recovery**: On startup, `recoverStaleAgents()` checks PID alive via `kill(pid, 0)`. Dead agents marked "crashed" with scrollback preserved. UI shows red banner + re-launch button.
- **Agent cleanup**: Close pane (X) / close tab (X) / Cmd+W all stop agent + delete from DB + remove from Zustand store. Shells auto-remove on exit (push event handler detects `cliType: "shell"` + final status → remove + convert pane to empty).
- **Workspace tabs**: 3 main tabs (Agents, Project, Monitor). Agents tab always mounted (CSS hidden, preserves xterm.js state). Project has sub-tabs: Tasks, Prompts & Skills, Memory. Monitor has sub-tabs: Resources & Tokens, Scoring.
- **Pane types**: terminal, browser, files, git, empty. Git pane = Diff + Oplog toggle. Empty pane = responsive agent grid (3 breakpoints) + Terminal/Browser/Files/Git buttons.
- **SVG icons**: 19 icons loaded via `import.meta.glob('*.svg', { query: '?url' })`. `AgentIcon` component resolves provider → SVG with dark/light variant. CSP allows `img-src data:`.
- **Skills**: Markdown with YAML frontmatter (name, description, role, requires, allowed-tools). Discovery: `~/.exegol/skills/` (global) + `.exegol/skills/` (project). 5 defaults: architect, qa, debugger, reviewer, documenter.
- **Memory**: Auto-extracted from scrollback on agent completion (ANSI-stripped). Categories: error, solution, dependency, convention, preference, pattern. Jaccard deduplication (0.8 threshold). Token-budget injection on spawn. Exportable to `.exegol/MEMORY.md`.
- **Database migrations**: 23 sequential (012→022 from V2 tasks + 023 crashed status). Tracked in `_migrations` table.

## Database Tables

projects, agents, worktrees, sessions, activities, search_index (FTS5), handoffs, messages, scheduled_tasks, scheduled_results, task_queue, token_usage, port_registry, host_metrics, settings, prompts, skills_state, memories, agent_scores, oplog

Agent status values: `idle | spawning | running | waiting_input | paused | completed | failed | stopped | crashed`

## React Coding Standards

### useEffect Rules (from React team)
1. **Derive state, don't sync** — If effect just sets state from other state, compute inline
2. **Use TanStack Query** — Never fetch in useEffect
3. **Event handlers first** — User actions belong in handlers, not effects
4. **useMountEffect** — For external system sync (DOM, third-party, browser APIs)
5. **Key reset** — Use `key` prop to reset components, not effect dependency arrays
