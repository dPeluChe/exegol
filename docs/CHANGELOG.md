# Changelog

All notable changes to Exegol are documented here. This file is meant to be
release-oriented (what a user cares about per version), not a commit log.
For day-to-day development history, see `git log`.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/),
and the project follows [Semantic Versioning](https://semver.org/).

## [0.4.2] — 2026-04-23 — QA automation, DI context, chat view, virtual scrolling

### Added

- **Design Mode + QA Test Automation** (T102). Browser pane extended with two
  new modes. Design Mode (crosshair icon) clicks any element in the webview and
  captures its selector, computed styles, and surrounding HTML — formatted for
  injection into agent context. QA Test Mode (bug icon) records click/input/
  keypress/navigate flows, replays them step-by-step with screenshot capture,
  persists results to DB, and shows pass/fail per step. `stopOnFail` toggle.
  `QaTestsSection` in the Project tab lists saved tests with run history.
- **Terminal ↔ Chat Dual View** (T90). Toggle button on both live and stopped
  terminal panes switches between raw terminal output and a clean conversational
  view. Live sessions serialize xterm content on toggle; stopped sessions read
  from DB scrollback. Provider-aware parser detects user prompts, agent output,
  and system messages.
- **Virtual Scrolling for Memory List** (T59). `MemorySection` uses
  `@tanstack/react-virtual` with `measureElement` for variable-height cards.
  Renders only visible rows; handles large memory stores without layout jank.

### Changed

- **DI for tRPC singletons** (T81). `createContext()` now injects
  `agentManager`, `providerRegistry`, `pipelineExecutor`, `schedulerEngine`,
  and `mcpHost` into the tRPC context. All five procedure files (`agents`,
  `scheduler`, `pipeline`, `resources`, `mcp`) use `ctx.X` instead of calling
  global getters, making procedures testable with injected mocks.
- **Magic number extraction** in `BrowserPaneContent`. Three inline literals
  promoted to named module constants: `DESIGN_POLL_INTERVAL_MS = 300`,
  `DESIGN_AUTO_STOP_MS = 60_000`, `QA_NAV_DELAY_MS = 800`.

---

## [0.4.1] — 2026-04-12 — Parallel agent wave

Six tasks completed by 3 parallel Claude Code agents running in Exegol.
Test count: 142 → 210 (+68 new tests).

### Added

- **Pipeline State Machine** (T78). Typed transition map with terminal
  states. `assertTransition()` guards in executor log warnings on
  invalid transitions without crashing. 32 new tests.
- **Shared Schema Enrichment** (T82). Zod schemas for MCP tool calls,
  scheduler create/update, token usage summaries, pipeline transitions.
  Inline duplicates in tRPC procedures replaced with shared imports.
- **Structured Error Classification** (T80). `ExegolError` hierarchy:
  `TransientError`, `PermanentError`, `TimeoutError` with cause chain.
  `withRetry()` with exponential backoff. 19 tests.
- **Lifecycle Scripts per Repo** (T91). `.exegol/lifecycle.yaml` for
  `setup`, `beforeAgent`, `afterCommit`, `teardown` hooks. Wired into
  agent spawn + worktree cleanup. 17 tests.
- **Focus-Aware Panel Targeting** (T95). New panes open next to the
  focused pane. Falls back to first pane when nothing is focused.
- **Diff Review with Line Comments** (T69). Inline comments on diff
  lines. DB-persisted with add/delete/resolve toggle. Per-file lazy
  fetch + optimistic updates.

---

## [0.4.0] — 2026-04-12 — Infrastructure wave

This release builds the intelligence layer: project indexing with local
Ollama embeddings, semantic search CLI, agent attention monitoring, DB
validation, and several productivity quick wins.

### Added

- **Review Inbox / Agent Monitor** (T57). Sidebar shows running agents
  grouped by project with unique animated spinners per agent (10 preset
  animations — braille wave, moon phases, heartbeat, etc). Below the
  running agents, an "attention" section shows agents that need review:
  crashed, waiting input, completed. Cards support mark-read, pin,
  dismiss, and navigate-to-pane.
- **Project Indexing** (T100). Background indexer scans project files,
  chunks them (500-line overlap), generates embeddings via local Ollama
  (`nomic-embed-text`), and stores in SQLite. Incremental: only
  re-indexes files whose SHA-256 hash changed. Fully async FS.
- **Semantic Search** (T68). `exegol search <query>` CLI command +
  `indexer.search` tRPC procedure. Brute-force cosine similarity over
  stored embeddings. CLI resolves project from CWD, prints top-5
  results with file path, line range, score, and preview.
- **Exegol CLI** (T89). New `packages/cli/` package. Commands:
  `exegol status` (active agents), `exegol projects` (all projects),
  `exegol search <query>` (semantic search). Reads the Electron DB
  directly (read-only).
- **Bang commands** (T96). Type `!command` in the Command Palette
  (Cmd+K) to run a shell command in a new terminal tab. Waits for
  shell-ready signal (first PTY data event) before injecting.
- **Agent access modes** (T99). `accessMode: "read" | "write"` field
  on agents. Read mode is for explore-only sessions (no git writes).
  DB migration 029.
- **Ollama Settings validation**. Settings → General shows Ollama URL
  + model inputs with a "Verify Connection" button that checks
  availability + model installed. Green/amber/red indicators with
  install instructions. Persisted in Settings (survives restart).

### Changed

- **DB row validation** (T77). 14 Zod schemas for all DB row types.
  `parseRow()` helper validates at the query boundary with graceful
  degradation (logs on failure, doesn't crash). All 7 mapper functions
  rewritten.
- Agent store: `unreadAgents` map removed — unread state derived from
  `attentionItems`. `unreadAttentionCount` cached as O(1) field.
  `getSortedAttention()` moved from store getter to `useMemo` in
  component to avoid new-reference-on-every-render.
- Project indexer uses async `fs/promises` instead of sync
  `readdirSync/readFileSync` to avoid blocking the main process.
- `cosineSimilarity` extracted to `packages/shared/src/lib/cosine.ts`
  (shared between main process and CLI).

### Fixed

- Bang command `setTimeout(500ms)` replaced with shell-ready detection
  (listens for first PTY data event + 2s fallback with guard).
- Ollama URL + model were local `useState` (lost on settings close).
  Now persisted in the Settings type with auto-save.

---

## [0.3.0] — 2026-04-10 — Pre-launch polish wave

This release finishes the T83-T87 pre-launch polish tasks plus a wide set
of UX and stability fixes surfaced during testing. It is the first release
that bundles Nerd Fonts, ships the Smart Git Button, and supports floating
Picture-in-Picture panes.

### Added

- **Smart Git Button** in GitPane (T83). Context-aware action button with
  11 states — commit, push, create PR, merge PR, install gh CLI, etc. The
  commit input has a Sparkles button that generates a conventional-commit
  message from the current diff via Claude Haiku.
- **Picture-in-Picture pane float** (T84). Any terminal or browser pane can
  be detached into a frameless always-on-top window. Terminal floats share
  the PTY with the main process via the existing ring buffer. Browser
  floats have their own back/forward/reload + DevTools toggle. The source
  pane shows a "Floating" placeholder with a Return button.
- **Layout presets** (T85). Six built-in presets (Single, Split Horizontal,
  Split Vertical, Three Columns, Bottom Terminal, 2×2 Grid) available from
  a new dropdown in the tab bar. Bottom Terminal auto-spawns a shell agent
  in its bottom slot.
- **Save current layout** as a named custom preset. Templates capture each
  slot's pane type + url + filePath so applying a saved layout to a fresh
  tab recreates equivalent panes, not empty ones.
- **First paint optimization** (T86). Deferred non-critical main process
  subsystems, added `startMark`/`endMark` instrumentation (`[Startup]`
  dbInit / criticalPath / windowCreated / firstPaint log lines), single-log
  guarded so re-creating the window doesn't re-emit bogus timings.
- **Renderer bundle audit** (T87). Lazy-loaded workspace sections, the
  entire terminal stack (xterm + addons), SettingsPanel, ProjectList,
  CommandPalette, and FloatingPaneRoot. Initial `index.js` dropped from
  1,987 KB to 1,026 KB (−48%).
- **Bundled Nerd Fonts** (~6.8 MB): MesloLGS NF, FiraCode Nerd Font Mono,
  JetBrainsMono Nerd Font Mono. Shipped as `.ttf` assets loaded via
  `@font-face` in `styles/fonts.css` so no system install is required.
  Non-bundled Nerd Fonts (Hack, Iosevka, Cascadia Code, etc.) still appear
  in the recommended list with install links.
- **Terminal settings UX rewrite**. Top card with Font Size input + Font
  Family as clickable badges + inline preview. Bundled vs External groups
  below with per-card preview rendered in each font's own face. Click a
  non-primary badge to promote it; click × to remove. `monospace` is
  displayed as "System default".
- **Browser pane navigation**. Back, Forward, and Reload buttons in the
  URL bar plus a friendly empty state with a Retry button when the URL
  fails to load.
- **Custom macOS app menu**. Cmd+W now closes the focused pane (or the
  tab if it's the last pane), not the entire window. Cmd+Q still quits.
  Cmd+T opens a new tab.
- **Workspace as default view**. New `useAutoSelectProject` hook picks the
  first project on cold start if no valid active project is persisted, so
  users land in the workspace instead of the project list.
- **docs/BENCHMARKS.md**, **docs/CHANGELOG.md** (this file), and expanded
  `TASK_TODO.md` with the post-launch competitor backlog (T88-T94).

### Changed

- **Sidecar protocol bumped to 1.1.0**. New `session.listInfo` RPC returns
  `{ id, alive, exitCode, signal }` so the main process can distinguish
  live PTYs from exited-but-still-buffered sessions (the 60s grace period).
  Existing 1.0.0 sidecars are auto-shutdown and respawned at startup.
- `agents.stop` / `getStatus` / `updateStatus` / `get` are now idempotent —
  they return `null` instead of throwing NOT_FOUND when the agent was
  deleted, eliminating the "Agent X not found" console spam during close.
- `projects.get` returns `null` for stale persisted `activeProjectId`
  instead of throwing. A new renderer hook then auto-switches to another
  project (or clears to the list if no projects exist).
- Workspace store `applyLayoutPreset` now returns `{ terminalsToSpawn }`
  so the caller can orchestrate shell agent spawns for terminal slots.
- Font family comparison is now case-insensitive and quote-agnostic so
  `"MesloLGS NF"` and `meslolgs nf` are treated as the same family when
  adding/removing from the fallback chain.

### Fixed

- **Dead sidecar sessions stuck as "running"**. Previously the broken
  `isAlive()` check left agents in an unrecoverable state where the
  renderer rendered a terminal bound to a dead PTY. Now dead sessions fall
  through to `recoverStaleAgents()` and are properly marked as crashed.
- **Terminal stuck on "Starting crush..." after reattach**. `TerminalPanel`
  now probes `getSnapshot` on mount and treats non-empty ring-buffer
  content as "has data", so the loading overlay hides immediately on
  reattach even if the PTY is silent.
- **Layout presets dropdown clipped** by the tab row's `overflow-x-auto`.
  Moved the dropdown trigger outside the scrollable tab container.
- **`terminal:get-snapshot` IPC handler crashed** with a
  `Cannot find module './terminal/pty-host'` error due to a lazy
  `require()` that didn't resolve in the bundled main process. Replaced
  with the top-of-file import.
- **Ctrl+W on macOS hijacked native text-editing shortcuts**. Platform-
  aware modifier — metaKey on macOS, ctrlKey on Windows/Linux.
- **Custom layouts applied to fresh tabs showed only empty panes**.
  `templateFromLayout` now captures per-slot type metadata so the
  transformation can recreate equivalent panes instead of falling back
  to empty.
- **Floating browser DevTools opened below the window**. DevTools is now
  targeted at the webview's webContents (not the React shell), and the
  floating window temporarily drops `alwaysOnTop` while DevTools is open
  so the detached window is visible.
- **Font Remove button missing** for fonts in the chain but not installed
  (e.g., SF Mono on a machine without it). Action priority is now
  isActive → Remove, installed → Use, url → Install.
- **firstPaint re-logged on window recreation** (149902ms bogus). Now
  single-log guarded.
- **Nerd Font dev icon codepoints** for node/python/swift in the preview
  were wrong. Fixed to the canonical nf-dev-* codepoints.

### Migration notes

- **Saved custom layouts from earlier builds** will work but will produce
  empty panes on apply because they have no `slotTypes`. Re-save the layout
  from the current tab to get the new per-slot type metadata.
- **Running a 1.0.0 sidecar in the background** will trigger an automatic
  shutdown + respawn on first launch of 0.3.0. Any in-flight PTY sessions
  in that sidecar will be lost. Normal launches after the upgrade are
  unaffected.

### Known limitations

- Recovery logs (`[Startup]`, `[Reattach]`, `[Recovery]`, `[PaneRecovery]`)
  are intentionally verbose. They'll be tuned to debug-only once we've
  accumulated more confidence in recovery stability in the wild.
- Packaged DMG first-paint hasn't been re-measured since the v0.3.0
  bundle. Dev-mode first paint is 277-391 ms on an M1 Pro; packaged
  builds should be faster because they skip the vite dev server.

---

## [0.2.0] — 2026-03-xx — Sidebar + quickwins

Previous release. See `git log v0.1.0..v0.2.0` for details.

## [0.1.0] — 2026-03-xx — Initial release
