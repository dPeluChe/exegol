# Exegol

> Working in this repo: the rules for every contributor and agent are in [AGENTS.md](AGENTS.md)
> (short) and [CONTRIBUTING.md](CONTRIBUTING.md) (people). This file is the architecture reference.

Electron + React + Rust desktop app for orchestrating AI coding agents.

## Tech Stack

Electron 41 · React 18 · TailwindCSS 4 · Rust (napi-rs + memchr) · libSQL · tRPC 11 · xterm.js 6 · Monaco Editor · Zustand 5 · Bun · Turborepo · Biome 2.4.7

## Development

Releases: macOS builds are signed + notarized (`APPLE_KEYCHAIN_PROFILE=<notarytool profile>`), Linux
AppImage/.deb come from `.github/workflows/linux.yml` on each published release, installed apps
auto-update (title-bar button). Steps: `docs/GUIDES/RELEASE.md`.

```bash
bun run dev              # Build Rust + start Electron (full pipeline)
bun run dev:fresh        # + restart the PTY sidecar (see below)
bun run dev:ui           # Electron only (JS fallback, faster)
bun run kill:dev         # Stop a stuck dev Electron (keeps the sidecar + agent sessions)
bun run build:rust       # Build Rust native module only
bun run rebuild:native   # Rust + rebuild node-pty for Electron

# The PTY sidecar is DETACHED: it survives app restarts on purpose (that is what
# keeps agent terminals alive across a reload) and therefore survives a rebuild
# and an app UPDATE too — the running process keeps the old code.
#
# The mechanism that handles this is SIDECAR_VERSION in pty-sidecar-protocol.ts:
# on a mismatch, discovery shuts the old sidecar down and spawns a fresh one.
# So after changing anything the sidecar bundles (the file list is in the
# SIDECAR_VERSION comment) BUMP SIDECAR_VERSION. Skip it and the fix never loads,
# for released users as well as in dev.
#
# `dev:fresh` is only the manual escape hatch for when you don't want to bump
# (mid-debugging). Either way every live PTY dies and agents return as crashed.

# Lint + typecheck + tests:
bun run lint             # pinned Biome 2.4.7, fails on warnings
bun run typecheck
bun run test && bun run test:shared

# Rust:
cd packages/core-rust && cargo check && cargo test && cargo clippy
```

## Architecture

### Dashboard + workspace (3 tabs + sub-tabs)
- **Dashboard**: its own view (`activeView: "dashboard"`, sidebar button) overlaying the workspace, cross-project fleet + Watching (T194). No project is selected while it shows; picking one lands on its Agents tab. Panes stay mounted (same size) behind it. With sessions pinned it shows only Watching; "Show all agents" reveals the fleet
- **Agents**: multi-pane workspace (terminal, browser, files, git, empty)
- **Project**: Tasks | History | Prompts & Skills | Memory | Knowledge | Pipelines | Parallel Runs | QA Tests
- **Monitor**: Resources & Tokens | Scoring

### Pane types
- `terminal` — agent CLI or plain `$SHELL`
- `browser` — Electron webview with URL bar + back/forward/reload
- `files` — FileExplorer + Monaco code viewer
- `git` — Changes (with Smart Git Button) + Diff + Oplog (agent operations with undo)
- `empty` — responsive agent launcher grid (3 breakpoints)

### Layouts (T85, v0.3.0)
- **6 built-in presets**: Single, Split Horizontal, Split Vertical, Three Columns, Bottom Terminal (70/30 with auto-spawned shell), 2×2 Grid
- **Custom saved layouts**: capture the current tab as a reusable template with per-slot type + url + filePath, persisted in the workspace store
- **Equalize splits** action via pane context menu
- **Pure-function helpers** in `lib/layout-presets.ts` (`computePresetTransformation`, `templateFromLayout`) so the store just applies the result

### Picture-in-Picture (T84, v0.3.0)
- Any terminal or browser pane can detach into a frameless always-on-top BrowserWindow
- Main process manages `floatingWindows: Map<paneId, BrowserWindow>` in `main/windows/floating.ts`
- Renderer routes on `?floatingPane=...` query: main window mounts `<App/>`, floating windows lazy-load `<FloatingPaneRoot/>`
- Terminal float shares the PTY via ring buffer + snapshot replay — only one xterm instance attached at a time (original pane shows a "Floating" placeholder)
- Browser float has its own back/forward/reload + DevTools toggle (drops alwaysOnTop while DevTools is open so the detached window is visible)
- IPC round-trip: `floating:open`, `floating:close`, `floating:self-close`, `floating:self-devtools`, `floating:closed` (notification back to main window)

