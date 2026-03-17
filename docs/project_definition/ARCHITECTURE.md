# System Architecture

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     Electron Main Process                         │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ AgentManager  │  │  Resources   │  │  Global Hotkey       │   │
│  │ (node-pty     │  │  Collector   │  │  (Cmd+Shift+E)       │   │
│  │  + status     │  │  (10s bg)    │  │                      │   │
│  │  parser)      │  │  CPU/RAM/Disk│  │                      │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────┘   │
│         │                  │                                      │
│  ┌──────┴──────────────────┴──────────────────────────────────┐  │
│  │        tRPC Router (createCaller proxy traversal)           │  │
│  │  projects | agents | settings | tokenUsage | resources      │  │
│  └──────┬──────────────────────────────────────────────┬──────┘  │
│         │                                              │         │
│  ┌──────┴──────┐  ┌──────────┐  ┌──────────────────┐  │         │
│  │   libSQL    │  │ node-pty │  │  IPC handlers     │  │         │
│  │  (10 tables │  │ (agents) │  │  terminal:write   │  │         │
│  │  10 migr.)  │  │          │  │  terminal:resize  │  │         │
│  └─────────────┘  └──────────┘  │  dialog, window   │  │         │
│                                  └──────────────────┘  │         │
│                                                         │         │
│  ┌──────────────────────────────────────────────────────┘         │
│  │         Rust Native (napi-rs) — scaffold only                  │
│  │  ┌────────┐                                                    │
│  │  │  git2  │  (worktree ops — not yet wired to agent spawn)     │
│  │  └────────┘                                                    │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  PLANNED (not yet implemented):                                    │
│  Hook Engine, Skill Loader, Plan FSM, MCP Host, Memory System,    │
│  Scheduler Engine (croner), Worktree Manager, Repo Map Generator   │
└──────────────────────┬─────────────────────────────────────────────┘
                       │ IPC (tRPC via createCaller, raw ipcMain)
┌──────────────────────┴─────────────────────────────────────────────┐
│                    Electron Renderer                                │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                React 18 + Zustand (persist) + TailwindCSS 4   │ │
│  │                                                                │ │
│  │  ┌──────────────┐  ┌───────────────────┐  ┌───────────────┐  │ │
│  │  │  TitleBar     │  │ Sidebar            │  │ StatusBar     │  │ │
│  │  │  (hidden      │  │  SidebarSection    │  │               │  │ │
│  │  │   titlebar)   │  │  ProjectsSection   │  │               │  │ │
│  │  └──────────────┘  │  RecentSessions    │  └───────────────┘  │ │
│  │                     │  SidebarFooter:    │                     │ │
│  │                     │   Schedulers       │                     │ │
│  │                     │   Resources        │                     │ │
│  │                     └───────────────────┘                     │ │
│  │                                                                │ │
│  │  ┌────────────────────────────────────────────────────────┐   │ │
│  │  │  WorkspaceView (tab-switched sections)                  │   │ │
│  │  │  ┌─────────┐ ┌──────┐ ┌──────┐ ┌─────────┐ ┌───────┐ │   │ │
│  │  │  │ Agents  │ │Tasks │ │ Diff │ │Scheduler│ │Tokens │ │   │ │
│  │  │  │(active) │ │(stub)│ │(stub)│ │ (stub)  │ │(stub) │ │   │ │
│  │  │  └─────────┘ └──────┘ └──────┘ └─────────┘ └───────┘ │   │ │
│  │  │  ┌───────────┐                                         │   │ │
│  │  │  │ Resources │                                         │   │ │
│  │  │  │  (stub)   │                                         │   │ │
│  │  │  └───────────┘                                         │   │ │
│  │  └────────────────────────────────────────────────────────┘   │ │
│  │                                                                │ │
│  │  ┌────────────────┐  ┌─────────────────┐  ┌──────────────┐   │ │
│  │  │ TerminalPanel  │  │ SpawnAgentDialog │  │ SettingsPanel│   │ │
│  │  │ (xterm.js+WebGL│  │ (Radix Dialog)   │  │ 4 tabs:      │   │ │
│  │  │  TerminalTabs) │  │                  │  │ General,CLIs │   │ │
│  │  └────────────────┘  └─────────────────┘  │ Terminal,Keys │   │ │
│  │                                            └──────────────┘   │ │
│  │  Stores: useAppStore (persist), useAgentStore, useTerminalStore│ │
│  │  Context: ProjectProvider (syncs DB agents → Zustand)          │ │
│  │  Hooks: useHotkeys, use-trpc                                  │ │
│  └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

