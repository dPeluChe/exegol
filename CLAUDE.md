# Exegol

Electron + React + Rust desktop app for orchestrating AI coding agents.

## Tech Stack

Electron 41 · React 18 · TailwindCSS 4 · Rust (napi-rs + memchr) · libSQL · tRPC 11 · xterm.js 6 · Monaco Editor · Zustand 5 · Bun · Turborepo · Biome 2.4.7

## Development

```bash
bun run dev              # Build Rust + start Electron (full pipeline)
bun run dev:ui           # Electron only (JS fallback, faster)
bun run build:rust       # Build Rust native module only
bun run rebuild:native   # Rust + rebuild node-pty for Electron

# Lint + typecheck:
npx @biomejs/biome check apps/ packages/shared/src/ packages/ui/src/
bun run typecheck

# Rust:
cd packages/core-rust && cargo check && cargo test && cargo clippy
```

## Architecture

### Workspace (3 tabs + sub-tabs)
- **Agents**: multi-pane workspace (terminal, browser, files, git, empty)
- **Project**: Tasks | Prompts & Skills | Memory
- **Monitor**: Resources & Tokens | Scoring

### Pane types
- `terminal` — agent CLI or plain `$SHELL`
- `browser` — Electron webview with URL bar
- `files` — FileExplorer + Monaco code viewer
- `git` — Diff (changes) + Oplog (agent operations with undo)
- `empty` — responsive agent launcher grid (3 breakpoints)

### Agent lifecycle
1. User clicks agent in launcher/grid/quick-bar (all read from provider registry)
2. `AgentManager.spawn()` → resolves provider → builds context (memory + MCP + skills) → spawns PTY
3. PTY output → Rust `AgentOutputStream` (ANSI strip + status parse, 50-100x faster) or JS fallback
4. Status broadcast via IPC push events → Zustand store → UI
5. On exit: memory extraction → scoring → oplog → worktree cleanup (all non-fatal, try/catch)
6. Close pane/tab/Cmd+W → stop agent + delete from DB + remove from store

### Provider registry
11 built-in providers (Claude Code, Codex, Gemini, Aider, Goose, OpenCode, Amp, Kiro, KiloCode, Crush, Shell) + custom. Each has: `supportsPromptArg`, `promptFlag`, `enabled`. Interactive CLIs (Gemini, OpenCode, Kiro) launch without prompt injection.

### Key patterns
- **tRPC over IPC**: 20 routers in main process, renderer calls via `window.api.trpc.invoke`
- **Push-first**: `broadcastAgentStatus()` IPC events, polling reduced to 30s fallback
- **Crash recovery**: `recoverStaleAgents()` on startup — PID check, mark "crashed", scrollback preserved
- **Shell skip**: shells bypass scoring, memory extraction, scrollback buffering, status parsing
- **Auto-save**: Settings tabs save independently (General/Terminal auto-save on change, CLIs save per field)

### Rust native module (`packages/core-rust`)
- `processing/strip_ansi.rs` — ANSI stripper with memchr fast path
- `processing/status_parser.rs` — `AgentOutputStream` class, zero-alloc case-insensitive matching
- `git/` — worktree, diff, oplog, repo info via git2
- 12 tests, Clippy pedantic clean

## Monorepo Structure

```
apps/desktop/src/
  main/
    agents/         manager, spawn-env, spawn-context, registry, handoff, scoring, queue, status-parser
    db/             client, migrations (23), queries/ (12 domain modules)
    ipc/            router, procedures/ (20 modules)
    mcp/            host (stdio/HTTP), registry
    memory/         extractor (ANSI-stripped), store (relevance scoring)
    skills/         loader, discovery, defaults (5 personas)
    scheduler/      engine (cron + dependency-aware)
    security/       keystore (safeStorage)
    system/         resources (metrics collector), ports (lsof + config)
    ide/            opener (vscode, cursor, zed, windsurf, custom)
  renderer/
    components/
      workspace/    WorkspaceView, WorkspaceTabs (3 main + sub-tabs), WorkspacePane (5 types),
                    WorkspaceTabBar (quick launch from registry), WorkspaceLayout, GitPane,
                    sections/ (15 section components), diff/
      settings/     SettingsPanel, GeneralSettings (Kbd components), CliSettings (cards grid,
                    YOLO/Active toggles), TerminalSettings (font detection), ApiKeysSettings
      terminal/     TerminalPanel (live/read-only/crashed), TerminalInstance (xterm.js + WebGL + Serialize)
      common/       AgentIcon (glob *.{svg,png}, dark/light), EmptyState, StatusDot, CronBuilder
      agents/       AgentLauncher (portal dropdown from registry)
      layout/       Sidebar, ProjectsSection, StatusBar, TitleBar
    hooks/          use-hotkeys, use-theme (useThemeValue), use-trpc (barrel + 8 domain files)
    stores/         app, agents (push events, shell auto-cleanup), terminals, workspace (5 pane types, recovery)
    assets/icons/   26 SVG/PNG icons (agents, IDEs, providers)
  preload/          contextBridge: trpc, terminal, dialog, push events
packages/
  shared/           types (20+), schemas (zod)
  ui/               Radix primitives, cn()
  core-rust/        napi-rs: git2 + processing pipeline
docs/
  UI_RESTRUCTURE.md, TASK_TODO.md (V1 done), TASK_TODO_V2.md (V2), agent_prompts/, applied/
```

## Database

23 migrations · 20 tables: projects, agents, worktrees, activities, search_index (FTS5), handoffs, messages, scheduled_tasks/results, task_queue, token_usage, settings, prompts, skills_state, memories, agent_scores, oplog

Agent status: `idle | spawning | running | waiting_input | paused | completed | failed | stopped | crashed`

## React Rules

1. Derive state, don't sync — compute inline or useMemo
2. Use TanStack Query — never fetch in useEffect
3. Event handlers first — user actions in handlers, not effects
4. useMountEffect — for external system sync (DOM, xterm, IPC)
5. Key reset — prefer `key` prop over dependency arrays
