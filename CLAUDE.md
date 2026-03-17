# Exegol

Electron + React + Rust desktop app for orchestrating AI coding agents (Claude Code, Codex, Gemini CLI, Aider, etc.).

## Current State (March 2026)

### What Works
- App launches, UI renders with dark/light/system theme and hidden titlebar (macOS traffic lights)
- Project management: add/remove/list projects, persist to libSQL
- Agent spawning: spawn CLI agents (Claude Code, Codex, Aider, Gemini) via node-pty through user's login shell
- Terminal emulation: xterm.js with WebGL addon, real-time PTY streaming
- Terminal split panes: tmux-like splits (Cmd+D horizontal, Cmd+Shift+D vertical) with per-pane agent assignment
- Terminal scrollback persistence: stopped agents show read-only history with re-launch button, 30s periodic flush to disk
- Diff viewer: real git diff viewer with unstaged/staged toggle, unified/split views, auto-refresh, collapsible per-file sections
- Agent status parsing: real-time extraction of current step from agent stdout
- Settings: full settings panel with 5 tabs (General, Agent CLIs, Terminal, Shortcuts, API Keys), persisted to DB
- Sidebar: collapsible sections (Projects, Recent Sessions), footer with Schedulers/Resources overviews
- Workspace tabs: Agents, Tasks, Diff Viewer, Scheduler, Token Usage, Resources sections
- Keyboard shortcuts: Cmd+B sidebar toggle, Cmd+, settings, Cmd+N new agent, Cmd+. stop agent, Cmd+D split, Cmd+1-9 agent switch, Cmd+[/] tab navigation
- Session persistence: app state (active view, active project, sidebar collapsed) survives restart via Zustand persist
- Resources monitoring: background collector every 10s with CPU (delta-based), RAM (vm_stat on macOS), disk (df)
- Global hotkey: Cmd+Shift+E to bring app to front
- Stale agent cleanup on startup (marks running/spawning agents as stopped)
- Open in IDE: button in sidebar project view to launch project in configured IDE (VS Code, Cursor, Zed, etc.)
- Theme system: light/dark/system with CSS variables, system preference listener, theme-aware xterm.js terminal
- Recent sessions: sidebar shows last 10 completed/stopped agent sessions from DB, click to navigate
- API key management: encrypted storage via OS keychain (safeStorage), injected as env vars on agent spawn
- Scheduler engine: cron-based task scheduling via croner, spawns agents on cadence, polls completion, records results
- Port detection: runtime ports via lsof (filtered by project CWD) + config file parsing (package.json, .env, vite/next config)
- Task viewer: load markdown files with checkbox tasks, interactive toggle with write-back, progress bar, auto-detect TODO.md
- Prompts & templates: save reusable prompts per project, category filters (task/review/debug/custom), pin, copy to clipboard, inject into spawn dialog
- File explorer: lazy-loaded tree view in agent panel, file type indicators, read-only preview, toggleable secondary panel
- Workspace tabs: Agents, Tasks, Prompts, Diff Viewer, Scheduler, Token Usage, Resources

### What's Placeholder / Not Yet Functional
- Workspace sections: Token Usage, Resources — UI shells exist but are placeholder
- Worktree management: DB schema exists, Rust git2 scaffold exists, but not wired into agent spawn flow
- Token usage tracking: DB table exists, tRPC router exists, but no actual log parsing yet
- MCP Host, Skills, Plan FSM, Hook Engine, Memory system, Repo Maps — not started

## Tech Stack

Electron 41, React 18, TailwindCSS 4, Rust (napi-rs), libSQL, tRPC 11, xterm.js 6, Zustand 5, Bun, Turborepo, Biome 2.4.7

## Monorepo Structure

