# Feature Status — Exegol v0.4.4

> **Status key**: `DONE` = implemented and working · `PARTIAL` = exists but incomplete · `PLANNED` = not yet started
>
> Source of truth: `CLAUDE.md`, `docs/CHANGELOG.md`, `docs/TASK_TODO.md`

---

## Workspace & UI

| Feature | Status |
|---|---|
| Multi-pane tabbed workspace (WorkspaceTabBar, WorkspacePane, WorkspaceLayout) | DONE |
| Pane types: terminal, browser, files, git, empty/launcher | DONE |
| 6 built-in layout presets (Single, Split H/V, Three Columns, Bottom Terminal, 2×2 Grid) | DONE |
| Custom saved layouts (capture current tab as reusable template) | DONE |
| Equalize splits via pane context menu | DONE |
| Picture-in-Picture float for terminal and browser panes | DONE |
| Command Palette (Cmd+K) with bang `!command` shell execution | DONE |
| Activity dot in tab chrome (busy/idle derived from agent status) | DONE |
| Focus-aware pane targeting (new panes open beside focused pane) | DONE |
| Keyboard shortcuts (Cmd+T/W/D/B/,/N/./]/[/1-9) | DONE |
| Custom macOS app menu (Cmd+W closes pane, not window) | DONE |
| Workspace state persisted to localStorage (tabs, panes, layout tree) | DONE |
| Auto-select first project on cold start | DONE |

---

## Agent Execution

| Feature | Status |
|---|---|
| 11 built-in providers (Claude Code, Codex, Gemini, Aider, Goose, OpenCode, Amp, Kiro, KiloCode, Crush, Shell) | DONE |
| Custom CLI agents via Settings > Agent CLIs | DONE |
| PTY sidecar — detached Node.js process, survives window reload/crash | DONE |
| Ring buffer (8 MB/session) + instant reconnect on restart | DONE |
| Agent status machine: idle → spawning → running → waiting_input → paused → completed / failed / stopped / crashed | DONE |
| Access modes: `read` / `write` / `plan` — prompt prefix + `EXEGOL_ACCESS_MODE` env var | DONE |
| Access mode badge in terminal toolbar | DONE |
| Terminal ↔ Chat dual view (toggle between raw xterm and parsed conversational view) | DONE |
| Crash recovery: dead sidecar sessions detected and marked crashed on restart | DONE |
| Session resume: ring buffer replayed into xterm on reattach | DONE |
| Lifecycle scripts per repo (`.exegol/lifecycle.yaml` — setup / beforeAgent / afterCommit / teardown) | DONE |
| Structured errors: `ExegolError` hierarchy + `withRetry()` exponential backoff | DONE |
| Agent spawn performance: PATH pre-captured, single DB write (`activateAgent`), no login-shell flag | DONE |
| Shell agents bypass scoring, memory, scrollback buffering | DONE |
| Parallel multi-agent on isolated worktrees | PARTIAL |
| Runtime access mode switching (while agent is running) | PLANNED |
| Scheduler task `accessMode` propagation | PLANNED |

---

## Browser & QA

| Feature | Status |
|---|---|
| Electron webview browser pane with URL bar, back/forward/reload | DONE |
| Design Mode — click any element to capture selector, styles, HTML for agent context | DONE |
| QA Test Automation — record click/input/keypress/navigate flows | DONE |
| QA replay with screenshot capture per step | DONE |
| QA `assert` action type with pass/fail per step | DONE |
| Per-step alert + console error collection during replay | DONE |
| `QaTestsSection` in Project tab listing saved tests with run history | DONE |
| `stopOnFail` toggle on QA test runs | DONE |
| Floating PiP browser with its own DevTools toggle | DONE |
| Agent DOM inspection / JS eval / auto-refresh on file changes | PLANNED |

---

## Git & Code

| Feature | Status |
|---|---|
| Diff viewer: unified/split, unstaged/staged toggle, auto-refresh | DONE |
| Diff parser (files, hunks, line numbers, binary detection) | DONE |
| Collapsible per-file sections with +/- counts | DONE |
| Oplog (agent operations with undo) | DONE |
| Smart Git Button — 11 context-aware states (commit / push / create PR / merge PR / install gh) | DONE |
| AI-generated conventional-commit messages via Claude Haiku | DONE |
| Inline diff line comments — DB-persisted, add/delete/resolve | DONE |
| Git worktrees — Rust git2 module, tables exist, wired into pipelines | PARTIAL |
| Per-agent isolated worktrees for parallel runs | PLANNED |

---

## Pipelines

