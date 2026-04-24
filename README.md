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
- **Any agent** — Claude Code, Codex, Gemini, Aider, Goose, Amp, Kiro, or your custom CLI. 11 built-in providers.
- **Parallel execution** — Run multiple agents simultaneously, each in its own terminal with live status.
- **Project-centric** — Organize agents, tasks, and resources per project with git worktree isolation.
- **Pipelines** — Sequential multi-agent orchestration with loop/review cycles and shared worktrees.
- **QA automation** — Record browser interactions and replay them as automated test suites.

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
bun run rebuild:native

# Run in development
bun run dev
```

The app opens as a desktop window. Add a project (any git repo), then launch an agent.

### Build

```bash
bun run build
```

### Lint & Typecheck

```bash
npx @biomejs/biome check apps/ packages/shared/src/ packages/ui/src/
bun run typecheck
```

### Rust (native module)

```bash
cd packages/core-rust
cargo check && cargo test && cargo clippy
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 41 |
| Frontend | React 18, TailwindCSS 4, Zustand 5, Monaco Editor |
| IPC | tRPC 11 (over Electron IPC, not HTTP) |
| Database | libSQL (SQLite fork by Turso), 35 migrations, 22 tables |
| Terminal | xterm.js 6 + WebGL renderer, node-pty, PTY sidecar |
| Native | Rust via napi-rs (ANSI stripping, status parsing, git2 worktree ops) |
| Build | electron-vite 5, Turborepo, Bun, Biome 2.4 |

## Project Structure

```
exegol/
├── apps/desktop/src/
│   ├── main/               # Main process: agents, DB, tRPC routers, lifecycle
│   ├── renderer/           # React UI: components, stores, hooks
│   └── preload/            # IPC bridge (contextBridge)
├── packages/
│   ├── shared/             # TypeScript types + Zod schemas
│   ├── ui/                 # Radix UI primitives
│   └── core-rust/          # napi-rs: ANSI strip, status parser, git2
└── docs/
    ├── CHANGELOG.md        # Release notes per version
    ├── TASK_TODO.md        # Active backlog
    └── tasks_completed/    # Work log by month
```

## Features

### Workspace

- **Multi-pane tabbed workspace** — 3 main tabs (Agents, Project, Monitor), each with split support (Cmd+D / Cmd+Shift+D)
- **6 layout presets** — Single, Split Horizontal, Split Vertical, Three Columns, Bottom Terminal (70/30), 2×2 Grid; custom saved layouts with per-slot type/url/filePath
- **5 pane types** — Terminal (agent or plain shell), Browser (Electron webview), Files (FileExplorer + Monaco), Git (diff + oplog), Empty (agent selector grid)
- **Picture-in-Picture** — Any terminal or browser pane detaches into a frameless always-on-top window (T84)
- **Command Palette** — Cmd+K fuzzy search + `!<cmd>` bang commands that spawn a one-shot shell agent

### Agents

- **11 built-in providers** — Claude Code, Codex CLI, Gemini CLI, Aider, Goose, OpenCode, Amp, Kiro, KiloCode, Crush, Shell; fully configurable via Settings
- **PTY Sidecar** — Standalone detached Node.js process (`~/.exegol/pty-sidecar.sock`) survives window reload and app crashes; 8MB ring buffer per session for instant reconnect
- **Live status parsing** — Rust `AgentOutputStream` strips ANSI and detects status/step from output (zero-alloc case-insensitive matching)
- **Activity classification** — `busy | idle | neutral` derived from status on every push event; pulsing dot in tab chrome
- **Access modes** — `read | write | plan` per agent or pipeline step; system instruction injected at spawn; badge in terminal toolbar
- **Session resume** — Claude session ID + resume command captured from output; 3-tier resume priority (resume_command → claude_session_id → static flag)
- **Crash recovery** — On restart, alive PTY sessions reattach; dead sessions marked "crashed" with scrollback preserved
- **Terminal ↔ Chat view** — Toggle between raw terminal output and a structured chat view for any agent (live or stopped)

