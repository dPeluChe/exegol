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
- **Project**: Tasks | Prompts & Skills | Memory | Pipelines
- **Monitor**: Resources & Tokens | Scoring

### Pane types
- `terminal` — agent CLI or plain `$SHELL`
- `browser` — Electron webview with URL bar + back/forward/reload
- `files` — FileExplorer + Monaco code viewer
- `git` — Changes (with Smart Git Button) + Diff + Oplog (agent operations with undo)
- `empty` — responsive agent launcher grid (3 breakpoints)

### Layouts (T85, v0.3.0)
- **6 built-in presets**: Single, Split Horizontal, Split Vertical, Three Columns, Bottom Terminal (70/30 with auto-spawned shell), 2×2 Grid
- **Custom saved layouts**: capture the current tab as a reusable template with per-slot type + url + filePath, persisted in the workspace store
- **Equalize splits** action via pane context menu
- **Pure-function helpers** in `lib/layout-presets.ts` (`computePresetTransformation`, `templateFromLayout`) so the store just applies the result

### Picture-in-Picture (T84, v0.3.0)
- Any terminal or browser pane can detach into a frameless always-on-top BrowserWindow
- Main process manages `floatingWindows: Map<paneId, BrowserWindow>` in `main/windows/floating.ts`
- Renderer routes on `?floatingPane=...` query: main window mounts `<App/>`, floating windows lazy-load `<FloatingPaneRoot/>`
- Terminal float shares the PTY via ring buffer + snapshot replay — only one xterm instance attached at a time (original pane shows a "Floating" placeholder)
- Browser float has its own back/forward/reload + DevTools toggle (drops alwaysOnTop while DevTools is open so the detached window is visible)
- IPC round-trip: `floating:open`, `floating:close`, `floating:self-close`, `floating:self-devtools`, `floating:closed` (notification back to main window)

### Smart Git Button (T83, v0.3.0)
Context-aware git action button in GitPane with 11 states:
- conflicts → Resolve (disabled, hint)
- dirty + no message → Commit N files (disabled, hint to write message)
- dirty + message → Commit N files
- clean + ahead → Push N
- clean + no upstream → Push New Branch
- clean + no PR + gh installed → Create PR
- clean + PR open + mergeable → Merge PR (success color)
- clean + PR not mergeable → View PR on GitHub (warn)
- clean + PR merged/closed → terminal state (muted)
- clean + no PR + no gh → Install gh CLI (opens cli.github.com)
Commit input has a Sparkles button that generates a conventional-commit
message from the current diff via Claude Haiku (reuses Anthropic API key).

### PTY Sidecar Architecture
- **Sidecar process**: standalone detached Node.js process (`pty-sidecar-entry.ts`), survives window reload/crash
- **JSON-RPC over Unix socket**: `~/.exegol/pty-sidecar.sock` for control, NDJSON framing
- **Ring buffer**: 8MB circular buffer per session, stores raw ANSI output for instant reconnect
- **Discovery**: PID file at `~/.exegol/pty-sidecar.pid`, reuse existing or spawn new
- **Fallback**: if sidecar fails, falls back to legacy per-session subprocess mode transparently
- **Reconnection**: on app restart, `reattachSidecarAgents()` rebuilds callbacks + replays ring buffer snapshot

### Agent lifecycle
1. User clicks agent in launcher/grid/quick-bar (all read from provider registry)
2. `AgentManager.spawn()` → resolves provider → builds context (memory + MCP + skills) → spawns PTY via sidecar
3. PTY output → sidecar ring buffer → JSON-RPC notification → main process → Rust `AgentOutputStream` (ANSI strip + status parse) or JS fallback
4. Status broadcast via IPC push events → Zustand store → UI
5. On exit: memory extraction → scoring → oplog → worktree cleanup (all non-fatal, try/catch)
6. Close pane/tab/Cmd+W → stop agent + delete from DB + remove from store
7. Window reload → sidecar keeps PTY alive → app reconnects on restart

### Multi-agent pipelines
Sequential agent orchestration in shared worktrees. Exegol controls everything — agents never launch each other.
1. User creates pipeline template (steps: provider + role + prompt template)
2. `PipelineExecutor.startRun()` → creates shared worktree → `advanceStep(0)`
3. Each step: build prompt ({{task}}, {{diff}}, {{previousOutput}}) → spawn agent with `cwdOverride`
4. `onAgentComplete` callback → capture git diff + scrollback → evaluate: advance / loop-back / pause
5. Loop mechanism: review→fix cycle with `loopBackTo` + max iterations guard
6. On complete/cancel: cleanup worktree if clean, preserve if dirty
7. Crash recovery: `recoverStalePipelineRuns()` marks running pipelines as paused on startup
8. **State machine** (T78): `state-machine.ts` defines `PIPELINE_TRANSITIONS` map, `canTransition()`, `assertTransition()` — guards in executor reject invalid transitions with warning log

### Provider registry
11 built-in providers (Claude Code, Codex, Gemini, Aider, Goose, OpenCode, Amp, Kiro, KiloCode, Crush, Shell) + custom. Each has: `supportsPromptArg`, `promptFlag`, `enabled`. Interactive CLIs (Gemini, OpenCode, Kiro) launch without prompt injection.