| Feature | Status |
|---|---|
| Sequential agent orchestration in shared worktrees | DONE |
| Pipeline templates: steps with provider, role, prompt template, accessMode | DONE |
| Prompt variables: `{{task}}`, `{{diff}}`, `{{previousOutput}}` | DONE |
| Loop mechanism: `loopBackTo` + max iterations guard | DONE |
| State machine with typed `PIPELINE_TRANSITIONS`, `canTransition()`, `assertTransition()` | DONE |
| Crash recovery: stale runs marked paused on startup | DONE |
| Pipeline step access mode selector in editor UI | DONE |
| Ralph evaluator loops (PASS/RETRY with `{{retryFeedback}}` injection) | PLANNED |

---

## Project Intelligence

| Feature | Status |
|---|---|
| MCP host — stdio and Streamable HTTP transports, multi-server aggregation | DONE |
| Skills system — SKILL.md files, 5 built-in personas, auto-discovery | DONE |
| Memory extractor + relevance-scored store | DONE |
| Virtual-scrolled memory list (`@tanstack/react-virtual`) | DONE |
| Prompts library (DB-persisted, project tab) | DONE |
| Lifecycle scripts per repo (`setup`, `beforeAgent`, `afterCommit`, `teardown`) | DONE |
| Scheduler — cron (croner v9), concurrent guard, 10-min timeout, runNow | DONE |
| Task viewer from Markdown (`- [ ]`/`- [x]` with write-back) | DONE |
| Project indexer — file chunking, SHA-256 incremental, Ollama embeddings | DONE |
| Ollama settings validation (URL + model, Verify Connection button) | DONE |
| DI for tRPC singletons (agentManager, providerRegistry, pipelineExecutor, schedulerEngine, mcpHost) | DONE |

---

## Search & Indexing

| Feature | Status |
|---|---|
| FTS5 full-text search table (`search_index`) | DONE |
| Project indexer — async FS scan, 500-line overlap chunks | DONE |
| Semantic search via local Ollama (`nomic-embed-text`) + brute-force cosine similarity | DONE |
| `exegol search <query>` CLI — resolves project from CWD, prints top-5 results | DONE |
| `exegol status` and `exegol projects` CLI commands | DONE |

---

## Monitor

| Feature | Status |
|---|---|
| Review Inbox / Agent Monitor — running agents + attention section (crashed/waiting/completed) | DONE |
| 10 animated agent spinners (braille wave, moon phases, heartbeat, etc.) | DONE |
| Attention cards: mark-read, pin, dismiss, navigate-to-pane | DONE |
| Token usage: cost, input/output tokens, tool calls, model cost breakdown | DONE |
| Claude Code JSONL log parser for token import | DONE |
| Host resource monitor: CPU, RAM, disk (macOS vm_stat + df, 10s poll) | DONE |
| Agent scoring (post-exit) | DONE |
| Per-agent process metrics (PID, CPU, memory) | PLANNED |
| Token parsers for Codex/Aider | PLANNED |

---

## Settings & Infrastructure

| Feature | Status |
|---|---|
| API keys encrypted via Electron `safeStorage` (OS keychain), with per-session cache | DONE |
| 3 bundled Nerd Fonts (MesloLGS NF, FiraCode NF Mono, JetBrainsMono NF Mono) | DONE |
| Terminal settings — per-card font preview, promote-on-click, family chain badges | DONE |
| Theme: dark / light / system with CSS variables, applies immediately | DONE |
| DB row validation — 14 Zod schemas, `parseRow()` at query boundary | DONE |
| Shared Zod schemas for MCP, scheduler, pipeline, token usage | DONE |
| 35 migrations, 22 tables, WAL mode | DONE |
| Startup instrumentation — `[Startup]` / `[Reattach]` / `[Recovery]` log lines | DONE |
| Bundle splits — initial `index.js` ~1,026 KB (xterm, settings, workspace lazy-loaded) | DONE |
| Rust native module (ANSI stripper, status parser, git2 ops, 12 tests, Clippy-clean) | DONE |
| Open in IDE (vscode, cursor, zed, intellij, webstorm, custom) | DONE |
| Global hotkey Cmd+Shift+E to bring app to front | DONE |

---

## Backlog / Planned

Items from `docs/TASK_TODO.md` not yet started:

- **T65** Parallel multi-agent on isolated worktrees (P0 — must land before broad release)
- **T88** Ralph evaluator loops in pipelines (P2)
- **T71** Linear / Jira issue tracker integration (P2)
- **T73** SSH remote development (P3)
- **T92** Cross-repo workspaces — bind N projects to one workspace (P3)
- **T93** Mobile companion app — monitor agents from phone (P3, requires T94)
- **T94** Headless daemon mode — run without Electron, WebSocket transport (P3)
- **T97** Panel Plugin SDK — extensible panel system, community plugins (P3)
- **T45/T46** CI/CD release pipeline + canary channel (P3, activate when repo goes public)
