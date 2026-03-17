# Exegol

Desktop app for orchestrating AI coding agents. Run Claude Code, Codex, Gemini CLI, Aider — or any CLI agent — in parallel with full visibility, structured planning, and intelligent context management.

![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-napi--rs-DEA584?logo=rust&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-Private-red)

## What is Exegol?

Current AI coding tools force you into one of two extremes: **terminal-only** (powerful but invisible) or **locked platforms** (feature-rich but ecosystem-bound). Exegol bridges both — an agent-agnostic command center where you manage, monitor, and orchestrate any CLI coding agent from a single interface.

**Key ideas:**
- **Any agent** — Claude Code, Codex, Gemini, Aider, or your custom CLI. Configure in Settings.
- **Parallel execution** — Run multiple agents simultaneously, each in its own terminal with live status.
- **Project-centric** — Organize agents, tasks, and resources per project.
- **Git worktree isolation** — Each agent gets its own branch (coming soon).
- **Token budget tracking** — Know what you're spending per agent and per model.

## Screenshots

> Coming soon — the app is in active development.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) 1.2+
- [Rust](https://rustup.rs/) (for native modules)
- [Node.js](https://nodejs.org/) 18+ (Electron requirement)
- At least one AI coding CLI installed: `claude`, `codex`, `aider`, `gemini`, etc.

### Install & Run

```bash
# Clone
git clone https://github.com/dPeluChe/exegol.git
cd exegol

# Install dependencies
bun install

# Rebuild native modules for Electron
npx @electron/rebuild -v 41.0.2 -m . -o node-pty

# Run in development
bun run dev
```

The app opens as a desktop window. Add a project (any git repo), then launch an agent.

### Build

```bash
bun run build
```

### Lint

```bash
npx @biomejs/biome check apps/ packages/shared/src/ packages/ui/src/
```

### Rust (native module)

```bash
cd packages/core-rust
cargo check
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 41 |
| Frontend | React 18, TailwindCSS 4, Zustand 5 |
| IPC | tRPC 11 (over Electron IPC, not HTTP) |
| Database | libSQL (SQLite fork by Turso) — vectors, encryption, multi-writer |
| Terminal | xterm.js 6 + WebGL, node-pty |
| Native | Rust via napi-rs (git2 for worktrees) |
| Build | electron-vite 5, Turborepo, Bun, Biome 2.4 |

## Project Structure

```
exegol/
├── apps/desktop/              # Electron app
│   └── src/
│       ├── main/              # Main process: agents, DB, tRPC, resources
│       ├── renderer/          # React UI: components, stores, hooks
│       └── preload/           # IPC bridge
├── packages/
│   ├── shared/                # TypeScript types + Zod schemas
│   ├── ui/                    # Radix UI primitives (Button, Badge, etc.)
│   └── core-rust/             # Rust napi-rs (git2 worktree ops)
└── docs/
    ├── project_definition/    # Architecture, stack, features, research
    ├── tasks_completed/       # Work log by month
    ├── review_notes/          # PR review notes per cluster
    └── TASK_TODO.md           # Task board for parallel development
```

## Features

### Working Now
- **Project Manager** — Add git repos, switch between projects
- **Agent Spawning** — Launch any CLI agent with a task description
- **Terminal** — xterm.js with WebGL rendering, per-agent tabs
- **Live Status** — Real-time parsing of agent output ("Writing auth middleware...")
- **Sidebar** — Collapsible sections: Projects (with nested agents), Recent Sessions, Schedulers, Resources
- **Settings** — 4 tabs: General, Agent CLIs, Terminal, Keyboard Shortcuts
- **Resource Monitor** — CPU, RAM, Disk with background collector (10s interval)
- **Keyboard Shortcuts** — Cmd+B sidebar, Cmd+N new agent, Cmd+1-9 switch agents, [full list in Settings]
- **Session Persistence** — Active project and view survive app restarts

### In Development (5 parallel clusters)
- **Cluster A** — Git worktrees, token usage monitor, agent re-launch, process metrics
- **Cluster B** — Diff viewer, terminal split panes, scrollback persistence
- **Cluster C** — Task viewer (markdown), prompts/templates, file explorer
- **Cluster D** — Scheduler engine (cron), port detection
- **Cluster E** — Theme system, open in IDE, API key management, recent sessions

### Planned (Phase 2+)
- MCP Host (10,850+ server ecosystem)
- Tree-sitter repo maps with PageRank
- Skills system (Progressive Disclosure)
- Plan.md FSM (structured task execution)
- Hook system (pre/post tool use)
- Multi-agent topologies (pipeline, parallel, supervisor)
- Semantic search via libSQL vectors

## Development

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+B` | Toggle sidebar |
| `Cmd+,` | Settings |
| `Cmd+Shift+P` | All Projects |
| `Cmd+N` | New Agent |
| `Cmd+.` | Stop focused agent |
| `Cmd+[` / `Cmd+]` | Previous / Next agent |
| `Cmd+1-9` | Focus agent by index |
| `Cmd+Shift+E` | Bring Exegol to front (global) |

### Contributing

The project uses a **cluster-based parallel development** model. See [`docs/TASK_TODO.md`](docs/TASK_TODO.md) for the full task board organized into 5 isolated clusters that can be developed simultaneously without merge conflicts.

Each cluster has:
- Defined file boundaries (no overlap)
- Acceptance criteria per task
- Pre-push checklist (compilation, lint, self-review)
- Review notes template in `docs/review_notes/`

## Documentation

| Document | Description |
|----------|-------------|
| [CLAUDE.md](CLAUDE.md) | AI assistant context — current state, dev commands, architecture |
| [Architecture](docs/project_definition/ARCHITECTURE.md) | System design, module docs, data flows |
| [Stack](docs/project_definition/STACK.md) | Technology decisions with justifications |
| [Features](docs/project_definition/FEATURES.md) | Full roadmap with DONE/PARTIAL/STUB/PLANNED status |
| [Research](docs/project_definition/RESEARCH.md) | Ecosystem analysis (Codex, Superset, Cmux, Aider, Mastra, etc.) |
| [Competitors](docs/project_definition/COMPETITORS.md) | Competitive matrix |
| [Design Patterns](docs/project_definition/DESIGN_PATTERNS.md) | Architectural patterns from research |
| [Task Board](docs/TASK_TODO.md) | 16 tasks in 5 clusters for parallel development |

## License

Private — not open source yet.