### Key patterns
- **tRPC over IPC**: 21 routers in main process, renderer calls via `window.api.trpc.invoke`
- **Push-first**: `broadcastAgentStatus()` IPC events, polling reduced to 30s fallback
- **Crash recovery**: `session.listInfo` RPC returns `{ id, alive, exitCode, signal }` — only ALIVE ids go to `reattachSidecarAgents()`, dead ones (in the sidecar's 60s grace period) fall through to `recoverStaleAgents()` and get marked as "crashed" with scrollback preserved (v0.3.0 fix: previously dead sessions were stuck as "running" with no PTY)
- **Shell skip**: shells bypass scoring, memory extraction, scrollback buffering, status parsing
- **Auto-save**: Settings tabs save independently (General/Terminal auto-save on change, CLIs save per field)
- **Startup instrumentation**: `[Startup] dbInit`, `criticalPath`, `windowCreated`, `firstPaint` log lines (single-log guarded); `[Reattach]` + `[Recovery]` per-agent decisions for diagnosing recovery issues
- **Bundle splits**: workspace sections, xterm+addons, SettingsPanel, ProjectList, CommandPalette, FloatingPaneRoot are all lazy chunks — initial `index.js` ~1,026 KB
- **Bundled Nerd Fonts**: 3 fonts (MesloLGS NF, FiraCode NF Mono, JetBrainsMono NF Mono) shipped inside the renderer assets, loaded via `@font-face` in `styles/fonts.css`, lazy-fetched from disk only when referenced

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
    db/             client, migrations (24), queries/ (13 domain modules)
    ipc/            router, procedures/ (21 modules)
    pipeline/       executor (singleton, event-driven), context (prompt builder), defaults (presets), state-machine (T78 transition guards)
    mcp/            host (stdio/HTTP), registry
    memory/         extractor (ANSI-stripped), store (relevance scoring)
    skills/         loader, discovery, defaults (5 personas)
    scheduler/      engine (cron + dependency-aware)
    security/       keystore (safeStorage)
    system/         resources (metrics collector), ports (lsof + config)
    ide/            opener (vscode, cursor, zed, windsurf, custom)
    windows/        floating (T84 PiP BrowserWindows), app-menu (macOS custom menu)
  renderer/
    components/
      workspace/    WorkspaceView, WorkspaceTabs (3 main + sub-tabs), WorkspacePane (5 types),
                    WorkspaceTabBar (quick launch + LayoutPresets dropdown), WorkspaceLayout,
                    GitPane (with SmartGitAction), LayoutPresets, SmartGitAction,
                    PaneContextMenu, sections/ (16 section components + pipeline/), diff/
      settings/     SettingsPanel, GeneralSettings (Kbd components), CliSettings (cards grid,
                    YOLO/Active toggles), TerminalSettings (bundled fonts, per-card preview,
                    family chain badges, promote-on-click), ApiKeysSettings
      terminal/     TerminalPanel (live/read-only/crashed, snapshot probe on reattach),
                    TerminalInstance (xterm.js + WebGL + Serialize)
      common/       AgentIcon (glob *.{svg,png}, dark/light), EmptyState, StatusDot, CronBuilder
      agents/       AgentLauncher (portal dropdown from registry)
      layout/       Sidebar, ProjectsSection, StatusBar, TitleBar
    FloatingPaneRoot.tsx  (T84 — top-level renderer for floating PiP windows)
    hooks/          use-hotkeys, use-theme, use-trpc, use-auto-select-project,
                    use-floating-pane-sync (unmark panes when floating window closes)
    stores/         app, agents (push events, shell auto-cleanup), terminals,
                    workspace (5 pane types, recovery, custom layouts, floatingPanes)
    lib/            layout-presets (pure transformation helpers), trpc-client,
                    dispatch-refit, semantic-colors
    assets/
      fonts/        MesloLGS NF, FiraCode NF Mono, JetBrainsMono NF Mono (~6.8 MB, bundled)
      icons/        26 SVG/PNG icons (agents, IDEs, providers)
    styles/         globals.css, fonts.css (@font-face for bundled fonts)
  preload/          contextBridge: trpc, terminal, dialog, push events, floating, menu
packages/
  shared/           types (20+), schemas (zod: agent, db-rows, mcp, pipeline, project, scheduler, settings, token-usage)
  ui/               Radix primitives, cn()
  core-rust/        napi-rs: git2 + processing pipeline
docs/
  TASK_TODO.md (V1-V3 done + v0.3.0 wave), BENCHMARKS.md, CHANGELOG.md,
  RELEASE.md, UI_RESTRUCTURE.md, agent_prompts/, applied/, tasks_completed/
```

## Database

24 migrations · 22 tables: projects, agents, worktrees, activities, search_index (FTS5), handoffs, messages, scheduled_tasks/results, task_queue, token_usage, settings, prompts, skills_state, memories, agent_scores, oplog, pipeline_templates, pipeline_runs

Agent status: `idle | spawning | running | waiting_input | paused | completed | failed | stopped | crashed`

## React Rules

1. Derive state, don't sync — compute inline or useMemo
2. Use TanStack Query — never fetch in useEffect
3. Event handlers first — user actions in handlers, not effects
4. useMountEffect — for external system sync (DOM, xterm, IPC)
5. Key reset — prefer `key` prop over dependency arrays
