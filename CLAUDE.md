# Exegol

Electron + React + Rust desktop app for orchestrating AI coding agents (Claude Code, Codex, Gemini CLI, Aider, etc.).

## Current State (March 2026)

### What Works
- App launches, UI renders with dark theme and hidden titlebar (macOS traffic lights)
- Project management: add/remove/list projects, persist to libSQL
- Agent spawning: spawn CLI agents (Claude Code, Codex, Aider, Gemini) via node-pty through user's login shell
- Terminal emulation: xterm.js with WebGL addon, real-time PTY streaming
- Agent status parsing: real-time extraction of current step from agent stdout
- Settings: full settings panel with 4 tabs (General, Agent CLIs, Terminal, Shortcuts), persisted to DB
- Sidebar: collapsible sections (Projects, Recent Sessions), footer with Schedulers/Resources overviews
- Workspace tabs: Agents, Tasks, Diff Viewer, Scheduler, Token Usage, Resources sections
- Keyboard shortcuts: Cmd+B sidebar toggle, Cmd+, settings, Cmd+N new agent, Cmd+. stop agent, Cmd+1-9 agent switch, Cmd+[/] tab navigation
- Session persistence: app state (active view, active project, sidebar collapsed) survives restart via Zustand persist
- Resources monitoring: background collector every 10s with CPU (delta-based), RAM (vm_stat on macOS), disk (df)
- Global hotkey: Cmd+Shift+E to bring app to front
- Stale agent cleanup on startup (marks running/spawning agents as stopped)

### What's Placeholder / Not Yet Functional
- Workspace sections: Tasks, Diff Viewer, Scheduler, Token Usage, Resources — UI shells exist but are placeholder
- Worktree management: DB schema exists, Rust git2 scaffold exists, but not wired into agent spawn flow
- Scheduler: DB tables exist (scheduled_tasks, scheduled_results), UI section is placeholder
- Token usage tracking: DB table exists, tRPC router exists, but no actual log parsing yet
- Port detection: DB table exists, no runtime detection
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
│   │   │   │   ├── migrations.ts   # 10 migrations (projects → agents_add_stopped_status)
│   │   │   │   └── queries.ts      # SQL query helpers
│   │   │   ├── ipc/
│   │   │   │   ├── router.ts       # tRPC appRouter (projects, agents, settings, tokenUsage, resources)
│   │   │   │   ├── trpc.ts         # tRPC init (router, publicProcedure)
│   │   │   │   ├── trpc-ipc.ts     # createCaller proxy traversal over IPC
│   │   │   │   ├── context.ts      # tRPC context (db instance)
│   │   │   │   └── procedures/
│   │   │   │       ├── projects.ts
│   │   │   │       ├── agents.ts
│   │   │   │       ├── settings.ts
│   │   │   │       ├── token-usage.ts
│   │   │   │       └── resources.ts
│   │   │   ├── system/
│   │   │   │   └── resources.ts    # Background metrics collector (CPU, RAM via vm_stat, disk)
│   │   │   └── terminal/
│   │   │       └── pty-manager.ts  # PTY instance tracking
│   │   ├── renderer/               # React UI
│   │   │   ├── App.tsx             # Root: TitleBar + Sidebar + MainContent + StatusBar
│   │   │   ├── main.tsx            # React entry
│   │   │   ├── contexts/
│   │   │   │   └── ProjectContext.tsx  # Project + agents provider, syncs DB → Zustand
│   │   │   ├── hooks/
│   │   │   │   ├── use-hotkeys.ts  # Global keyboard shortcuts
│   │   │   │   └── use-trpc.ts     # tRPC query/mutation hooks via IPC
│   │   │   ├── stores/
│   │   │   │   ├── app.ts          # Zustand: activeView, activeProjectId, sidebarCollapsed (persisted)
│   │   │   │   ├── agents.ts       # Zustand: agent state, focused agent, sync from DB
│   │   │   │   └── terminals.ts    # Zustand: terminal instances
│   │   │   ├── lib/
│   │   │   │   └── trpc-client.ts  # trpcInvoke/trpcMutate via window.api.trpc
│   │   │   └── components/
│   │   │       ├── ErrorBoundary.tsx
│   │   │       ├── layout/
│   │   │       │   ├── Sidebar.tsx         # Collapsible sidebar with sections
│   │   │       │   ├── SidebarHeader.tsx
│   │   │       │   ├── SidebarFooter.tsx   # Schedulers + Resources overviews + version
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
│   │   │       │   ├── SettingsPanel.tsx      # Tabbed settings: General, CLIs, Terminal, Shortcuts
│   │   │       │   ├── GeneralSettings.tsx
│   │   │       │   ├── CliSettings.tsx
│   │   │       │   ├── TerminalSettings.tsx
│   │   │       │   └── KeyboardShortcuts.tsx
│   │   │       ├── workspace/
│   │   │       │   ├── WorkspaceView.tsx      # Section switcher
│   │   │       │   ├── WorkspaceTabs.tsx      # Agents|Tasks|Diff|Scheduler|Tokens|Resources
│   │   │       │   └── sections/
│   │   │       │       ├── AgentsSection.tsx
│   │   │       │       ├── TasksSection.tsx      # Placeholder
│   │   │       │       ├── DiffSection.tsx       # Placeholder
│   │   │       │       ├── SchedulerSection.tsx  # Placeholder
│   │   │       │       ├── TokensSection.tsx     # Placeholder
│   │   │       │       └── ResourcesSection.tsx  # Placeholder
│   │   │       ├── terminal/
│   │   │       │   ├── TerminalPanel.tsx
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
│   │       ├── types/              # agent, project, settings, scheduler, token-usage, worktree
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
│   └── tasks_completed/            # Work log by month
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
- **Agent spawn flow**: AgentManager spawns the user's login shell (`$SHELL -ilc "claude ..."`) via node-pty so PATH, nvm, etc. are resolved. `getShellPath()` resolves the full PATH once at startup by running the shell. Output streams to renderer via `ipcMain.send('terminal:data', agentId, data)`.
- **Zustand with persist**: `useAppStore` persists `activeProjectId`, `activeView`, `sidebarCollapsed` to localStorage under key `exegol-app-state`.
- **Background metrics collector**: Starts on app launch, collects CPU/RAM/disk every 10s. CPU is delta-based (no blocking sleep). RAM uses `vm_stat` on macOS for accurate available memory (not `os.freemem()`). Renderer reads cached metrics synchronously via tRPC.
- **Database migrations**: 10 sequential migrations in `migrations.ts`, tracked in `_migrations` table. Migration 010 adds `stopped` to agent status enum by recreating the table.

## Database Tables

projects, agents, worktrees, sessions, scheduled_tasks, scheduled_results, token_usage, port_registry, host_metrics, settings

Agent status values: `idle | spawning | running | waiting_input | paused | completed | failed | stopped`