## Module Architecture

### Agent Manager (Implemented)

Responsible for the full lifecycle of CLI agent processes. Located at `apps/desktop/src/main/agents/manager.ts`.

```
AgentManager (singleton via getAgentManager())
├── spawn(db, agent, config) → void
│   ├── Resolve CLI config from DEFAULT_SETTINGS (cliType → command + args)
│   ├── Look up project path from DB
│   ├── Build command string with shell-escaped task description
│   ├── Spawn through user's login shell: pty.spawn($SHELL, ["-ilc", fullCommand])
│   │   └── Resolves PATH via getShellPath() (runs $SHELL -ilc 'echo $PATH' once)
│   ├── Update DB: set PID, status → "running"
│   ├── Create AgentStatusParser for live step extraction
│   ├── proc.onData → forward to all renderer windows via terminal:data IPC
│   │   └── Also parse for status updates (currentStep, status changes)
│   └── proc.onExit → cleanup: remove from map, set final status (completed/failed)
├── stop(db, agentId) → void
│   ├── Send SIGTERM via proc.kill()
│   ├── Wait up to 5s for exit, then SIGKILL
│   └── DB updated by onExit handler
├── getProcess(agentId) → IPty | undefined
├── listRunning() → string[]
├── write(agentId, data) → void       # Terminal input forwarding
└── resize(agentId, cols, rows) → void # Terminal resize
```

**Supported CLI agents** (configured in DEFAULT_SETTINGS.agentClis):
- Claude Code (`claude`)
- OpenAI Codex CLI (`codex`)
- Gemini CLI (`gemini`)
- Aider (`aider`)
- Any custom CLI can be added via Settings > Agent CLIs

**Key implementation detail**: Agents are spawned through the user's login shell (`$SHELL -ilc "command"`) because Electron does not inherit the full PATH on macOS/Linux. This ensures nvm, homebrew, and other shell-configured tools are available.

### Background Metrics Collector (Implemented)

Located at `apps/desktop/src/main/system/resources.ts`. Runs in the main process, non-blocking.

```
MetricsCollector
├── startMetricsCollector() → void     # Called on app.whenReady()
│   ├── First collection immediately
│   └── setInterval every 10s
├── collectMetrics() → void (async, non-blocking)
│   ├── CPU: delta-based from os.cpus() (no sleep/delay)
│   ├── Memory: vm_stat on macOS (free + inactive + purgeable + speculative)
│   │   └── Fallback to os.freemem() on Linux/Windows
│   ├── Disk: df -k / (async execFile)
│   └── Cache result in module-level variable
├── getSystemMetrics() → SystemMetrics  # Synchronous, returns cached
├── getProjectMetrics(path, id, name)   # Async: du -sk + git worktree list
└── stopMetricsCollector() → void       # Called on will-quit
```

### Worktree Manager (Scaffold Only)

Rust `git2` bindings exist in `packages/core-rust/` but are **not yet wired** into the agent spawn flow. Agents currently run in the project's root directory, not in isolated worktrees.