```
exegol/
├── apps/desktop/                   # Electron app
│   ├── src/
│   │   ├── main/                   # Main process
│   │   │   ├── index.ts            # App entry: window, IPC handlers, lifecycle
│   │   │   ├── agents/
│   │   │   │   ├── manager.ts      # AgentManager: spawn/stop/write/resize via node-pty
│   │   │   │   └── status-parser.ts # Parses agent stdout for live status
│   │   │   ├── db/
│   │   │   │   ├── client.ts       # libSQL database init + WAL mode
│   │   │   │   ├── migrations.ts   # 11 migrations (projects → prompts)
│   │   │   │   └── queries.ts      # SQL query helpers
│   │   │   ├── ide/
│   │   │   │   └── opener.ts       # IDE launcher (vscode, cursor, zed, intellij, webstorm, custom)
│   │   │   ├── ipc/
│   │   │   │   ├── router.ts       # tRPC appRouter (projects, agents, settings, tokenUsage, resources, apiKeys, scheduler, files, prompts, diff, scrollback)
│   │   │   │   ├── trpc.ts         # tRPC init (router, publicProcedure)
│   │   │   │   ├── trpc-ipc.ts     # createCaller proxy traversal over IPC
│   │   │   │   ├── context.ts      # tRPC context (db instance)
│   │   │   │   └── procedures/
│   │   │   │       ├── projects.ts
│   │   │   │       ├── agents.ts
│   │   │   │       ├── settings.ts
│   │   │   │       ├── apikeys.ts
│   │   │   │       ├── token-usage.ts
│   │   │   │       ├── resources.ts
│   │   │   │       ├── scheduler.ts  # Scheduler CRUD + runNow
│   │   │   │       ├── files.ts        # File I/O: readFile, writeFile, pickFile, listDirectory (path-guarded)
│   │   │   │       ├── prompts.ts      # Prompt CRUD: list, create, update, delete, togglePin
│   │   │   │       ├── diff.ts         # Git diff queries (projectDiff, stagedDiff)
│   │   │   │       └── scrollback.ts   # Scrollback file read for stopped agents
│   │   │   ├── security/
│   │   │   │   └── keystore.ts     # API key encryption via safeStorage (OS keychain)
│   │   │   ├── scheduler/
│   │   │   │   └── engine.ts       # SchedulerEngine: cron jobs via croner, agent spawning
│   │   │   ├── system/
│   │   │   │   ├── resources.ts    # Background metrics collector (CPU, RAM via vm_stat, disk)
│   │   │   │   └── ports.ts        # Port detection (lsof + config parsing)
│   │   │   └── terminal/
│   │   │       └── pty-manager.ts  # PTY instance tracking
│   │   ├── renderer/               # React UI
│   │   │   ├── App.tsx             # Root: TitleBar + Sidebar + MainContent + StatusBar
│   │   │   ├── main.tsx            # React entry
│   │   │   ├── contexts/
│   │   │   │   └── ProjectContext.tsx  # Project + agents provider, syncs DB → Zustand
│   │   │   ├── hooks/
│   │   │   │   ├── use-hotkeys.ts  # Global keyboard shortcuts
│   │   │   │   ├── use-theme.ts    # Theme hook: sets data-theme on <html>, system preference listener
│   │   │   │   └── use-trpc.ts     # tRPC query/mutation hooks via IPC
│   │   │   ├── stores/
│   │   │   │   ├── app.ts          # Zustand: activeView, activeProjectId, sidebarCollapsed (persisted)
│   │   │   │   ├── agents.ts       # Zustand: agent state, focused agent, sync from DB
│   │   │   │   └── terminals.ts    # Zustand: terminal instances + pane split layout tree
│   │   │   ├── lib/
│   │   │   │   ├── trpc-client.ts  # trpcInvoke/trpcMutate via window.api.trpc
│   │   │   │   └── markdown-tasks.ts  # parseMarkdownTasks, toggleTask for checkbox .md files
│   │   │   └── components/
│   │   │       ├── ErrorBoundary.tsx
│   │   │       ├── layout/
│   │   │       │   ├── Sidebar.tsx         # Collapsible sidebar with sections
│   │   │       │   ├── SidebarHeader.tsx
│   │   │       │   ├── SidebarFooter.tsx   # Schedulers + Pinned Prompts + Resources overviews + version
│   │   │       │   ├── SidebarSection.tsx  # Reusable collapsible section component
│   │   │       │   ├── ProjectsSection.tsx # Project list in sidebar
│   │   │       │   ├── RecentSessions.tsx
│   │   │       │   ├── ResourcesOverview.tsx
│   │   │       │   ├── SchedulersOverview.tsx
│   │   │       │   ├── StatusBar.tsx
│   │   │       │   └── TitleBar.tsx
│   │   │       ├── agents/
│   │   │       │   ├── AgentCard.tsx
│   │   │       │   └── SpawnAgentDialog.tsx
│   │   │       ├── projects/
│   │   │       │   ├── ProjectList.tsx
│   │   │       │   └── AddProjectDialog.tsx
│   │   │       ├── settings/
│   │   │       │   ├── SettingsPanel.tsx      # Tabbed settings: General, CLIs, Terminal, Shortcuts, API Keys
│   │   │       │   ├── GeneralSettings.tsx
│   │   │       │   ├── CliSettings.tsx
│   │   │       │   ├── TerminalSettings.tsx
│   │   │       │   ├── KeyboardShortcuts.tsx
│   │   │       │   └── ApiKeysSettings.tsx    # Per-provider API key management UI
│   │   │       ├── workspace/
│   │   │       │   ├── WorkspaceView.tsx      # Section switcher
│   │   │       │   ├── WorkspaceTabs.tsx      # Agents|Tasks|Prompts|Diff|Scheduler|Tokens|Resources
│   │   │       │   ├── FileExplorer.tsx       # Lazy-loaded tree view with file preview
│   │   │       │   └── sections/
│   │   │       │       ├── AgentsSection.tsx      # Terminal + toggleable FileExplorer panel
│   │   │       │       ├── TasksSection.tsx       # Markdown task viewer with checkboxes
│   │   │       │       ├── PromptsSection.tsx     # Prompt cards, CRUD, category filters
│   │   │       │       ├── DiffSection.tsx        # Git diff viewer (unified/split views)
│   │   │       │       ├── diff/
│   │   │       │       │   ├── diff-parser.ts   # Unified diff format parser
│   │   │       │       │   ├── DiffFileView.tsx  # Collapsible per-file diff section
│   │   │       │       │   └── DiffHunkView.tsx  # Hunk renderer (unified + split views)
│   │   │       │       ├── SchedulerSection.tsx   # Task list, create/edit dialogs, execution history
│   │   │       │       ├── TokensSection.tsx      # Placeholder
│   │   │       │       └── ResourcesSection.tsx   # Placeholder
│   │   │       ├── terminal/
│   │   │       │   ├── TerminalPanel.tsx       # Live terminal or read-only scrollback replay
│   │   │       │   ├── TerminalInstance.tsx    # Reusable xterm.js component (readOnly, initialContent)
│   │   │       │   ├── TerminalSplitView.tsx   # Tree-based split pane layout (react-resizable-panels)
│   │   │       │   ├── PaneAgentSelector.tsx   # Agent picker for unassigned split panes
│   │   │       │   └── TerminalTabs.tsx
│   │   │       └── common/
│   │   │           ├── index.ts
│   │   │           ├── EmptyState.tsx
│   │   │           ├── KeyValue.tsx
│   │   │           ├── LoadingSpinner.tsx
│   │   │           ├── StatusDot.tsx
│   │   │           └── ConfirmDialog.tsx
│   │   └── preload/
│   │       └── index.ts            # contextBridge: trpc, terminal, dialog, window APIs
│   └── electron-builder.yml
├── packages/
│   ├── shared/                     # @exegol/shared
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types/              # agent, project, prompt, settings, scheduler, token-usage, worktree
│   │       └── schemas/            # Zod: agent, project, settings
│   ├── ui/                         # @exegol/ui (Radix primitives)
│   │   └── src/
│   │       ├── index.ts
│   │       ├── lib/utils.ts        # cn() utility
│   │       └── primitives/         # Button, Badge, Input, ScrollArea, Separator, Tooltip
│   └── core-rust/                  # Rust native module (napi-rs)
│       ├── Cargo.toml              # git2, napi, serde
│       └── src/                    # Git worktree ops scaffold
├── docs/
│   ├── project_definition/         # Architecture, features, stack, competitors
│   ├── tasks_completed/            # Work log by month
│   └── review_notes/              # PR review notes per cluster
├── turbo.json
├── biome.json                      # Biome 2.4.7 config
└── package.json                    # Bun workspace root
```