### Browser & QA

- **Browser pane** — Electron webview with URL bar, back/forward/reload, and agent interaction hooks
- **Design Mode** — Click any element to capture selector + styles + HTML for agent stdin
- **QA Record** — Captures clicks, inputs, keypresses, and navigation as a replayable test suite
- **QA Replay** — Drives steps sequentially with `scrollIntoView` before click, interactive ancestor resolution, `assert` action support, per-step alert/console error collection, and concurrent screenshot capture
- **QA Tests section** — Project sub-tab listing saved tests with expand/run/delete and per-run step results

### Git & Code

- **Smart Git Button** — 11 context-aware states (conflicts, commit, push, create PR, merge PR, install gh, etc.); AI commit message generation via Claude Haiku
- **Diff viewer** — Real git diff with unstaged/staged toggle, unified/split views, inline line comments (T69)
- **Oplog** — Agent operation log with undo capability
- **Git worktree isolation** — Each agent gets its own branch via Rust git2; metadata persisted and auto-cleaned on agent exit

### Project

- **Multi-agent pipelines** — Sequential orchestration in shared worktrees; loop/review cycles with `loopBackTo` + max iterations guard; explicit state machine (T78)
- **MCP Host** — stdio + HTTP transports; auto-reconnect with exponential backoff (2s→32s, 5 attempts)
- **Skills** — 5 built-in personas + per-project custom skills; injected into agent context at spawn
- **Memory system** — ANSI-stripped extraction from scrollback; relevance scoring; persisted per project
- **Prompts** — Reusable templates per project with category filters, pin, copy
- **Scheduler** — Cron-based task scheduling (croner), visual CronBuilder, dependency-aware engine
- **Lifecycle scripts** — `.exegol/lifecycle.yaml` per repo: `setup`, `beforeAgent`, `afterCommit`, `teardown` hooks
- **Semantic search** — Ollama embeddings + cosine similarity over project file chunks (T68/T100)

### Monitor

- **Agent Dashboard** — Live cards with uptime, token usage (k tokens + cost), status dot, provider icon
- **Attention Center** — Inbox for agent events needing review (critical/action_needed/info); click to navigate to pane
- **Token usage** — Claude Code JSONL log parser; cost breakdown by model
- **Resource monitor** — CPU, RAM, Disk with background collector (10s interval)

### Settings & Infrastructure

- **API key management** — `safeStorage` encryption with session-level cache; providers: Anthropic, OpenAI, Google, etc.
- **Terminal fonts** — 3 bundled Nerd Fonts (MesloLGS NF, FiraCode NF Mono, JetBrainsMono NF Mono); per-card live preview
- **Themes** — Light / Dark / Dark-black (OLED) / System
- **Structured errors** — `ExegolError → TransientError / PermanentError / TimeoutError` with `withRetry()` helper (T80)
- **DB row validation** — Zod schemas for all 14 row types with graceful degradation on parse failure (T77)
- **DI context** — All 5 tRPC singletons injected via context (no module-level globals) (T81)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Command Palette |
| `Cmd+B` | Toggle sidebar |
| `Cmd+,` | Settings |
| `Cmd+N` | New Agent |
| `Cmd+.` | Stop focused agent |
| `Cmd+T` | New workspace tab |
| `Cmd+W` | Close focused pane |
| `Cmd+D` | Split pane horizontal |
| `Cmd+Shift+D` | Split pane vertical |
| `Cmd+[` / `Cmd+]` | Previous / Next agent |
| `Cmd+1-9` | Focus agent by index |
| `Cmd+Shift+E` | Bring Exegol to front (global) |

## Documentation

| Document | Description |
|----------|-------------|
| [CLAUDE.md](CLAUDE.md) | AI assistant context — current state, dev commands, architecture |
| [CHANGELOG.md](docs/CHANGELOG.md) | Release notes per version |
| [Task Board](docs/TASK_TODO.md) | Active backlog |
| [Benchmarks](docs/BENCHMARKS.md) | First-paint and recovery telemetry |

## License

Private — not open source yet.