**Planned design**: Follow Codex pattern -- worktrees share `.git` directory, saving disk space vs full clones. Auto-cleanup (from Claude Code's `--worktree` behavior) prevents worktree accumulation.

### Agent Status Parser

Parses agent stdout in real-time to extract what the agent is currently working on.

```
AgentStatusParser
├── attach(pty: NodePty) → void
│   └── Stream stdout through pattern matchers
├── patterns (per CLI type):
│   ├── Claude Code:
│   │   ├── "Read(file_path)" → "Reading {file_path}"
│   │   ├── "Edit(file_path)" → "Editing {file_path}"
│   │   ├── "Bash(command)" → "Running: {command}"
│   │   ├── "Write(file_path)" → "Writing {file_path}"
│   │   └── "Agent(description)" → "Subagent: {description}"
│   ├── Codex CLI:
│   │   ├── tool call patterns → status text
│   │   └── thinking indicators → "Thinking..."
│   ├── Aider:
│   │   ├── "Editing file..." → "Editing {file}"
│   │   └── "Applied edit to..." → "Applied edit: {file}"
│   └── Generic:
│       ├── "error" / "Error" / "FAIL" → status: failed
│       ├── "waiting" / "?" / "y/n" → status: waiting_input
│       └── test runners (jest, pytest, vitest) → "Running tests..."
├── updateStatus(agentId, status, currentStep) → void
│   └── Write to SQLite agents table + emit tRPC event to renderer
└── getStatus(agentId) → { status, currentStep, updatedAt }
```

### Internal Scheduler (DB Schema Only)

DB tables `scheduled_tasks` and `scheduled_results` exist. The `croner` package is listed as a dependency. No scheduler execution engine is implemented yet. UI shows a placeholder section.

**Planned design**:
```
Scheduler
├── create(task: ScheduledTask) → taskId
│   ├── Parse cron expression or interval
│   ├── Store in SQLite scheduled_tasks table
│   └── Register in internal timer (croner)
├── run(taskId) → void
│   ├── Spawn agent via AgentManager (dedicated worktree)
│   ├── On completion: store result in scheduled_results
│   └── Send to inbox panel for human review
├── pause/resume/delete/list
└── config per task: prompt, cronExpression, skillName, cliAgent, maxTokenBudget, enabled
```

### Hook Engine (Not Yet Implemented)

Deterministic control points around probabilistic AI behavior. Modeled after Claude Code's hook system.

```
HookEngine
├── register(event, handler) → void
├── trigger(event, context) → HookResult
│   ├── Execute shell command / HTTP call
│   ├── Parse exit code:
│   │   ├── 0 → success (process JSON output)
│   │   ├── 2 → block (deny tool call / reject prompt)
│   │   └── other → non-blocking warning
│   └── Return {action: allow|deny|ask, context?, updatedInput?}
└── events:
    ├── PreToolUse      # Before agent executes a tool
    ├── PostToolUse     # After tool execution completes
    ├── AgentSpawn      # Before agent process starts
    ├── AgentStop       # After agent process ends
    ├── WorktreeCreate  # After worktree is created
    ├── WorktreeRemove  # Before worktree cleanup
    ├── PlanStepStart   # Before plan.md step execution
    ├── PlanStepComplete# After plan.md step marked done
    └── BudgetExceeded  # Token budget circuit breaker triggered
```

### Skill System (Progressive Disclosure)

Minimizes context window pollution by loading skill content on-demand.

```
Phase 1: SCAN
  └── Read skills/ directories
  └── Parse YAML frontmatter only (name, description)
  └── Store metadata in memory (~100 tokens per skill)

Phase 2: MATCH
  └── On user request or agent inference
  └── Compare request semantics against skill descriptions
  └── Explicit: user types /skill-name or $skill-name
  └── Implicit: agent auto-matches based on description

Phase 3: LOAD
  └── Read full SKILL.md content
  └── Inject instructions + scripts into active context
  └── Budget: max 2% of context window per skill (from Claude Code)
```

**SKILL.md format**:
```yaml
---
name: review-pr
description: Reviews a pull request for bugs, security issues, and style
allowed-tools: Read, Grep, Glob, Bash
context: fork          # run in subagent (isolated context)
model: sonnet          # optional model override
argument-hint: "[PR number or URL]"
---

Instructions for the skill...
```

### MCP Host

Connects to external tools/data via Model Context Protocol. Implemented in Rust (rmcp).

```
MCPHost
├── loadConfig(path: .mcp.json) → ServerDefinition[]
├── connect(serverDef) → MCPClientSession
│   ├── Spawn subprocess (stdio) or HTTP connection
│   ├── Send initialize with capabilities
│   ├── Receive server capabilities (tools, resources, prompts)
│   └── Register in tool/resource/prompt registries
├── disconnect(serverId) → void
├── toolRegistry → aggregated tools from all servers
├── callTool(serverName, toolName, args) → ToolResult
├── getResource(serverName, uri) → ResourceContent
└── listPrompts() → Prompt[] (across all servers)
```

**.mcp.json format** (compatible with Claude Code / VS Code):
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${env:GITHUB_TOKEN}" }
    },
    "remote-api": {
      "type": "http",
      "url": "https://api.example.com/mcp"
    }
  }
}
```

### Repo Map Generator (Rust)

Based on Aider's proven approach but implemented natively in Rust for performance.

```
RepoMapGenerator
├── parse(projectPath) → AST forest
│   └── Tree-sitter: parse all source files (165+ languages)
├── extract(asts) → SymbolGraph
│   ├── Definitions: function signatures, class/interface defs, type aliases
│   ├── References: where each symbol is used
│   └── Build directed graph (files as nodes, deps as edges)
├── rank(graph, chatFiles) → RankedSymbols
│   ├── PageRank with personalization toward active files
│   └── Binary search for max symbols within token budget
├── format(ranked) → CompactRepoMap (string)
│   └── Output: file paths + signatures only (no implementations)
└── config:
    ├── maxTokens: 1024 (default, configurable)
    └── languages: auto-detect from project
