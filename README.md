# Exegol

**English** · [Español](README.es.md)

A desktop app for running AI coding agents side by side. Claude Code, Codex, Gemini, OpenCode,
Aider and the CLIs you already use, each in a real terminal, with live status, one place to see
who needs you, and tools to hand work between them.

[![Latest release](https://img.shields.io/github/v/release/dPeluChe/exegol)](https://github.com/dPeluChe/exegol/releases/latest)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux-informational)
![License](https://img.shields.io/badge/License-MIT-green)

<!--
Screenshots: save them in docs/assets/screenshots/ with these names and uncomment the lines below.
  workspace.png   workspace with two or three agents in split panes, one waiting on you
  launcher.png    Launch Agent with "Combination" open (model roles and a preset card)
  dashboard.png   Dashboard with pinned sessions in Watching
  dictation.png   the dictation overlay over a terminal pane, words showing
  preview.png     a Files pane with an HTML file in Preview
-->
<!-- ![Workspace with agents in split panes](docs/assets/screenshots/workspace.png) -->

## What it is

Coding CLIs are good at the work and bad at being five at once: five windows, no idea which one
is waiting on a question. Exegol is one window for all of them. You keep each CLI as it is (its
own login, flags and config) and Exegol adds the layout, the status, the notifications and the
coordination around it.

It is for developers who already use one or more coding agents in the terminal and want to run
several in parallel, across projects, without losing track.

> **The name.** Exegol is the hidden Sith world in Star Wars (*The Rise of Skywalker*), where
> the Final Order fleet was assembled in secret. Here it is where you plan the work, deploy your
> agents and keep the fleet in view.

## Features

**Workspace**
- Projects (any folder or git repo) with tabs and split panes: terminal, browser, files, git and
  an agent launcher.
- Six layout presets plus your own saved layouts; any terminal or browser pane can float in an
  always-on-top window.
- Command palette (`Cmd+K`) and keyboard navigation for tabs, panes and waiting agents.

**Agents**
- 14 built-in CLIs plus your own custom command ([table below](#supported-clis)).
- Sessions survive a reload, a crash or an app update: terminals run in a detached process and
  the screen is replayed when the app comes back.
- Live status per agent (Claude Code through its hooks, the others through their output), a
  Needs attention list, desktop notifications with the pending question, `Cmd+J` to the next one.
- Launch options: model, session name, access mode (read, write, plan), an isolated git worktree,
  and model roles for CLIs that take a second model (Claude Code advisor and subagents, Codex,
  OpenCode, Kilo Code, Aider, Goose, Droid), with presets.
- Resume past sessions, and restart a session on a newer CLI version when one is installed.

**Dashboard**
- Every live agent across projects with status, uptime, tokens and cost.
- Watching: pin sessions and follow them as live terminals side by side.

**Coordination**
- An Exegol MCP server for every agent: shared memory, messages between agents and file claims
  so two agents do not edit the same paths.
- Pipelines: agents in sequence on a shared worktree, with review and fix loops and evaluator
  gates.
- Watch PR: failing checks, review comments and conflicts on the agent's PR are sent back to it
  (needs `gh`).

**Around the code**
- Git pane with diff, line comments and one button for the next step (commit, push, create or
  merge the PR).
- Undo an agent's turn, and snapshots of what agents changed.
- Browser pane that agents can drive through MCP, limited to local hosts and the hosts you allow.
- Files pane with a Monaco viewer and an offline Preview for Markdown and HTML.

**On your machine**
- Voice dictation (`Cmd+Shift+Space`) transcribed locally with a model you download in Settings.
- Settings > Storage shows what Exegol keeps on disk and lets you clear it.

The full list is in [docs/GUIDES/FEATURES.md](docs/GUIDES/FEATURES.md) and the keys in
[docs/GUIDES/KEYBOARD_SHORTCUTS.md](docs/GUIDES/KEYBOARD_SHORTCUTS.md). Keys are written for
macOS; on Linux and Windows `Cmd` is `Ctrl+Shift`.

<!-- ![Launch Agent with model roles](docs/assets/screenshots/launcher.png) -->
<!-- ![Dashboard watching pinned sessions](docs/assets/screenshots/dashboard.png) -->
<!-- ![Dictation overlay](docs/assets/screenshots/dictation.png) -->
<!-- ![HTML preview in a Files pane](docs/assets/screenshots/preview.png) -->

## Supported CLIs

Exegol launches the CLIs installed on your machine; it does not ship them or their accounts.
Settings > Agent CLIs shows which ones it finds and how to install the rest.

| CLI | Command | Prompt at launch | Model roles |
|-----|---------|:----------------:|:-----------:|
| Claude Code | `claude` | yes | yes |
| Codex | `codex` | yes | yes |
| Gemini | `gemini` | no | no |
| Antigravity | `agy` | yes | no |
| Devin | `devin` | yes | no |
| Aider | `aider` | no | yes |
| Goose | `goose` | yes | yes |
| OpenCode | `opencode` | no | yes |
| Amp | `amp` | yes | no |
| Kiro | `kiro-cli` | no | no |
| Kilo Code | `kilocode` or `kilo` | no | yes |
| Crush | `crush` | no | no |
| Factory Droid | `droid` | yes | yes |
| Terminal | your `$SHELL` | no | no |

Add any other command as a custom CLI. A CLI typed in a plain terminal is picked up as an agent
too.

## Install

Download the latest release from
[GitHub Releases](https://github.com/dPeluChe/exegol/releases/latest):

| Platform | File | Notes |
|----------|------|-------|
| macOS (Apple Silicon) | `Exegol-<version>-arm64.dmg` | Signed and notarized |
| Linux (x64) | `Exegol-<version>-x86_64.AppImage` or `exegol_<version>_amd64.deb` | Built on Ubuntu 22.04 |

Intel Macs and Windows have no release yet. Once installed, the app checks GitHub Releases,
downloads updates and offers to restart from the title bar, with the release notes.

**Requirements**: at least one coding CLI installed and signed in. Optional: `gh` (pull requests,
Watch PR), [Ollama](https://ollama.com/) (semantic memory recall), an Anthropic API key (AI commit
messages, run scoring, pipeline evaluators).

## Quick start

1. Open Exegol and follow the first-run setup: it detects your CLIs and runs Doctor, a health check.
2. Add a project: any folder or git repo.
3. In the empty pane, pick a CLI, optionally a model and a worktree, and launch.
4. Split the pane (`Cmd+D`) and launch another agent next to it.
5. When an agent asks something, it shows in Needs attention; `Cmd+J` takes you there.

The welcome tour (command palette > Show welcome tour) walks through the rest.

## Build from source

Prerequisites: [Bun](https://bun.sh/) 1.2.23+, [Node.js](https://nodejs.org/) 20+ (CI uses 22),
[Rust](https://rustup.rs/) stable and git. On Linux also `build-essential python3 libsecret-1-dev`.

```bash
git clone https://github.com/dPeluChe/exegol.git
cd exegol
bun install
bun run rebuild:native   # Rust native module + node-pty for Electron
bun run dev              # builds Rust and starts the app
```

`bun run dev:ui` skips the Rust build and uses the JS fallback. To build an installer:

```bash
bun run build:rust
bun run package:mac      # or package:linux
```

The DMG lands in `apps/desktop/dist/<version>/`. Without `APPLE_KEYCHAIN_PROFILE` it is not
notarized and macOS asks you to allow it (System Settings > Privacy & Security > Open Anyway).
Release steps: [docs/GUIDES/RELEASE.md](docs/GUIDES/RELEASE.md).

## Privacy

Exegol is local first. There is no account and no telemetry.

- Your data (projects, sessions, memory, settings) lives in a local SQLite database and in
  `~/.exegol`.
- Dictation runs on your machine: audio never leaves it and is never saved. Models are
  downloaded only when you ask, from the sherpa-onnx releases on GitHub, and checked against a
  pinned SHA-256.
- API keys are encrypted with the OS keychain (Electron `safeStorage`). If the OS offers no
  encryption, Settings > API Keys and Doctor say so.
- Your prompts go from each CLI to its own provider, as they would without Exegol.
- Exegol itself connects to: GitHub (updates and release notes), the npm and PyPI registries
  (newest CLI versions), Anthropic with your Claude Code login, read only (the plan usage
  widget), and Anthropic with your API key only for the features above that need one.
- Bug reports from the title-bar button are public GitHub issues. You review the redacted
  diagnostics before anything is sent; they never include prompts or agent output.

## Status

Exegol is in active development (0.5.x) and used daily by its author. Expect fast releases and
some rough edges. What changed per version: [docs/CHANGELOG.md](docs/CHANGELOG.md). What is next:
[docs/TASK_TODO.md](docs/TASK_TODO.md).

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md): setup, the gates, one task per PR and the rules
that are easy to miss. AI agents working in this repo follow [AGENTS.md](AGENTS.md);
architecture is in [CLAUDE.md](CLAUDE.md). Please read the
[Code of Conduct](CODE_OF_CONDUCT.md), and report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md).

## License and credits

[MIT](LICENSE) © Antonio Martinez Quintero ([antonio@dpeluche.dev](mailto:antonio@dpeluche.dev)), team member at Iteris Tech.

Built with Electron, React, xterm.js, Monaco, libSQL, tRPC and Rust (napi-rs, git2). Speech
recognition by [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx); each speech model lists its
own license and credit in Settings > Models. The agent CLIs belong to their makers.