## Development

```bash
bun install                         # Install all dependencies
bun run dev                         # Start Electron app in dev mode (via Turborepo)
bun run build                       # Production build

# Native module rebuild (required after install for node-pty):
npx @electron/rebuild -v 41.0.2 -m . -o node-pty

# Lint (Biome):
npx @biomejs/biome check apps/ packages/shared/src/ packages/ui/src/

# Type check:
bun run typecheck                   # Runs typecheck:node + typecheck:web

# Rust:
cargo check                         # Type-check (run inside packages/core-rust)
```

## Architecture Notes

- **tRPC over IPC**: tRPC routers in main process, invoked via `createCaller` proxy traversal. Renderer calls `window.api.trpc.invoke(path, input)` which maps to `ipcMain.handle('trpc', ...)`. The handler splits the dot-separated path and walks the caller proxy (note: `hasOwnProperty` does not work on tRPC Proxies).
- **libSQL (not better-sqlite3)**: Uses `libsql` npm package v0.5.x. Same synchronous API as better-sqlite3 but adds native vector embeddings, encryption at rest, and multi-writer support. Database stored in `~/.exegol/data/exegol.db`.
- **Agent spawn flow**: AgentManager spawns the user's login shell (`$SHELL -ilc "claude ..."`) via node-pty so PATH, nvm, etc. are resolved. `getShellPath()` resolves the full PATH once at startup by running the shell. Output streams to renderer via `ipcMain.send('terminal:data', agentId, data)`. API keys from the keystore are injected as environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY).
- **Theme system**: `useTheme()` hook reads `settings.theme` and sets `data-theme` attribute on `<html>`. CSS variables in `globals.css` change per `[data-theme="dark"]` / `[data-theme="light"]`. System theme tracks `prefers-color-scheme` media query.
- **API key storage**: `safeStorage` from Electron encrypts keys using the OS keychain. Stored in the `settings` table with `apikey_<provider>` keys. Falls back to plaintext if encryption is unavailable.
- **Zustand with persist**: `useAppStore` persists `activeProjectId`, `activeView`, `sidebarCollapsed` to localStorage under key `exegol-app-state`.
- **Background metrics collector**: Starts on app launch, collects CPU/RAM/disk every 10s. CPU is delta-based (no blocking sleep). RAM uses `vm_stat` on macOS for accurate available memory (not `os.freemem()`). Renderer reads cached metrics synchronously via tRPC.
- **Database migrations**: 11 sequential migrations in `migrations.ts`, tracked in `_migrations` table. Migration 010 adds `stopped` to agent status enum by recreating the table. Migration 011 adds `prompts` table.
- **Scheduler engine**: `SchedulerEngine` singleton manages cron jobs via croner. On fire: creates agent, spawns via AgentManager, polls status every 5s (10-min timeout). Concurrent execution guard prevents duplicate spawns. Lifecycle: starts after metrics collector, stops on will-quit.
- **Port detection**: `getProjectPorts()` combines runtime detection (lsof + CWD filtering per PID) with config parsing (package.json scripts, .env, vite/next config). Runtime ports are filtered to those whose process CWD starts with the project path.
- **Scrollback persistence**: AgentManager captures PTY output per-agent (1MB cap). Periodic flush every 30s + final flush on process exit. Files stored at `{userData}/scrollback/{agentId}.log`. Renderer shows read-only xterm replay for stopped agents.
- **Terminal split panes**: Tree-based `PaneNode` layout (terminal leaf | split with children). New panes start unassigned (`agentId: null`) with agent picker UI. Uses `react-resizable-panels` for resize. Store actions: `splitPane`, `closePane`, `setPaneAgent`.
- **Diff viewer**: tRPC `diff.projectDiff` / `diff.stagedDiff` run `git diff` via `execFileAsync`. Parser in `diff-parser.ts` handles unified format. UI supports unified and side-by-side views with auto-refresh.

## Database Tables

projects, agents, worktrees, sessions, scheduled_tasks, scheduled_results, token_usage, port_registry, host_metrics, settings, prompts

Agent status values: `idle | spawning | running | waiting_input | paused | completed | failed | stopped`
