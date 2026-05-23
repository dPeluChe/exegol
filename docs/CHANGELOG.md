# Changelog

All notable changes to Exegol are documented here. This file is meant to be
release-oriented (what a user cares about per version), not a commit log.
For day-to-day development history, see `git log`.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/),
and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased] — Wave 1+2 stack optimizations, parallel multi-agent, settings window

Big batch of work landed in May 2026 across 5 parallel worktrees (Wave 1+2)
plus T120 settings window. Source: `docs/RESEARCH/TERAX_STACK_REVIEW.md` +
`docs/tasks_completed/2026_05.md`.

### Added

- **Settings as a separate window** (T120). `Cmd+,` now opens settings in its
  own `BrowserWindow` so you can tweak themes / API keys / fonts while still
  watching agent output. macOS App menu gains a `Preferences…` item. Tab
  deep-links available via `window.api.settings.open(tab)`.
- **Parallel multi-agent** (T65/T107). Spawn 2–3 agents on the same task,
  compare in a responsive grid (diff stat + score + cost + duration +
  scrollback tail per column), promote the winner with one click.
- **Worktree isolation badge** (T105). Color-coded chip in the terminal
  toolbar shows the agent's isolation mode (`isolated` / `pipeline` /
  `project-root` / `fallback`) with the branch name in the tooltip.
- **Agent stop-reason panel** (T106). When an agent exits, an overlay above
  the read-only scrollback shows status + exit reason + 12-line tail and
  offers Resume / New agent with same task / View diff actions.
- **OSC 7 + OSC 133 shell integration** (T112). The bundled `zsh` / `bash`
  helpers emit cwd updates and prompt boundaries; the terminal pane shows a
  cwd badge and exposes jump-to-previous-prompt.
- **DormantRing** (T115). 256 KB / 256-chunk bounded ring buffer for hidden
  panes so reattach picks up where the user left off without holding the
  full ANSI stream in memory.
- **Rust-powered file search** (T116). `ignore` + `grep-*` + `globset`
  crates exposed via napi-rs; `fsSearchRouter` handles fuzzy file search
  and content grep through Rust instead of node fs walks.
- **Window state persistence** (T121). Width / height / position survive
  restarts via `electron-window-state`.
- **Streaming markdown** (T110). `Streamdown` replaces `react-markdown` in
  the code viewer — no re-parse per chunk.
- **Diff cache** (T110c). `AsyncLruCache` with in-flight Promise dedup keyed
  by `projectId|kind|staged|pathOverride`; stage/unstage/commit invalidate
  per project. Repeated diff opens are free.
- **Model context registry** (T111). `tokenlens` integrated into the Tokens
  panel for per-model context-window badges.
- **Capability allowlist for IPC + tRPC** (T119). Every `ipcRenderer.invoke
  / send / on` and every tRPC path is gated by a declarative JSON allowlist
  shared between preload and the main process. XSS in the renderer can't
  reach a router that isn't on the list. See `docs/ARCHITECTURE/CAPABILITIES.md`.
- **CSP tightening** (T118). Dropped unused `cdn.jsdelivr.net`; added
  explicit `connect-src 'self'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`, `font-src 'self' data:`. `<webview>` `frame-src` /
  `child-src` left wide — annotated inline.
- **`path-guard` + `command-guard`** (T117). `assertSafePath` rejects bidi
  Trojan Source chars, NTFS Alternate Data Streams, `.env*`, `.ssh/`,
  `.aws/credentials`, GPG/keychain paths. `inspectCommand` refuses fork
  bombs, `rm -rf /`, `dd of=/dev/disk*`, `curl|sh`. Both side-effect free
  with parameterized test coverage.
- **Release packaging** (T103). `electron-builder.ts` owner/repo wired,
  release checklist at `scripts/release-checklist.md`.

### Changed

- **Settings rendering moved out of the in-app activeView**. `ActiveView`
  union no longer includes `"settings"`; a Zustand persist migration
  (`version: 2`) coerces stale values so upgrading users keep their sidebar.
  Sidebar gear / Command Palette / Cmd+, all route through the new IPC.
- **PTY flusher hardened** (T113). `SIGTERM` flushes pending output before
  killing the PTY; WebGL context-loss recovery uses a bounded retry budget.
- **Terminal pane split**. `TerminalPanel.tsx` decomposed into
  `TerminalToolbar` + `TerminalScrollback` + `TerminalFloatingButtons` +
  `use-terminal-lifecycle` (598 → 271 LOC; siblings ≤ 173 LOC).
- **Agent manager split**. `manager.ts` extracted worktree-setup + PTY
  invocation into `agent-spawn-flow.ts` (485 → 267 LOC).
- **TerminalInstance split** (425 → 253 LOC) into focused modules.
- **Vite bundle ops** (T108). `manualChunks` per family (xterm, monaco,
  react-vendor, radix, trpc); `esbuild.drop: ['debugger']` +
  `pure: ['console.debug', 'console.info', 'console.trace']`;
  `target: 'chrome134'` (Electron 41 native).
