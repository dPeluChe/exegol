# System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                     │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │  Agent    │  │ Worktree │  │   Hook   │  │   Skill   │  │
│  │ Manager   │  │ Manager  │  │  Engine  │  │  Loader   │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
│       │              │             │               │        │
│  ┌────┴──────────────┴─────────────┴───────────────┴────┐   │
│  │                    tRPC Router                        │   │
│  └────┬──────────────────────────────────────────┬──────┘   │
│       │                                          │          │
│  ┌────┴─────┐  ┌──────────┐  ┌──────────┐  ┌───┴───────┐  │
│  │  SQLite  │  │ node-pty │  │  Memory  │  │   Plan    │  │
│  │ (libsql) │  │ (agents) │  │  System  │  │   FSM     │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────┘  │
│       │                                                     │
│  ┌────┴──────────┐  ┌──────────────────────────────────┐   │
│  │  Scheduler    │  │        Rust Native (napi-rs)      │   │
│  │  (cron tasks) │  │                                    │   │
│  └───────────────┘  │  ┌──────────┐ ┌───────────┐      │   │
│                      │  │ MCP Host │ │ Tree-sitter│      │   │
│                      │  │  (rmcp)  │ │ Repo Maps │      │   │
│                      │  └──────────┘ └───────────┘      │   │
│                      │  ┌────────┐ ┌────────┐           │   │
│                      │  │  git2  │ │ast-grep│           │   │
│                      │  │Worktree│ │AST Edit│           │   │
│                      │  └────────┘ └────────┘           │   │
│                      │  ┌──────────┐ ┌────────┐         │   │
│                      │  │ rusqlite │ │ libsql │         │   │
│                      │  │ (heavy)  │ │(vector)│         │   │
│                      │  └──────────┘ └────────┘         │   │
│                      │  ┌──────────┐                     │   │
│                      │  │  tokio   │                     │   │
│                      │  └──────────┘                     │   │
│                      └───────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │ IPC (tRPC)
┌──────────────────────┴──────────────────────────────────────┐
│                   Electron Renderer                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    React 18 + Zustand                 │   │
│  │                                                       │   │
│  │  ┌─────────────┐  ┌──────────┐  ┌────────────────┐  │   │
│  │  │  Terminal    │  │   Diff   │  │  Agent Sidebar  │  │   │
│  │  │  Panels     │  │  Viewer  │  │ (live status)   │  │   │
│  │  │  (xterm.js) │  │          │  │                  │  │   │
│  │  └─────────────┘  └──────────┘  └────────────────┘  │   │
│  │  ┌─────────────┐  ┌──────────┐  ┌────────────────┐  │   │
│  │  │  Plan View  │  │  MCP     │  │  DAG Visualizer │  │   │
│  │  │  (FSM)      │  │  Config  │  │  (D3/Cytoscape) │  │   │
│  │  └─────────────┘  └──────────┘  └────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Module Architecture

### Agent Manager

Responsible for the full lifecycle of CLI agent processes.

```
AgentManager
├── spawn(config: AgentConfig) → AgentInstance
│   ├── Create git worktree (via Rust git2)
│   ├── Spawn CLI process (via node-pty)
│   ├── Attach xterm.js terminal in renderer
│   ├── Register stdout parser for live status
│   ├── Initialize token counter
│   └── Register in scheduler if recurring task
├── stop(agentId) → void
│   ├── Send SIGTERM to process
│   ├── Run post-execution hooks
│   └── Evaluate worktree auto-cleanup
├── getStatus(agentId) → AgentStatus
└── listAll() → AgentInstance[]
```

**Supported CLI agents** (any terminal-based agent):
- Claude Code (`claude`)
- OpenAI Codex CLI (`codex`)
- Gemini CLI (`gemini`)
- Aider (`aider`)
- OpenCode, Goose, Amp, Kiro, etc.

### Worktree Manager

Abstracts git worktree operations via Rust `git2` bindings.

```
WorktreeManager
├── create(repo, branchName) → WorktreePath
│   ├── git worktree add --detach
│   ├── git checkout -b <branch>
│   ├── Record in SQLite (worktree_id, path, branch, agent_id)
│   └── Run workspace preset (install deps, env setup)
├── cleanup(worktreeId) → void
│   ├── Check for uncommitted changes
│   ├── If no changes: remove worktree + delete branch (auto-cleanup)
│   ├── If changes exist: keep worktree, notify user
│   └── Update SQLite status
├── list(projectId) → Worktree[]
└── diff(worktreeId) → DiffResult
```