### Settings window (T120, 2026-05)
- Settings live in a standalone BrowserWindow (`main/windows/settings.ts`) so users can tweak themes/API keys/fonts while watching agent output
- Tabs include **Dictation** (T201 phase 2: shortcut recorder, mic status, limits, history) and **Models** (T201: speech model catalog, download/cancel/delete/default, `models` router + `models:progress` push) and **Storage** (`system/storage.ts`: async walk with a shared fs limiter, cached 30s; open folder, clear screenshots, clear rotated logs, delete a model, clear a project partition's cache; worktrees shown only)
- Renderer routes on `?settings=1` → lazy `<SettingsRoot/>` (own QueryClient + TooltipProvider + useTheme)
- Lifecycle bound via `mainWindow.on("closed")` — intentionally NO `parent:` (would propagate minimize/hide on macOS) and NO `alwaysOnTop`
- Cmd+W routed by `app-menu.ts#handleCloseAccelerator`: settings/floating URLs close the window directly; main window receives `menu:close-pane`
- macOS App submenu has a `Preferences… (Cmd+,)` item that works regardless of focused window
- Cross-window sync: `settings:broadcast-changed` IPC fans out from the settings window; main window's `use-settings-sync` hook invalidates `['settings']` so theme/font changes are immediate
- Deep-link API: `window.api.settings.open(tab?)` — URL gets `?settingsTab=<tab>`; existing window receives `settings:navigate` event queued until `did-finish-load` if mid-load
- IPC channels: `settings:open`, `settings:self-close`, `settings:navigate`, `settings:broadcast-changed`, `settings:changed`

### Smart Git Button (T83, v0.3.0)
Context-aware git action button in GitPane with 11 states:
- conflicts → Resolve (disabled, hint)
- dirty + no message → Commit N files (disabled, hint to write message)
- dirty + message → Commit N files
- clean + ahead → Push N
- clean + no upstream → Push New Branch
- clean + no PR + gh installed → Create PR
- clean + PR open + mergeable → Merge PR (success color)
- clean + PR not mergeable → View PR on GitHub (warn)
- clean + PR merged/closed → terminal state (muted)
- clean + no PR + no gh → Install gh CLI (opens cli.github.com)
Commit input has a Sparkles button that generates a conventional-commit
message from the current diff via Claude Haiku (reuses Anthropic API key).

### PTY Sidecar Architecture
- **Sidecar process**: standalone detached Node.js process (`pty-sidecar-entry.ts`), survives window reload/crash
- **JSON-RPC over Unix socket**: `~/.exegol/pty-sidecar.sock` for control, NDJSON framing
- **Ring buffer**: 8MB circular buffer per session, stores raw ANSI output for instant reconnect
- **Discovery**: PID file at `~/.exegol/pty-sidecar.pid`, reuse existing or spawn new
- **Fallback**: if sidecar fails, falls back to legacy per-session subprocess mode transparently
- **Reconnection**: on app restart, `reattachSidecarAgents()` rebuilds callbacks + replays ring buffer snapshot

### Agent lifecycle
1. User clicks agent in launcher/grid/quick-bar (all read from provider registry)
2. `AgentManager.spawn()` → resolves provider → builds context (memory + MCP + skills) → spawns PTY via sidecar
3. PTY output → sidecar ring buffer → JSON-RPC notification → main process → Rust `AgentOutputStream` (ANSI strip + status parse) or JS fallback
4. Status broadcast via IPC push events → Zustand store → UI
5. On exit: final output tail → scoring → oplog → worktree cleanup, skipped while another live agent shares it (all non-fatal). Memory extraction on exit is currently not wired (T193.8)
6. Close pane/tab/Cmd+W → stop agent + archive (`archiveAgent` sets `archived_at`; `listAgents` hides it) + remove from store. Shell rows are still deleted
7. Window reload → sidecar keeps PTY alive → app reconnects on restart

### Multi-agent pipelines
Sequential agent orchestration in shared worktrees. Exegol controls everything — agents never launch each other.
1. User creates pipeline template (steps: provider + role + prompt template + optional accessMode)
2. `PipelineExecutor.startRun()` → creates shared worktree → `advanceStep(0)`
3. Each step: build prompt ({{task}}, {{diff}}, {{previousOutput}}) → spawn agent with `cwdOverride`
4. `onAgentComplete` callback → capture git diff + scrollback → evaluate: advance / loop-back / pause
5. Loop mechanism: review→fix cycle with `loopBackTo` + max iterations guard
6. On complete/cancel: cleanup worktree if clean, preserve if dirty
7. Crash recovery: `recoverStalePipelineRuns()` marks running pipelines as paused on startup
8. **State machine** (T78): `state-machine.ts` defines `PIPELINE_TRANSITIONS` map, `canTransition()`, `assertTransition()` — guards in executor reject invalid transitions with warning log
9. **Evaluator gate** (T88v2): step type with `evaluator` def — N two-pass Haiku judge calls → score distribution → ship/hold/retry policy. Gate-cycle guard, all-judges-failed → hold, resume-after-hold = human approval, `{{retryFeedback}}` template var
10. **Evidence** (T130): per-step score + background AI diff summary in `stepResults`; `pipeline.exportRunReport` builds a markdown report
11. **Oplog v2** (T129): `prepareStepSnapshot`/`commitStepSnapshot` wrap each step — git-tree snapshots on hidden ref `refs/exegol/oplog` (GitButler model), restore refuses cross-worktree + takes a PreRestore safety snapshot first

### Provider registry
14 built-in providers (Claude Code, Codex, Gemini, Antigravity, Devin, Aider, Goose, OpenCode, Amp, Kiro, Kilo Code, Crush, Factory Droid, Terminal/shell) + custom, in `agents/registry.ts`. Each has: `supportsPromptArg`, `promptFlag`, `enabled`. `supportsPromptArg: false` (launch without prompt injection): Gemini, Aider, OpenCode, Kiro, Kilo Code, Crush, shell.

### Key patterns
- **tRPC over IPC**: 37 routers in main process (`ipc/router.ts`), renderer calls via `window.api.trpc.invoke`
- **Push-first**: `broadcastAgentStatus()` IPC events, polling reduced to 30s fallback
- **Structured errors** (T80): `ExegolError` → `TransientError` / `PermanentError` / `TimeoutError` hierarchy with `cause` chain. `isTransient()`/`isPermanent()` type guards. `withRetry()` helper retries only on transient errors with exponential backoff (1s base, max 3). MCP disconnect and scoring API errors classified as transient.
- **Lifecycle scripts** (T91): `.exegol/lifecycle.yaml` (or `.yml`) per repo with `setup`, `beforeAgent`, `afterCommit`, `teardown` hooks. Setup runs once per session per project on first agent spawn. beforeAgent prepended to shell command. Teardown awaited before worktree deletion. Simple line-based parser (no YAML library).
- **Crash recovery**: `session.listInfo` RPC returns `{ id, alive, exitCode, signal }` — only ALIVE ids go to `reattachSidecarAgents()`, dead ones (in the sidecar's 60s grace period) fall through to `recoverStaleAgents()` and get marked as "crashed" with scrollback preserved (v0.3.0 fix: previously dead sessions were stuck as "running" with no PTY)
- **Dashboard watch list** (T194): pinned sessions (global, `stores/watch.ts`) render as interactive `TerminalInstance mirror` views (plain mirrors by default; fit is opt-in per card, watch persist v1 reset old `cardFont`): full-height cards, `columns` (1-3) per row, collapsed ones as vertical strips in their row, drag to reorder, max `MAX_OPEN_MIRRORS` (6) open, wheel scrolls the page unless the mirror is focused. A−/A+ and "fit session to card" (`cardFont`): the card then sizes the PTY like a pane (still input-filtered); the last view shown owns the size (pane reclaims on the workspace refit, card on mount). A mirror never resizes the PTY (renders at `terminal:get-size`, follows `terminal:resized`, fits its font to both dimensions with a terminating rule) and strips terminal query replies from its input (`mirror-input.ts`) so the owning pane stays the only responder.
- **Shortcuts**: Cmd+1 Dashboard; Cmd+2..9, 0 via `goToShortcut` (`lib/live-tabs.ts`): always a project, shown as left (`showProject`): numbers set in Edit project (`stores/shortcuts.ts`, freed on project delete) first, then one per project with live tabs in sidebar card order (`assignProjectShortcuts`), all-pinned projects last; the badge sits on the project's sidebar card. A project switch restores its `activeTabId` and `lastFocusedPaneId` (`switchProject` in `stores/workspace/helpers.ts`). Reset Zoom is Cmd+Shift+0. Cmd+] / Cmd+[ cycle panes (`lib/pane-focus.ts`). Ctrl+Tab is the pane switcher (`lib/pane-switcher.ts` pure parts, `lib/pane-switcher-control.ts` window-capture keys, `PaneSwitcher` overlay): quick press = previous pane from the per-project MRU (module Map in `pane-switcher-control`, in memory), held = overlay; the terminal key handler lets Ctrl+Tab through and main forwards it from webviews (`windows/pane-switcher-keys.ts`); floating windows have no switcher, so xterm keeps Ctrl+Tab there; navigation ends in `focusActivePane()`. Overlay list: `lib/shortcuts.ts`
- **Context menus**: position through `useFittedMenu` (`lib/fit-menu.ts`), measured before paint, flipped up/left near the window edges
- **Platform keys**: shortcuts are written in macOS notation; `lib/keymap.ts` maps them: Cmd on macOS, Ctrl+Shift on Linux/Windows (Ctrl alone is the terminal's), a Shift/Option variant → Ctrl+Shift+Alt. `appChord`/`chordKey` in `use-hotkeys` and the terminal key handler (which lets app chords through and copies on Ctrl+Shift+C); `appKeys`/`editKeys`/`chordBadge` for every label
- **CLI catalog**: `agents/cli-catalog.ts` is the one table of per-CLI facts the registry does not hold: install/update per OS (`cliSetupFor`), newest-release source, renamed binaries (`COMMAND_ALIASES`, `providerBinaries`). "Installed" is one check, spawn's `commandOnPath` (stat per PATH dir): the launcher and Settings (`withInstallInfo` on both provider lists) and preflight all use it; Doctor also runs `which -a` to list duplicate installs
- **CLI updates**: `system/cli-versions.ts` holds the `--version` reader (cached by binary mtime) and the newest release (npm registry or PyPI, cached 6h, silent offline). `agents.cli_version` is recorded at spawn; `doctor.cliUpdates` + `useCliUpdates` drive the toolbar's Restart to update / Update; `useCliRestarts` (App) restarts pending sessions once not running (or, queued as "update", once the newer CLI is installed): Suspend + Resume in the same pane, which carries model, YOLO, access mode and alias. `CliUpdatesNotice` (after load, never the splash) offers the updates of the CLIs in use
- **Terminal sizing** (T194): panes use the addon's floored fit in a `min-h-0` box, skip unmeasured fits, and coalesce PTY resizes (80ms); main drops same-size resizes, keeps a size sent before reattach (`PtyHost.pendingSizes`), stores each agent's last grid (`agents.pty_cols/pty_rows`) so reattach rebuilds the model at it, and `terminal:redraw` repaints a TUI by jiggling the PTY without telling mirrors (kick: alt-screen only, once per session). Visibility is tracked per view (`windowId:viewId`); a view's first report skips the RIS repaint.
- **Release notes**: `system/release-notes.ts` reads the public GitHub releases (cached 10 min, silent offline); `updates` router: `notes` (running → found version, skipped ones included), `whatsNew` once after an install (`lastSeenVersion` setting; a fresh install shows nothing), `markSeen`. The update button opens them by itself only after a manual check
- **Bug reports** (T196): title-bar bug button → `diagnostics` router (`system/diagnostics.ts`). Collected once per dialog and shown for review (the issue is public): versions, Doctor, agent counts, this session's log, previous sessions' warnings/errors, `sidecar.log`. Exegol's own log lines never carry prompts or agent output (spawns log `commandShape`, status lines drop the step); `redact()` handles third-party text: keys/tokens, URLs, emails, IPs, and paths made generic. Files via `gh issue create` or a prefilled issue URL + clipboard. Main crashes, renderer errors (`log:renderer-error`, deduped and capped) and child-process deaths all go through `logger`.
- **Activity level** (T70): `classifyActivity(status, step)` derives `busy | idle | neutral` from agent status on every push event. `AgentState.activityLevel` drives the pulsing dot in tab chrome (`WorkspaceTabBar`) and `StatusDot` pulse suppression.
- **Access modes** (T58): agents spawn with `accessMode: read | write | plan`. `buildShellCommand` prepends a system instruction; `EXEGOL_ACCESS_MODE` env var is set. Pipeline steps inherit per-step `accessMode` from `PipelineStepDef`. Badge shown in terminal toolbar for non-write modes.
- **Deterministic signals** (T123): Claude Code hooks (per-agent `~/.exegol/hooks/<id>.json` via `--settings`) printf OSC-777 to `/dev/tty` and drop file events in `~/.exegol/events` (NotifyHandler; the path verified to deliver for claude-code) → Rust/JS FSM in the output path emits `agent:signal` events (`AGENT_SIGNAL_TYPES` whitelist in `packages/shared/src/types/agent-signals.ts`). Scraped parser stays as fallback (`source: "parser"`). Stop = turn boundary (no notification); Notification hook = attention, matched to `permission_prompt|elicitation_dialog` (`CLAUDE_ATTENTION_NOTIFICATIONS`): the 60s `idle_prompt` reminder is no question.
- **NotificationBus** (T124): `main/notifications/bus.ts` — channels implement `deliver(event)`; desktop channel (Electron Notification + dock badge) registered by default; `resource:warning`/`budget:warning` emitters in T143/T147. Attention notifications include the scrollback-tail pending question (OSC-stripped).
- **Knowledge node** (T140): opt-in `.exegol/knowledge/` (committed PROJECT.md + gitignored DIGEST.md + synced MEMORY.md) + managed marker block in AGENTS.md/CLAUDE.md. `knowledge.get` is strictly read-only; file creation only via `knowledge.initialize`. Digest via `trs digest` (execFileSync) with internal fallback.
- **Exegol MCP server** (T145): Unix socket (`~/.exegol/mcp-server.sock`, chmod 600) + stdio shim written into the agent's `.mcp.json`. Identity = per-agent token (`EXEGOL_MCP_TOKEN`) minted at spawn, revoked on exit; server derives accessMode from DB per call, client claims never trusted. 25 tools (`exegol-protocol.ts`): memory_search, memory_list, memory_save, knowledge_get, agents_list, agent_send, message_status, message_cancel, messages_check, claim_paths, release_paths, list_claims, agent_link, plus the 12 agent browser tools below. Shells skip. Connection state per agent (`connected | not_connected | not_wired`, `getMcpAgentStates`) is pushed on `mcp:status` on connect/disconnect/token changes (`agents.mcpStatus` for the first read): plug in the terminal toolbar and Dashboard card, opt-in `mcp` status bar widget.
- **Agent browser** (`main/browser/`): agents drive the project's own browser panes. Each project's webviews use `persist:project-<id>` (`browserPartitionFor`); `will-attach-webview` strips preload/node, refuses any other named partition and hooks the session. Cookies: a one-time upgrade copy (global flag `browser_partition_cookies_upgrade_done`) gives projects that existed the default session's local + allowed-host cookies; projects created later are marked migrated at creation; a host added to the allowlist later copies that host's cookies (`copyCookiesForHosts`). Panes register on `did-attach` (`browser:register-pane`, `useRegisterBrowserPane`) and main accepts only a webview hosted by the sender (`isHostedWebview`) AND in that project's partition; a destroyed webview is forgotten (`forgetPane`: state pushed with `closed`, waiters get `pane_closed`). URL policy (shared `checkAgentUrl`, `isOutsideAllowlist`, `hostOf`): http(s) on localhost/127.0.0.1/[::1]/*.localhost + `projects.browser_hosts` (`.local` is opt-in there); a page outside it returns `needs_user` and no content. While an agent is acting (`isAgentActing`: recent action, not taken over, not waiting, no needs-user) the session's `onBeforeRequest` cancels requests outside local + allowlist (`request-guard.ts`) and `will-frame-navigate` is refused; popups never open windows (same pane only if allowed). Action and eval scripts carry the host inspect checked and throw `exegol:page_changed` if `location.host` differs, in the same task. Refs are `e12.<docid>` so a ref from another document is `stale_ref`. Tool output from the page sits under `untrusted_page_content`. Files: `agent-browser-tools.ts` (dispatch), `tool-guards.ts` (host, pane resolution, inspect, URL checks), `tool-handlers.ts` (one per tool, waits), `control.ts` (driver/take-over/wait state pushed on `browser:agent-state`), `page-scripts.ts` (isolated world 1337; signals script for actions, snapshot capped at 250 elements and 8KB text in the page), `needs-user.ts`, `log-ring.ts`, `electron-host.ts`. read/plan get list, open (new pane only), snapshot, screenshot (JPEG ≤1280px, `~/.exegol/screenshots` chmod 700, pruned to a day / 50), logs (third-party URLs without query), wait_for_user (25s polls; a new reason, a passed deadline or >30s without a poll starts a fresh wait); write adds navigate, click, type, press, select and eval (opt-in per project, `projects.browser_eval`). Password refusal is a hint, not a control. Hand back with no waiting agent queues a follow-up to it; token revoke clears the agent's waits and flags. Actions go to `agent_events` (`browser_action`: tool, pane, host, outcome).
- **Memory salience v2** (T126): `similarity × log(reinforcement+1) × exp(-0.693·days/30)`; re-observed facts reinforce, contradictions supersede (transactional, deindexed); recall = hybrid FTS5+Ollama RRF (T125) with one-time backfill + LIKE fallback.
- **Ring-buffer eviction** (T143): global cap with LRU eviction of idle sessions to disk — `RingBuffer.release()` actually frees the 8MB allocation; `reloadIfEvicted` regrows on next write.
- **Agent messages**: `messages` router is read-only (`list`, `conversation`); the Dashboard card shows each agent's thread with `delivery_state`; only the Exegol MCP tools and PR watch notices send
- **PR watch** (T142 phase 1): opt-in per agent (`pr_watch` column: 0 off, else the review-feedback cursor that survives a restart; toolbar "Watch PR"). `integrations/github/pr-watch.ts` polls `gh` every 3 min for live watched agents (stops at the wake cap or a merged/closed PR, 15 min backoff with no PR); `integrations/github/gh.ts` holds `execFileAsync`, `detectGhCli` and the default-branch check; `pr-watch-reactions.ts` (pure) turns failing checks, review feedback and conflicts into notices (content dedup per head SHA, 3 per kind, 10 wakes); `sendSystemMessage` delivers them on the agent_send route (boundary, never over a permission prompt) + `agent:pr-watch` attention
- **Voice dictation** (T201): `main/dictation/engine-entry.ts` runs `sherpa-onnx-node` (N-API, asarUnpacked with its dylibs) in an Electron `utilityProcess`, forked on first use and killed after the idle setting. Renderer: getUserMedia → AudioWorklet resampler (16 kHz, `lib/dictation/resampler.ts`) → `dictation:audio`; `lib/dictation/controller.ts` resolves the target at start (`target.ts`: focused terminal / browser / files pane or an app text field, same project) and confirms it at stop, else clipboard. Chord in `settings.dictation.shortcut` (shared `parseChord`/`matchesChord`), window capture-phase listener, browser pages forward it from main (`dictation/keys.ts`). Mic/camera are denied on every session except the main window while a start is armed (`dictation/media-policy.ts`); a dictation never types into an agent waiting on a question nor into a browser page that changed origin or a password field. Dictated text is never logged
- **Sidebar**: AGENTS shows one card per project (`groupByProject` over `computeLiveTabGroups`, `lib/live-tabs.ts`): header = `showProject` + Cmd+n badge, sessions listed directly for one live tab, a sub-header per tab (`focusPane`, active one marked) for 2+; cards reorder with pointer events (`usePointerReorder`) into `liveProjectOrder` (app store v4 migrates the old `projectId:tabId` order, first tab wins); Projects sits at the bottom with its height persisted as `sidebarProjectsHeight`
- **Shell skip**: shells bypass scoring, memory extraction, scrollback buffering, status parsing
- **Shell → agent** (`agents/shell-promotion.ts`): a CLI typed in a plain terminal (any provider) promotes that same row in place: `cli_type` → the provider, `launched_in_shell = 1`, codename alias, output pipeline attached (parser, no hooks). CLI exits → `idle` at the prompt, still the agent (reattached and swept like a live one); toolbar Continue writes the provider's resume command into that shell. One `ps` every 3s while a terminal session is live
- **Auto-save**: Settings tabs save independently (General/Terminal auto-save on change, CLIs save per field)
- **Startup instrumentation**: `[Startup] dbInit`, `criticalPath`, `windowCreated`, `firstPaint` log lines (single-log guarded); `[Reattach]` + `[Recovery]` per-agent decisions for diagnosing recovery issues
- **Bundle splits**: workspace sections, xterm+addons, SettingsRoot, ProjectList, CommandPalette, FloatingPaneRoot are all lazy chunks — initial `index.js` ~812 KB (measured 2026-09-29)
- **Bundled Nerd Fonts**: 3 fonts (MesloLGS NF, FiraCode NF Mono, JetBrainsMono NF Mono) shipped inside the renderer assets, loaded via `@font-face` in `styles/fonts.css`, lazy-fetched from disk only when referenced

### Rust native module (`packages/core-rust`)
- `processing/strip_ansi.rs` — ANSI stripper with memchr fast path
- `processing/status_parser.rs` — `AgentOutputStream` class, zero-alloc case-insensitive matching
- `processing/osc_notify.rs`, `status_matchers.rs`: OSC-777 signal parsing, status matchers
- `search/`: fuzzy file finder + grep
- `git/` — worktree, diff, oplog, repo info via git2
- `tasks.rs`: `*Async` variants (napi `AsyncTask`, libuv pool) of the git and search calls the main process polls
- 55 `#[test]` functions, Clippy pedantic clean

## Monorepo Structure

```
apps/desktop/src/
  main/
    agents/         manager, spawn-env (hooks/OSC + signal mapping), spawn-context, registry,
                    scoring, queue, status-parser (+ stripOscSequences), race-mode (T131)
    bootstrap/      window, ipc-handlers, recovery, shutdown, deep-link, global-hotkey
    browser/        agent browser: tools dispatch, tool-guards, tool-handlers, electron-host
                    (registry, partitions, logs, cookie copy, request guard), control
                    (driver/take-over/wait), page-scripts, needs-user, log-ring, request-guard
    db/             client, migrations (36 base) + migration-sets/ (per-group wave files),
                    queries/ (22 domain modules + helpers)
    ipc/            router (37 routers), procedures/ (43 modules incl. history, knowledge, doctor, models, storage)
    history/        T181 session history: merged timeline + per-CLI local store readers
    terminal/       pty-host, sidecar entry/client/discovery/eviction/flusher, ring-buffer,
                    headless-emulator
    indexer/        project indexer (Ollama embeddings), chunker
    tokens/         log-parser (CLI token logs)
    hooks/          project-hooks
    pipeline/       executor, context, state-machine (T78), evaluator +
                    evaluator-step-handler (T88v2), evidence (T130), oplog-snapshots (T129)
    mcp/            host + registry (kept, unused, no UI: see TASK_TODO MCP HOST), exegol-server + exegol-protocol +
                    exegol-tools + the MCP shim and claim-guard bins (T145 agent runtime API)
    memory/         extractor (not wired on exit, T193.8), store (hybrid RRF recall),
                    salience (T126 decay/reinforce/supersede)
    knowledge/      brief, digest, staleness, managed-block, memory-bridge, context (T140)
    notifications/  bus + channels/desktop (T124)
    lifecycle/      loader (T91: .exegol/lifecycle.yaml parser + runner)
    lib/            logger, errors (T80: ExegolError hierarchy + withRetry), parse-json
                    (`parseJson(text, schema)`), concurrency (`mapWithConcurrency`)
    skills/         loader, discovery, defaults (5 personas)
    scheduler/      engine (cron + dependency-aware)
    security/       keystore (safeStorage)
    system/         resources (metrics + threshold alerts), ports (lsof + config), doctor (T148),
                    auto-updater, tray, cli-installer, scripts, release-notes, shell-clis,
                    work-guard, diagnostics, project-icons, storage (Settings > Storage)
    models/         T201 local speech-to-text models: catalog (data: verified URL, sha256, sizes,
                    license, `commercialUse`), download (HTTP Range resume + sha256, https only, free
                    space check), extract (system `tar -xjf`, then an lstat walk refuses links and
                    special files, forces 0644/0755, temp dir then rename), manager
                    (~/.exegol/models/<id>, `models:progress` push, default in settings)
    dictation/      T201 voice dictation: engine-entry (Electron utilityProcess running
                    sherpa-onnx-node, reads only under ~/.exegol/models), engine (fork on demand,
                    idle unload), model-config (catalog id to recognizer config), service
                    (sessions, model pick), history (dictation_history + retention), mic
                    (macOS permission), keys (chord forwarded from browser pane pages)
    ide/            catalog (launch facts + line syntax per IDE), detect (installed apps/CLIs, cached 10 min), opener
    windows/        floating (T84 PiP), settings (T120 standalone window), app-menu (macOS custom menu + Preferences entry + Cmd+W router, Reset Zoom on Cmd+Shift+0)
  renderer/
    components/
      workspace/    WorkspaceView, WorkspaceTabs (3 main: Agents, Project, Monitor + sub-tabs; Dashboard is its own view), WorkspacePane (5 types),
                    WorkspaceTabBar (quick launch + LayoutPresets dropdown), WorkspaceLayout,
                    GitPane (with SmartGitAction), LayoutPresets, SmartGitAction,
                    PaneContextMenu, sections/ (30 section components + pipeline/, tasks/), diff/
      settings/     SettingsPanel, GeneralSettings (Kbd components), CliSettings (cards grid,
                    YOLO/Active toggles), TerminalSettings (bundled fonts, per-card preview,
                    family chain badges, promote-on-click), ApiKeysSettings, ModelsSettings,
                    StorageSettings (T201)
      terminal/     TerminalPanel (live/read-only/crashed, snapshot probe on reattach),
                    TerminalInstance (xterm.js + WebGL + Serialize), tui-wheel (trackpad boost for TUIs), use-xterm owns the xterm
                    lifecycle (WebGL and the dormant pipe follow the live session)
      common/       AgentIcon (glob *.{svg,png}, dark/light), EmptyState, StatusDot, ConfirmDialog
      agents/       AgentLauncher (portal dropdown from registry)
      dictation/    DictationOverlay (over the target pane: waveform, timer, partial text, no-model offer)
      onboarding/   OnboardingWizard (T148 first-run: CLI detect + keys + doctor), WelcomeTour
      layout/       Sidebar (+ SidebarRail, SidebarHeader, SidebarFooter), ProjectsSection, AttentionSection,
                    TitleBar (AttentionQueue, BugReportDialog, UpdateButton), StatusBar (widget registry `lib/status-bar-widgets.ts`, Settings > Status bar), TabsOverview
    FloatingPaneRoot.tsx  (T84 — top-level renderer for floating PiP windows)
    SettingsRoot.tsx      (T120 — top-level renderer for the standalone settings window)
    hooks/          use-hotkeys, use-fitted-menu, use-theme, use-trpc, use-auto-select-project,
                    use-floating-pane-sync (unmark panes when floating window closes),
                    use-settings-sync (T120 — invalidate ['settings'] on cross-window broadcast),
                    use-latest, use-pointer-reorder, use-context-menu
    stores/         app, agents (push events, shell auto-cleanup), terminals, watch, shortcuts,
                    toasts, notification-prefs,
                    workspace (5 pane types, recovery, custom layouts, floatingPanes)
    lib/            layout-presets (pure transformation helpers), trpc-client, live-tabs,
                    pane-focus, fit-menu, shortcuts, agent-input,
                    dispatch-refit, semantic-colors, access-modes, open-in-browser,
                    pointer-reorder, release-notes
    assets/
      fonts/        MesloLGS NF, FiraCode NF Mono, JetBrainsMono NF Mono (~6.8 MB, bundled)
      icons/        SVG/PNG marks: each agent CLI's own (light/dark pairs where single-color), IDEs, providers
    styles/         globals.css, fonts.css (@font-face for bundled fonts)
  preload/          contextBridge: trpc, terminal, dialog, push events, floating, settings (T120), menu — gated by capabilities.json allowlist
packages/
  cli/              `exegol` CLI (`exegol .` opens a folder via exegol://)
  shared/           types (20+), schemas (zod: agent, db-rows, mcp, pipeline, project, project-group, scheduler, settings, token-usage)
  ui/               Radix primitives, cn()
  core-rust/        napi-rs: git2 + processing pipeline + search
docs/
  README.md (docs index + writing rules), TASK_TODO.md (pending only), CHANGELOG.md, TASK_COMPLETED/ (YYMM.md monthly archives),
  ARCHITECTURE/, PROJECT_DEFINITION/ (vision/stack/roadmap), GUIDES/ (RELEASE,
  PIPELINE_EVIDENCE_AND_CI), AGENT_PROMPTS/ (worktree agent briefs),
  RESEARCH/ (incl. BENCHMARKS + CODE_HEALTH_AUDIT_2026_07), ARCHIVED/ (old
  boards, agent prompts, review notes, V1 APPLIED/ task notes)
```

## Database

36 base migrations + per-group `migration-sets/` (wave2: `w2b_` memory salience columns, `w2d_` budgets/groups; wave3: `w3_001`..`w3_024` alias, agent links, path claims, archived_at, message delivery, session history, pipeline evidence base, LLM score columns, PTY size, yolo, mute/suspend, project appearance, launched_in_shell, cli_version, model, pr_watch, token_usage scan key, scheduled runs + task timeout, status_changed_at + its trigger, project browser_hosts, browser_eval, project ide, dictation_history) = 63 total · 36 tables: projects, project_groups, agents, agent_events, agent_links, worktrees, activities, search_index (FTS5), file_index, file_chunks, handoffs, messages, path_claims, scheduled_tasks, scheduled_runs, scheduled_results, task_queue, token_usage, budgets, budget_alerts, settings, prompts, skills_state, memories (+ reinforcement_count/last_reinforced_at/superseded_by), agent_scores, oplog, pipeline_templates, pipeline_runs, parallel_runs, diff_comments, qa_tests, qa_test_runs, dictation_history, sessions, port_registry, host_metrics (last three unused, see T185.4)

**Migration rule**: parallel work groups append ONLY to their own `db/migration-sets/<group>.ts` file (id prefixes `w2a_`/`w2b_`/`w2d_`/`w3_`) — `migrations.ts` spreads them; never edit another group's set.

Agent status: `idle | spawning | running | waiting_input | paused | completed | failed | stopped | crashed`

## React Rules

1. Derive state, don't sync — compute inline or useMemo
2. Use TanStack Query — never fetch in useEffect
3. Event handlers first — user actions in handlers, not effects
4. useMountEffect — for external system sync (DOM, xterm, IPC)
5. Key reset — prefer `key` prop over dependency arrays