- **WT5 hygiene splits**. 6 monolith files > 500 LOC split (pure motion).

### Fixed

- **Sidecar reattach ordering**: snapshot is sent before live PTY data on
  reattach so xterm renders the scrollback in the correct order.
- **Pane state hygiene** (T112): `paneCwd` / `paneLastExit` scrubbed when a
  pane or tab is removed; OSC 7 spoof guard hardened against nested `133;A`
  and bare `133;D`.
- **`bash -l` dropped from agent spawn args** so `--rcfile` actually loads.
- **WebGL retry budget no longer halved** by a redundant DOM listener.

### Documentation

- `docs/RESEARCH/TERAX_STACK_REVIEW.md` — comparative architecture review.
- `docs/ARCHITECTURE/CAPABILITIES.md` — threat model + capability allowlist.
- `docs/agent_prompts/wt[1-5]_*.md` — per-worktree briefs used by the
  parallel multi-agent run.

---

## [0.4.4] — 2026-04-24 — QA hardening, FloatingBrowser extraction, spawn perf

### Added

- **QA `assert` action type**. Replay steps can now include DOM assertion checks;
  pass/fail is recorded per-step without triggering navigation.
- **Per-step alert + console error collection**. Each QA replay step now captures
  `alertsDetected` and `newConsoleErrors` independently — surfaced in step detail
  in the browser pane and QA Tests section.
- **`RUNNING_STATUSES` / `ACTIVE_STATUSES` shared constants** in
  `packages/shared/src/types/agent.ts`. Replaces scattered inline
  `new Set(["running", "waiting_input"])` literals across the renderer.

### Changed

- **FloatingBrowser extracted** from `FloatingPaneRoot.tsx` (517 → 103 lines).
  `IssueBubble` is now a shared sub-component used by both `BrowserPaneContent`
  and `FloatingBrowser`, accepting a minimal duck-typed `AgentRef { id, cliType }`.
- **QA replay post-step now concurrent**. `Promise.allSettled` runs DOM alert query,
  console error delta, and screenshot capture in parallel (was sequential).
- **Scroll steps skip post-step work**. Pure scroll actions bypass the 500ms delay
  and 3 IPC calls — no alert/error/screenshot collection needed for no-op scroll.
- **`scrollIntoView` before every click**. Ensures element is visible in the
  viewport before the replay driver clicks it.
- **`activateAgent` replaces 3 post-spawn DB writes**. Single
  `UPDATE agents SET pid=?, session_id=?, status='running'` issued after PTY spawn
  instead of three separate round-trips.
- **Login shell flag removed from agent spawn**. `_getFullPath()` already captures
  full PATH at startup; `PATH` is now injected explicitly in the agent env, making
  the `-l` flag redundant. Saves ~100-150ms dotfile load per agent spawn.

### Fixed

- `designAutoStopRef` / `startTimerRef` timer leaks in `BrowserPaneContent` on
  unmount.
- `WorkspacePane` stale-closure: event listener now uses a ref-stable callback.
- `noArrayIndexKey` biome errors in alert/console-error step-detail lists.

### Internal

- API key cache (`Map<string, string | null>`) in `security/keystore.ts` —
  `safeStorage.decryptString` runs once per session per provider.
- Lifecycle config cache (`Map<string, LifecycleConfig | null>`) in
  `lifecycle/loader.ts` — eliminates duplicate file reads on repeated spawns.
- `INTERACTIVE_TAGS` / `INTERACTIVE_ROLES` RegExp hoisted to IIFE scope in
  `qa-recorder.ts` — no re-compilation per click event.
- 64 new unit tests (T58/T70/T90/T101/T102); biome + typecheck + build clean.

---

## [0.4.3] — 2026-04-23 — Activity tab chrome, access mode badge, pipeline mode propagation

### Added

- **Activity dot in tab chrome** (T70). `WorkspaceTabBar` now shows a 1.5px
  colored dot after the tab label when the primary pane hosts a running agent.
  `busy` = pulsing green, `idle` = amber, `neutral` hidden. Dot uses
  `activityLevel` from the agent store (derived by `classifyActivity` on every
  push event). Zero re-fetch — pure store subscription.
- **Access mode badge in terminal toolbar** (T58). When an agent was spawned
  with `read` or `plan` access mode, a colored pill ("read-only" / "plan-only")
  appears in the live terminal toolbar alongside the chat-toggle button.
  `write` mode (default) shows nothing — no noise for the common case.
- **Pipeline step access mode** (T58). `PipelineStepDef` gains an optional
  `accessMode` field. The pipeline executor passes it through `createAgent` +
  `manager.spawn` so plan-step or read-step agents get their mode injected into
  the prompt prefix automatically. `PipelineTemplateEditor` exposes a per-step
  mode selector ("write" / "read" / "plan").

---

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