```

**Why Rust**: Tree-sitter has first-party Rust bindings (774K downloads/mo). Parsing is CPU-intensive — native speed matters for large repos. Aider's Python implementation works but is slower.

### Plan FSM

Structured workflow execution inspired by Conductor Gemini CLI.

```
State Machine:
  DRAFT → SPECIFYING → PLANNING → APPROVED → IMPLEMENTING → COMPLETE
                                     ↑              │
                                     └──── PAUSED ←──┘

Files generated:
  .exegol/tracks/{track-id}/
  ├── spec.md       # Requirements and acceptance criteria
  └── plan.md       # Hierarchical task list with checkboxes

plan.md format:
  ## Phase 1: Setup
  - [x] Create database schema
  - [x] Add migration scripts
  - [ ] Seed test data          ← current step

  ## Phase 2: API
  - [ ] Implement REST endpoints
  - [ ] Add authentication middleware

Resumability:
  - State persisted in file (checkboxes)
  - Agent reads plan.md, finds first unchecked item, continues
  - Survives: app restart, network interruption, context compaction
```

### Memory System (Layered)

Following Claude Code's proven hierarchy with path-scoped rules.

```
Priority (highest → lowest):
1. Managed policy    /Library/Application Support/Exegol/CLAUDE.md
2. Project root      ./.exegol/CLAUDE.md
3. Project rules     ./.exegol/rules/*.md  (with glob path scopes)
4. User global       ~/.exegol/CLAUDE.md
5. Auto-memory       ~/.exegol/projects/{project}/memory/MEMORY.md

Loading behavior:
- Walk up directory tree from cwd, load all found CLAUDE.md files
- Subdirectory CLAUDE.md loaded on-demand when agent reads files there
- MEMORY.md: first 200 lines loaded at session start
- Total memory budget: ≤10,000 tokens
- Rule adherence: 92% under 200 lines, degrades to 71% past 400 lines

Auto-compaction:
- Triggers at ~83.5% of context window
- Summarizes old conversation, preserves CLAUDE.md (re-read from disk)
- Skills survive compaction (re-loaded from disk)
```

### Token Budget System

No competitor exposes this as a user-facing feature.

```
TokenBudget
├── track(agentId, usage) → void
│   ├── Input tokens consumed
│   ├── Output tokens generated
│   ├── Tool call count
│   └── Estimated cost (model-specific pricing)
├── checkBudget(agentId) → BudgetStatus
│   ├── remaining tokens vs configured limit
│   ├── remaining cost vs configured limit
│   └── loop iteration count vs max iterations
├── circuitBreaker(agentId) → void
│   ├── Gracefully stop agent execution
│   ├── Emit BudgetExceeded hook event
│   ├── Notify user with summary
│   └── Preserve agent state for manual resume
└── config (per agent):
    ├── maxTokens: number
    ├── maxCost: number (USD)
    ├── maxIterations: number
    └── warningThreshold: 0.8 (80% of limit)
```

### Keyboard Shortcuts (Implemented)

Located at `apps/desktop/src/renderer/hooks/use-hotkeys.ts`. Registered as a React hook in `App.tsx`.

```
useHotkeys()
├── Cmd+B        → Toggle sidebar
├── Cmd+,        → Open Settings
├── Cmd+Shift+P  → Go to Projects (clear active project)
├── Cmd+N        → New Agent (dispatch exegol:spawn-agent event)
├── Cmd+.        → Stop focused agent (dispatch exegol:stop-agent event)
├── Cmd+]        → Next agent tab
├── Cmd+[        → Previous agent tab
└── Cmd+1-9      → Switch to agent by index
```

### ProjectContext (Implemented)

Located at `apps/desktop/src/renderer/contexts/ProjectContext.tsx`. Wraps the WorkspaceView.

```
ProjectProvider
├── Reads activeProjectId from useAppStore
├── Fetches project + agents from DB via tRPC
├── Syncs DB agents into useAgentStore (Zustand)
├── Provides: project, projectId, isLoading, agents[], runningAgentCount
└── Used by WorkspaceView and child components
```

### SidebarSection (Implemented)

Reusable collapsible section component at `apps/desktop/src/renderer/components/layout/SidebarSection.tsx`.
Used for: Projects, Recent Sessions, Schedulers, Resources.

### tRPC Router (Implemented)

Located at `apps/desktop/src/main/ipc/router.ts`. Five sub-routers:

```
appRouter
├── projects   → list, get, create, update, delete
├── agents     → list (by project), get, create (spawn), stop, delete
├── settings   → get, update (persisted to settings table as JSON)
├── tokenUsage → list (by agent)
└── resources  → getSystem (cached metrics), getProject (async disk/worktree)
```

**IPC Bridge**: `trpc-ipc.ts` registers `ipcMain.handle('trpc', ...)` which uses `appRouter.createCaller(ctx)` and navigates the proxy via dot-separated path segments. The renderer calls via `window.api.trpc.invoke(path, input)`.

## Data Flow: Agent Execution (Current Implementation)

```
User clicks "New Agent" (or Cmd+N)
       │
       ▼
SpawnAgentDialog opens
  User selects CLI type + enters task description
       │
       ▼
tRPC agents.create mutation
       │
       ├── Insert agent row in DB (status: spawning)
       ├── AgentManager.spawn(db, agent, config)
       │   ├── Resolve CLI config (cliType → command + args)
       │   ├── Look up project path from DB
       │   ├── pty.spawn($SHELL, ["-ilc", "claude 'task description'"])
       │   │   └── cwd = project path (worktrees not yet wired)
       │   ├── Update DB: PID, status → running
       │   └── Register onData + onExit handlers
       │
       ▼
Agent runs in PTY
       │
       ├── proc.onData fires
       │   ├── Forward to all renderer windows (terminal:data IPC)
       │   └── AgentStatusParser extracts current step / status changes
       │       └── Update DB (status, currentStep)
       │
       └── proc.onExit fires
              ├── Remove from processes map
              ├── exitCode 0 → status: completed
              └── exitCode != 0 → status: failed

User clicks "Stop" (or Cmd+.)
       │
       ├── AgentManager.stop(db, agentId)
       │   ├── proc.kill() (SIGTERM)
       │   ├── Wait up to 5s
       │   └── SIGKILL if still running
       └── onExit handler cleans up
```

### Planned Data Flow (Future — with worktrees, hooks, budget)

```
User creates task
       │
       ▼
WorktreeManager.create()  ──→  git worktree add
       │
       ▼
AgentManager.spawn() in worktree
       │
       ├── PreToolUse hook fires ──→ HookEngine evaluates
       ├── Token usage recorded → Budget exceeded? → circuit breaker
       ├── OSC 9/99/777 detected? → sidebar badge + desktop notification
       │
       └── Agent completes / user stops
              ├── Changes? → Keep worktree, show diff viewer
              └── No changes? → Auto-remove worktree + branch
```

## Monorepo Structure (Current)

```
exegol/
├── apps/
│   └── desktop/                        # Electron 41 app
│       ├── src/
│       │   ├── main/                   # Main process (Node/Bun)
│       │   │   ├── index.ts            # App entry, window, IPC, lifecycle
│       │   │   ├── agents/
│       │   │   │   ├── manager.ts      # AgentManager (spawn/stop via node-pty)
│       │   │   │   └── status-parser.ts # Parse agent stdout for live status
│       │   │   ├── db/
│       │   │   │   ├── client.ts       # libSQL init + WAL mode
│       │   │   │   ├── migrations.ts   # 10 migrations
│       │   │   │   └── queries.ts      # SQL helpers
│       │   │   ├── ipc/
│       │   │   │   ├── router.ts       # tRPC appRouter (5 sub-routers)
│       │   │   │   ├── trpc.ts         # tRPC init
│       │   │   │   ├── trpc-ipc.ts     # createCaller proxy traversal
│       │   │   │   ├── context.ts      # tRPC context (db)
│       │   │   │   └── procedures/     # agents, projects, settings, token-usage, resources
│       │   │   ├── system/
│       │   │   │   └── resources.ts    # Background metrics collector
│       │   │   └── terminal/
│       │   │       └── pty-manager.ts  # PTY instance tracking
│       │   ├── renderer/               # React 18 UI
│       │   │   ├── App.tsx             # Root layout: TitleBar + Sidebar + Content + StatusBar
│       │   │   ├── main.tsx            # React entry
│       │   │   ├── contexts/
│       │   │   │   └── ProjectContext.tsx  # Project + agents provider
│       │   │   ├── hooks/
│       │   │   │   ├── use-hotkeys.ts  # Global keyboard shortcuts
│       │   │   │   └── use-trpc.ts     # tRPC query/mutation hooks
│       │   │   ├── stores/
│       │   │   │   ├── app.ts          # activeView, activeProjectId, sidebar (persisted)
│       │   │   │   ├── agents.ts       # Agent state, focused agent, DB sync
│       │   │   │   └── terminals.ts    # Terminal instances
│       │   │   ├── lib/
│       │   │   │   └── trpc-client.ts  # trpcInvoke/trpcMutate via IPC
│       │   │   └── components/
│       │   │       ├── ErrorBoundary.tsx
│       │   │       ├── layout/         # Sidebar, SidebarSection, SidebarHeader/Footer,
│       │   │       │                   # ProjectsSection, RecentSessions, ResourcesOverview,
│       │   │       │                   # SchedulersOverview, StatusBar, TitleBar
│       │   │       ├── agents/         # AgentCard, SpawnAgentDialog
│       │   │       ├── projects/       # ProjectList, AddProjectDialog
│       │   │       ├── settings/       # SettingsPanel (4 tabs), GeneralSettings,
│       │   │       │                   # CliSettings, TerminalSettings, KeyboardShortcuts
│       │   │       ├── workspace/      # WorkspaceView, WorkspaceTabs,
│       │   │       │   └── sections/   # AgentsSection, TasksSection, DiffSection,
│       │   │       │                   # SchedulerSection, TokensSection, ResourcesSection
│       │   │       ├── terminal/       # TerminalPanel, TerminalTabs
│       │   │       └── common/         # EmptyState, KeyValue, LoadingSpinner,
│       │   │                           # StatusDot, ConfirmDialog
│       │   └── preload/
│       │       └── index.ts            # contextBridge APIs
│       └── electron-builder.yml
├── packages/
│   ├── shared/                         # @exegol/shared
│   │   └── src/
│   │       ├── types/                  # agent, project, settings, scheduler,
│   │       │                           # token-usage, worktree
│   │       └── schemas/                # Zod: agent, project, settings
│   ├── ui/                             # @exegol/ui (Radix primitives)
│   │   └── src/
│   │       ├── lib/utils.ts            # cn() utility
│   │       └── primitives/             # Button, Badge, Input, ScrollArea,
│   │                                   # Separator, Tooltip
│   └── core-rust/                      # Rust native (napi-rs) — scaffold
│       ├── Cargo.toml                  # git2 0.19, napi 3, serde
│       └── src/                        # Git worktree ops (not yet wired)
├── docs/
│   ├── project_definition/             # Architecture, features, stack, competitors
│   └── tasks_completed/                # Work log by month
├── turbo.json
├── biome.json                          # Biome 2.4.7
└── package.json                        # Bun 1.2.0 workspace root
```

### Planned directories (not yet created)
```
apps/desktop/src/main/
├── worktrees/   # WorktreeManager (Rust git2 integration)
├── hooks/       # HookEngine
├── mcp/         # MCPHost (JS wrapper around Rust rmcp)
├── skills/      # SkillLoader + Progressive Disclosure
├── memory/      # Layered memory system
├── plans/       # PlanFSM
└── scheduler/   # Cron task execution engine

skills/          # Built-in SKILL.md files (batch, review-pr, debug, plan)
```
