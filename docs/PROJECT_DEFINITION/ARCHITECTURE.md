# System Architecture

## High-Level Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                        Electron Main Process                        │
│                                                                     │
│  ┌──────────────┐  ┌────────────────────┐  ┌────────────────────┐  │
│  │ AgentManager │  │  PipelineExecutor  │  │   SchedulerEngine  │  │
│  │ (sidecar +   │  │  (singleton, event │  │   (croner, dep-    │  │
│  │  PTY/JSON-RPC│  │   driven, FSM)     │  │    aware)          │  │
│  └──────┬───────┘  └────────┬───────────┘  └────────┬───────────┘  │
│         │                   │                        │              │
│  ┌──────┴───────────────────┴────────────────────────┴──────────┐   │
│  │                  tRPC Router (21 sub-routers)                 │   │
│  │  projects|agents|settings|apiKeys|tokenUsage|resources|       │   │
│  │  scheduler|files|prompts|diff|scrollback|pipeline|mcp|        │   │
│  │  memory|skills|worktrees|oplog|qa|search|parallel             │   │
│  └──────┬─────────────────────────────────────────────┬──────────┘   │
│         │                                             │              │
│  ┌──────┴──────┐  ┌───────────────┐  ┌──────────────┴──────────┐   │
│  │   libSQL    │  │  PTY Sidecar  │  │  Rust Native (napi-rs)  │   │
│  │ (29 tables, │  │  (Unix socket,│  │  git2 + memchr:         │   │
│  │  35 migr.)  │  │   ring buffer)│  │  strip_ansi, status_    │   │
│  └─────────────┘  └───────────────┘  │  parser, worktree, diff │   │
│                                       └─────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Supporting modules: MCP host · memory · skills · lifecycle  │   │
│  │  keystore · system/resources · ide/opener · windows/floating │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────┬──────────────────────────────────────┘
                              │ IPC (tRPC via ipcMain.handle + push events)
┌─────────────────────────────┴──────────────────────────────────────┐
│                        Electron Renderer                            │
│                                                                     │
│  React 18 · Zustand 5 · TailwindCSS 4 · TanStack Query             │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  WorkspaceView (3 main tabs: Agents | Project | Monitor)      │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  WorkspaceLayout (recursive split-pane tree)            │  │  │
│  │  │  Pane types: terminal · browser · files · git · empty   │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │  WorkspaceTabBar: layout presets · custom layouts · PiP        │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Stores: app · agents · terminals · workspace                       │
│  Hooks: use-hotkeys · use-theme · use-trpc · use-floating-pane-sync │
│  Preload: contextBridge (trpc · terminal · dialog · push · floating)│
└────────────────────────────────────────────────────────────────────┘

Floating windows (PiP):
  BrowserWindow (frameless, always-on-top) per detached terminal/browser pane
  Renderer routes on ?floatingPane=<id> → <FloatingPaneRoot/>
```

---

## Main Process Modules

### `agents/`
- `manager.ts` — AgentManager singleton: spawn, stop, write, resize, onAgentComplete callbacks
- `spawn-env.ts` — shell PATH resolution, environment construction, `EXEGOL_ACCESS_MODE`
- `spawn-context.ts` — assembles memory + MCP + skills context before spawn
- `registry.ts` — 11 built-in providers + custom; `supportsPromptArg`, `promptFlag`, `enabled`
- `handoff.ts` — agent-to-agent context transfer
- `scoring.ts` — post-exit quality scoring (files changed, compile, tests, task complete)
- `queue.ts` — task queue execution
- `status-parser.ts` — JS fallback ANSI status parser (used when Rust module unavailable)

### `db/`
- `client.ts` — libSQL init, WAL mode
- `migrations.ts` — 35 migrations (001–035)
- `queries/` — 18 domain modules (projects, agents, worktrees, token-usage, scheduler, prompts, memories, skills-state, oplog, pipeline, qa, parallel-runs, …)

### `ipc/`
- `router.ts` — appRouter (21 sub-routers)
- `trpc-ipc.ts` — `ipcMain.handle('trpc', ...)` using `appRouter.createCaller(ctx)` with dot-path traversal
- `procedures/` — 21 modules, one per router namespace

### `pipeline/`
- `executor.ts` — singleton; `startRun()` → `advanceStep()` → `onAgentComplete` callback loop
- `context.ts` — prompt builder (`{{task}}`, `{{diff}}`, `{{previousOutput}}` interpolation)
- `defaults.ts` — built-in pipeline presets
- `state-machine.ts` — `PIPELINE_TRANSITIONS` map; `canTransition()` / `assertTransition()` guards

### `mcp/`
- `host.ts` — MCP host supporting stdio subprocess and HTTP transports; connects on project open
- `registry.ts` — aggregates tools/resources/prompts across connected servers

### `memory/`
- `extractor.ts` — post-agent ANSI-stripped scrollback → structured memory items
- `store.ts` — relevance scoring, category-aware retrieval

### `lifecycle/`
- `loader.ts` — parses `.exegol/lifecycle.yaml` (or `.yml`) per repo; runs `setup`, `beforeAgent`, `afterCommit`, `teardown` hooks; setup is once-per-session

### `lib/`
- `logger.ts` — structured logger with startup instrumentation (`[Startup]`, `[Reattach]`, `[Recovery]`)
- `errors.ts` — `ExegolError` → `TransientError` / `PermanentError` / `TimeoutError` hierarchy; `withRetry()` (exponential backoff, transient-only, max 3)

### `skills/`
- `loader.ts` — discovers SKILL.md files; parses YAML frontmatter (name, description, allowed-tools)
- `discovery.ts` — matches agent requests against skill descriptions
- `defaults/` — 5 built-in persona skills

### `scheduler/`
- `engine.ts` — SchedulerEngine singleton; croner-based; dependency-aware execution; event-based completion via `AgentManager.onAgentComplete()`

### `security/`
- `keystore.ts` — Electron `safeStorage` encryption for API keys

### `system/`
- `resources.ts` — background metrics collector (10s interval): CPU (delta-based), memory (`vm_stat` on macOS), disk (`df -k`), per-project `du` + `git worktree list`
- `ports.ts` — lsof + config-parsed port detection

### `ide/`
- `opener.ts` — opens project in VS Code, Cursor, Zed, Windsurf, or custom IDE

### `windows/`
- `floating.ts` — manages `floatingWindows: Map<paneId, BrowserWindow>` for PiP detached panes
- `app-menu.ts` — macOS custom application menu

---

## PTY Sidecar Architecture

The sidecar is a standalone detached Node.js process that owns all PTY sessions. It survives window reload and app crash.

```
Main process                      PTY Sidecar (~/.exegol/pty-sidecar.sock)
     │                                        │
     │── JSON-RPC: session.spawn ────────────▶│── node-pty.spawn()
     │── JSON-RPC: session.write ────────────▶│── pty.write()
     │◀─ JSON-RPC notification: data ─────────│── ring buffer (8MB/session)
     │── JSON-RPC: session.listInfo ─────────▶│── { id, alive, exitCode }
     │                                        │
     │  On app restart:                       │
     │── listInfo → filter alive IDs          │
     │── reattachSidecarAgents() → replay     │── snapshot from ring buffer
     │   dead IDs → recoverStaleAgents()      │   (60s grace window)
```

- Discovery: PID file at `~/.exegol/pty-sidecar.pid`; reuse or spawn new
- Fallback: if sidecar fails, falls back to legacy per-session subprocess mode
- Terminal PiP: only one xterm instance attached per session at a time; original pane shows "Floating" placeholder during float

---

## Agent Lifecycle

```
1. User clicks agent in launcher / empty pane grid / quick-bar
2. AgentManager.spawn()
   ├── resolves provider from registry
   ├── builds context: memory relevance query + MCP tool list + active skills
   ├── runs lifecycle beforeAgent hook (prepended to shell command)
   ├── sets EXEGOL_ACCESS_MODE env var (read | write | plan)
   └── spawns PTY via sidecar JSON-RPC
3. PTY output → sidecar ring buffer
              → JSON-RPC notification → main process
              → Rust AgentOutputStream (ANSI strip + status parse)
                 or JS fallback status-parser
4. Status broadcast: broadcastAgentStatus() IPC push → Zustand agents store → UI
   classifyActivity() → activityLevel (busy | idle | neutral) → tab dot pulse
5. On exit (non-shell agents):
   ├── memory extraction from scrollback
   ├── quality scoring → agent_scores table
   ├── oplog entry
   └── worktree cleanup (if clean)
6. Close pane / Cmd+W → stop agent + delete from DB + remove from store
7. Window reload → sidecar keeps PTY alive → reattach on next start
```

Shells skip: scoring, memory extraction, scrollback buffering, status parsing.

---

## Multi-Agent Pipelines

Sequential agent orchestration in shared git worktrees. Exegol controls sequencing; agents do not launch each other.

```
Pipeline state machine (state-machine.ts):
  pending → running → paused ⇄ running → completed
                    ↘ failed / cancelled

PipelineExecutor.startRun()
  ├── creates shared worktree under ~/.exegol/pipelines/<run-id>
  └── advanceStep(0)
        ├── build prompt: {{task}}, {{diff}}, {{previousOutput}}
        ├── spawn agent with cwdOverride + per-step accessMode
        └── onAgentComplete:
              ├── capture git diff + scrollback
              ├── evaluate result → advance / loopBack / pause
              └── loop guard: loopBackTo + maxIterations
  On complete/cancel: cleanup worktree if clean, preserve if dirty
  On startup: recoverStalePipelineRuns() marks running → paused
```

---

## Provider Registry

11 built-in providers: Claude Code, Codex, Gemini, Aider, Goose, OpenCode, Amp, Kiro, KiloCode, Crush, Shell. Each entry carries `supportsPromptArg`, `promptFlag`, `enabled`.

Interactive CLIs (Gemini, OpenCode, Kiro) launch without prompt injection. Shell provider bypasses agent post-processing.

---

## Access Modes (T58)

Agents spawn with `accessMode: read | write | plan`. `buildShellCommand` prepends a system instruction scoped to the mode. `EXEGOL_ACCESS_MODE` env var is set for the agent process. Pipeline steps carry per-step `accessMode`. Non-write modes show a badge in the terminal toolbar.

---

## Renderer Structure

### Workspace UI
- `WorkspaceView` — root; 3 main tabs (Agents, Project, Monitor) + sub-tabs
- `WorkspaceTabs` / `WorkspaceTabBar` — tab chrome with quick-launch, layout presets dropdown, PiP controls
- `WorkspaceLayout` — recursive split-pane tree
- `WorkspacePane` — dispatches to 5 pane types: terminal, browser, files, git, empty
- `GitPane` — Changes list + Diff viewer + Oplog; hosts SmartGitAction
- `SmartGitAction` — 11-state context-aware git button; Sparkles generates conventional-commit message via Claude Haiku
- `LayoutPresets` — 6 built-in presets + custom saved layouts; `computePresetTransformation` / `templateFromLayout` pure helpers in `lib/layout-presets.ts`
- `PaneContextMenu` — equalize splits + detach to PiP
- `sections/` — 16 section components covering Tasks, Prompts & Skills, Memory, Pipelines, Diff, Tokens, Resources, Scoring, QA, etc.

### Terminal
- `TerminalPanel` — live / read-only / crashed states; snapshot probe on reattach
- `TerminalInstance` — xterm.js 6 + WebGL renderer + Serialize addon

### Settings
- `SettingsPanel` — 5 tabs: General, CLIs (cards grid, YOLO/Active toggles), Terminal (bundled fonts, per-card preview, family chain badges), API Keys, Shortcuts
- General and Terminal auto-save on change; CLI cards save per field

### Stores (Zustand 5, all persisted)
- `app` — activeView, activeProjectId, sidebar state
- `agents` — agent state map, push event handler, shell auto-cleanup
- `terminals` — xterm instances
- `workspace` — tab/pane tree, custom layouts, floatingPanes set, recovery state

### Hooks
- `use-hotkeys` — global keyboard shortcuts (Cmd+B, Cmd+,, Cmd+T, Cmd+W, Cmd+D, Cmd+Shift+D, Cmd+], Cmd+[, Cmd+1–9, …)
- `use-theme` — `data-theme` on `<html>`, respects system preference
- `use-trpc` — TanStack Query wrappers over `window.api.trpc.invoke`
- `use-floating-pane-sync` — unmarks floating panes when PiP window closes

### FloatingPaneRoot
Top-level renderer entry point for PiP windows. Loaded lazily via `?floatingPane=<id>` query param.

---

## Key Patterns

- **tRPC over IPC**: renderer calls `window.api.trpc.invoke(path, input)` → `ipcMain.handle('trpc', ...)` → `appRouter.createCaller(ctx)` with dot-path traversal
- **Push-first**: `broadcastAgentStatus()` IPC push events on every status change; 30s polling fallback only
- **Structured errors**: `ExegolError` hierarchy with `cause` chain; `withRetry()` retries transient errors with exponential backoff (1s base, max 3 attempts)
- **Lifecycle scripts**: `.exegol/lifecycle.yaml` per repo; `setup` runs once per session on first agent spawn; `beforeAgent` prepended to shell command; `teardown` awaited before worktree deletion; line-based parser (no YAML lib)
- **Crash recovery**: `session.listInfo` RPC → alive IDs → `reattachSidecarAgents()`; dead IDs → `recoverStaleAgents()` → marked `crashed` with scrollback preserved
- **Shell skip**: shell agents bypass scoring, memory extraction, scrollback buffering, status parsing
- **Bundle splits**: workspace sections, xterm+addons, SettingsPanel, ProjectList, CommandPalette, FloatingPaneRoot are lazy chunks; initial `index.js` ~1,026 KB
- **Bundled Nerd Fonts**: MesloLGS NF, FiraCode NF Mono, JetBrainsMono NF Mono (~6.8 MB) loaded via `@font-face` in `styles/fonts.css`

---

## Monorepo Structure

```
apps/desktop/src/
  main/
    agents/         manager, spawn-env, spawn-context, registry, handoff, scoring, queue, status-parser
    db/             client, migrations (35), queries/ (18 domain modules)
    ipc/            router, procedures/ (21 modules)
    pipeline/       executor, context, defaults, state-machine
    mcp/            host (stdio/HTTP), registry
    memory/         extractor, store
    lifecycle/      loader (.exegol/lifecycle.yaml parser + runner)
    lib/            logger, errors (ExegolError hierarchy + withRetry)
    skills/         loader, discovery, defaults (5 personas)
    scheduler/      engine (croner + dependency-aware)
    security/       keystore (safeStorage)
    system/         resources (metrics), ports (lsof + config)
    ide/            opener (vscode, cursor, zed, windsurf, custom)
    windows/        floating (PiP BrowserWindows), app-menu
  renderer/
    components/
      workspace/    WorkspaceView, WorkspaceTabs, WorkspacePane (5 types),
                    WorkspaceTabBar, WorkspaceLayout, GitPane, LayoutPresets,
                    SmartGitAction, PaneContextMenu, sections/ (16 + pipeline/), diff/
      settings/     SettingsPanel, GeneralSettings, CliSettings, TerminalSettings, ApiKeysSettings
      terminal/     TerminalPanel, TerminalInstance (xterm.js + WebGL + Serialize)
      common/       AgentIcon, EmptyState, StatusDot, CronBuilder
      agents/       AgentLauncher (portal dropdown from registry)
      layout/       Sidebar, ProjectsSection, StatusBar, TitleBar
    FloatingPaneRoot.tsx
    hooks/          use-hotkeys, use-theme, use-trpc, use-auto-select-project,
                    use-floating-pane-sync
    stores/         app, agents, terminals, workspace
    lib/            layout-presets, trpc-client, dispatch-refit, semantic-colors
    assets/
      fonts/        MesloLGS NF, FiraCode NF Mono, JetBrainsMono NF Mono
      icons/        26 SVG/PNG icons
    styles/         globals.css, fonts.css
  preload/          contextBridge: trpc, terminal, dialog, push events, floating, menu
packages/
  shared/           types (20+), schemas (zod: agent, db-rows, mcp, pipeline,
                    project, scheduler, settings, token-usage)
  ui/               Radix primitives, cn()
  core-rust/        napi-rs: git2 + processing pipeline
docs/
  README.md, TASK_TODO.md, CHANGELOG.md, TASK_COMPLETED/, ARCHITECTURE/,
  PROJECT_DEFINITION/, GUIDES/, RESEARCH/, ARCHIVED/
```

---

## Database

**35 migrations · 29 tables**

| Table | Purpose |
|---|---|
| `projects` | Project registry with path, remote, default branch/IDE |
| `agents` | Agent instances: status, cli_type, access_mode, session_id, resume_command |
| `worktrees` | Git worktrees: path, branch, auto_cleanup, disk_usage |
| `sessions` | Layout snapshot per project session |
| `scheduled_tasks` | Cron definitions with depends_on support |
| `scheduled_results` | Per-run outcomes (success/failure/timeout/budget_exceeded) |
| `token_usage` | Per-agent token consumption and estimated cost |
| `port_registry` | Detected/configured ports per worktree |
| `host_metrics` | CPU/memory/disk snapshots per agent |
| `settings` | Key-value app settings (JSON values) |
| `prompts` | Saved prompt templates per project |
| `activities` | Activity feed (type + entity + description) |
| `search_index` | FTS5 virtual table (porter + unicode61 tokenizer) |
| `handoffs` | Agent-to-agent context transfer records |
| `messages` | Inter-agent messages (text/handoff/status/request/result) |
| `task_queue` | Queued tasks with priority and dependency graph |
| `skills_state` | Per-project skill enable/disable state |
| `memories` | Extracted project memories with relevance scoring |
| `agent_scores` | Post-exit quality scores (files, compile, tests, overall) |
| `oplog` | Agent operation log for undo (commit/branch/worktree/file/revert) |
| `pipeline_templates` | Pipeline step definitions |
| `pipeline_runs` | Pipeline execution state + step results |
| `agent_events` | Structured event stream per agent |
| `file_index` | Project file index (path, hash, language, chunk count) |
| `file_chunks` | Chunked file content with optional embeddings |
| `parallel_runs` | Parallel agent runs with promotion tracking |
| `qa_tests` | Recorded QA test definitions (actions, start URL) |
| `qa_test_runs` | QA test execution results + step-level outcomes |
| `diff_comments` | Inline diff annotations per file/line |

Agent status values: `idle | spawning | running | waiting_input | paused | completed | failed | stopped | crashed`

---

## Rust Native Module (`packages/core-rust`)

Built with napi-rs. Loaded at startup; JS fallbacks activate if the `.node` binary is absent.

### `processing/strip_ansi.rs`
Strips ANSI escape sequences from agent output. Uses memchr for fast byte scanning. Called on every PTY data chunk before status parsing and before memory extraction.

### `processing/status_parser.rs`
`AgentOutputStream` class. Stateful stream processor: accumulates chunks, matches tool-call and status patterns using zero-alloc case-insensitive matching. Emits `{ status, currentStep }` on transitions.

### `git/`
- `worktree.rs` — create / remove / list git worktrees via libgit2
- `diff.rs` — staged and unstaged diff computation
- `oplog.rs` — operation log entries (commit SHAs, branch refs)
- `repo_info.rs` — remote URL, current branch, ahead/behind counts

**12 tests · Clippy pedantic clean**

---

## QA Automation

Browser-based test recording and replay backed by Electron's webview.

- **Recording**: user performs actions in a browser pane; each interaction (click, type, navigate, assert) is captured as a structured action step
- **Storage**: `qa_tests` table stores action sequences as JSON; `qa_test_runs` stores per-step results and console errors
- **Replay engine**: replays recorded actions programmatically; compares expected vs actual state; reports pass/fail per step with duration
- **UI**: save/run controls in the browser pane toolbar; test list in the Project > QA section