**Design decision**: Follow Codex pattern — worktrees share `.git` directory, saving disk space vs full clones. Auto-cleanup (from Claude Code's `--worktree` behavior) prevents worktree accumulation.

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

### Internal Scheduler

Cron-like task scheduler for recurring agent tasks per project.

```
Scheduler
├── create(task: ScheduledTask) → taskId
│   ├── Parse cron expression or interval
│   ├── Store in SQLite scheduled_tasks table
│   └── Register in internal timer
├── run(taskId) → void
│   ├── Spawn agent via AgentManager (dedicated worktree)
│   ├── Inject task.prompt as agent input
│   ├── Attach optional skill
│   ├── On completion: store result in scheduled_results
│   └── Send to inbox panel for human review
├── pause(taskId) / resume(taskId) → void
├── delete(taskId) → void
├── list(projectId) → ScheduledTask[]
└── config per task:
    ├── prompt: string           -- natural language task description
    ├── cronExpression: string   -- "0 9 * * *" (daily at 9am)
    ├── skillName?: string       -- optional skill to attach
    ├── cliAgent: string         -- which CLI to use
    ├── maxTokenBudget?: number  -- budget limit per run
    └── enabled: boolean
```

**Examples**:
- `"Every morning: review open PRs for security issues"` → cron `0 9 * * *`
- `"On push to main: run tests and report failures"` → git hook trigger
- `"Every 2 hours: check CI pipeline status"` → cron `0 */2 * * *`
- `"Daily: scan for deprecated dependencies"` → cron `0 8 * * 1-5`

### Hook Engine

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

## Data Flow: Agent Execution

```
User creates task
       │
       ▼
WorktreeManager.create()  ──→  git worktree add
       │
       ▼
AgentManager.spawn()
       │
       ├── node-pty spawns CLI process in worktree
       ├── xterm.js attaches to PTY output
       ├── OSC interceptor monitors escape sequences
       └── TokenBudget starts tracking
       │
       ▼
Agent runs autonomously
       │
       ├── PreToolUse hook fires ──→ HookEngine evaluates
       │   ├── allow → tool executes
       │   ├── deny → tool blocked, agent informed
       │   └── ask → user prompted
       │
       ├── Token usage recorded per step
       │   └── Budget exceeded? → circuit breaker
       │
       ├── OSC 9/99/777 detected?
       │   └── Update sidebar badge + desktop notification
       │
       └── Agent completes / user stops
              │
              ▼
       PostToolUse hooks fire
       WorktreeManager.cleanup()
       │
       ├── Changes? → Keep worktree, show diff viewer
       └── No changes? → Auto-remove worktree + branch
```

## Monorepo Structure

```
exegol/
├── apps/
│   └── desktop/              # Electron app
│       ├── src/
│       │   ├── main/         # Main process (Bun/Node)
│       │   │   ├── ipc/      # tRPC router definitions
│       │   │   ├── agents/   # AgentManager
│       │   │   ├── worktrees/ # WorktreeManager
│       │   │   ├── hooks/    # HookEngine
│       │   │   ├── mcp/      # MCPHost (JS wrapper around Rust)
│       │   │   ├── skills/   # SkillLoader + Progressive Disclosure
│       │   │   ├── memory/   # Layered memory system
│       │   │   ├── plans/    # PlanFSM
│       │   │   └── db/       # better-sqlite3 state
│       │   ├── renderer/     # React UI
│       │   │   ├── components/
│       │   │   │   ├── terminal/
│       │   │   │   ├── diff-viewer/
│       │   │   │   ├── agent-panel/
│       │   │   │   ├── plan-view/
│       │   │   │   ├── mcp-config/
│       │   │   │   ├── dag-view/
│       │   │   │   └── workspace/
│       │   │   ├── hooks/    # React hooks
│       │   │   └── stores/   # Zustand stores
│       │   └── preload/
│       └── electron-builder.yml
├── packages/
│   ├── core-rust/            # Rust native (napi-rs)
│   │   ├── src/
│   │   │   ├── treesitter/   # Repo map + PageRank
│   │   │   ├── mcp_host/     # rmcp MCP Host
│   │   │   ├── git/          # git2 worktree ops
│   │   │   ├── ast_edit/     # ast-grep edits
│   │   │   └── fs_watch/     # notify crate
│   │   └── Cargo.toml
│   ├── shared/               # TypeScript types + schemas
│   │   └── src/
│   │       ├── types/
│   │       ├── schemas/      # Zod
│   │       └── constants/
│   └── ui/                   # Shared React components
│       └── src/
│           ├── primitives/   # Radix UI
│           └── theme/        # TailwindCSS config
├── skills/                   # Built-in SKILL.md files
│   ├── batch/
│   ├── review-pr/
│   ├── debug/
│   └── plan/
├── turbo.json
├── biome.json
└── package.json              # Bun workspace root
```
