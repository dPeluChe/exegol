# Exegol

**English** · [Español](README.es.md)

Desktop app for running AI coding agents side by side. Claude Code, Codex, Gemini, Aider or any
CLI agent, each in its own terminal, with live status, one place to see who needs you, and the
tools to hand work between them.

![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-napi--rs-DEA584?logo=rust&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

## What is Exegol?

AI coding tools tend to be either terminal-only (powerful, but you lose track of five sessions in
five windows) or closed platforms tied to one vendor. Exegol is the command center in between:
you keep the CLIs you already use and get one window to launch, watch and coordinate them.

> **The name.** Exegol is the hidden Sith world in the Unknown Regions of Star Wars (*The Rise of
> Skywalker*): the citadel where the Sith Eternal plotted in secret and assembled the Final Order
> fleet. Here it is the place where you plan the attack, deploy your agents and keep the whole
> fleet under control.

## Highlights

- **Any agent**: 14 built-in CLIs plus your own; each runs in a real terminal.
- **Many at once**: tabs and split panes per project, a Dashboard across projects, and pinned
  sessions you watch live side by side.
- **Know who needs you**: live status, a Needs attention list, notifications with the pending
  question, `Cmd+J` to the next one.
- **Sessions that survive**: agents keep running through a reload, a crash or an update.
- **Coordination**: send text from one agent to another, shared memory, messages and file claims
  between agents, and pipelines that chain agents with review loops.
- **Around the code**: browser pane with design mode and QA recording, git diff and a smart
  commit/push/PR button, undo for agent changes.

All features: [docs/GUIDES/FEATURES.md](docs/GUIDES/FEATURES.md) ·
Keyboard shortcuts: [docs/GUIDES/KEYBOARD_SHORTCUTS.md](docs/GUIDES/KEYBOARD_SHORTCUTS.md)
(keys here are macOS; on Linux and Windows `Cmd` is `Ctrl+Shift`)

## Install

Download the latest release from
[GitHub Releases](https://github.com/dPeluChe/exegol/releases/latest): a notarized DMG for macOS
(Apple Silicon), an AppImage or `.deb` for Linux. The app updates itself from there.

## Run from source

### Prerequisites

- [Bun](https://bun.sh/) 1.2+
- [Rust](https://rustup.rs/) (for native modules)
- [Node.js](https://nodejs.org/) 20+ (root `engines`; CI uses 22)
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

The app opens as a desktop window. Add a project (any folder or git repo), then launch an agent.
Lint, tests and the PR loop: [CONTRIBUTING.md](CONTRIBUTING.md).

### Build and install (macOS)

```bash
bun run build:rust       # native module, bundled into the app
bun run package:mac      # electron-vite build + electron-builder
```

Output: `apps/desktop/dist/<version>/Exegol-<version>-<arch>.dmg`. Without `APPLE_KEYCHAIN_PROFILE` the build is not notarized, and macOS asks you to allow it (System Settings → Privacy & Security → Open Anyway). Linux packages come from CI. Release steps: [docs/GUIDES/RELEASE.md](docs/GUIDES/RELEASE.md).

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md): setup, where to find work, the one-task-one-PR loop
and the rules that are easy to miss. AI agents working in this repo follow
[AGENTS.md](AGENTS.md).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 41 |
| Frontend | React 18, TailwindCSS 4, Zustand 5, Monaco Editor |
| IPC | tRPC 11 (over Electron IPC, not HTTP) |
| Database | libSQL (SQLite fork by Turso), 54 migrations (36 base + wave sets), 34 tables |
| Terminal | xterm.js 6 + WebGL renderer, node-pty, PTY sidecar |
| Native | Rust via napi-rs (ANSI stripping, status parsing, git2 worktree ops, fuzzy/grep search) |
| Build | electron-vite 5, Turborepo, Bun, Biome 2.4 |

## Project Structure

```
exegol/
├── AGENTS.md               # Rules for AI agents working in this repo
├── CONTRIBUTING.md         # How to contribute (setup, PR loop, rules)
├── apps/desktop/src/
│   ├── main/               # Main process: agents, DB, tRPC routers, lifecycle
│   ├── renderer/           # React UI: components, stores, hooks
│   └── preload/            # IPC bridge (contextBridge)
├── packages/
│   ├── shared/             # TypeScript types + Zod schemas
│   ├── ui/                 # Radix UI primitives
│   ├── cli/                # `exegol` CLI (`exegol .` opens a folder)
│   └── core-rust/          # napi-rs: ANSI strip, status parser, git2
└── docs/
    ├── README.md           # Documentation index + writing rules
    ├── CHANGELOG.md        # Release notes per version
    ├── TASK_TODO.md        # Active backlog (pending only)
    ├── TASK_COMPLETED/     # Work log by month (YYMM.md)
    ├── ARCHITECTURE/       # Technical architecture docs
    ├── PROJECT_DEFINITION/ # Vision, stack, roadmap
    ├── GUIDES/             # Release & how-to guides
    ├── AGENT_PROMPTS/      # Briefs for agents working in worktrees
    ├── RESEARCH/           # Analyses, audits, benchmarks
    └── ARCHIVED/           # Obsolete docs (historical context)
```

## Documentation

| Document | Description |
|----------|-------------|
| [Features](docs/GUIDES/FEATURES.md) | Everything the app does, by area |
| [Keyboard shortcuts](docs/GUIDES/KEYBOARD_SHORTCUTS.md) | App and terminal shortcuts |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, the one-task-one-PR loop, rules that are easy to miss |
| [AGENTS.md](AGENTS.md) | Rules for AI coding agents working in this repo |
| [CLAUDE.md](CLAUDE.md) | Architecture reference and dev commands |
| [docs/README.md](docs/README.md) | Documentation index and writing rules |
| [CHANGELOG.md](docs/CHANGELOG.md) | Release notes per version |
| [Task Board](docs/TASK_TODO.md) | Active backlog |
| [Benchmarks](docs/RESEARCH/BENCHMARKS.md) | First-paint and recovery telemetry |

## License

[MIT](LICENSE)
