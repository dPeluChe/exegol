# Exegol — Task Board V3

> **Quality gate before PR**:
> - `npx @biomejs/biome check --fix apps/ packages/shared/src/ packages/ui/src/`
> - `npx tsc --noEmit -p apps/desktop/tsconfig.node.json && npx tsc --noEmit -p apps/desktop/tsconfig.web.json`
> - Max 400-500 LOC per file
> - Log work in `docs/tasks_completed/2026_03.md`

---

## Cluster H — Distribution & Auto-Updates (pending)

### T45 — CI/CD Release Pipeline (Phase 3)
**Complexity**: High
**Priority**: Medium — activate when app is stable enough to distribute

**Next steps to publish a release:**
1. Push repo to GitHub
2. Configure repository secrets:
   - `MAC_CERTIFICATE` (P12, base64), `MAC_CERTIFICATE_PASSWORD`
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
3. Update `GITHUB_OWNER` and `GITHUB_REPO` in `auto-updater.ts` and `electron-builder.ts`
4. Enable `notarize: true` in `electron-builder.ts` mac section
5. ~~Design final app icon~~ (done — hexagon + code symbols icon)
6. Create workflows and release script (see acceptance below)

**Acceptance**:
- [ ] `build-desktop.yml`: reusable workflow, builds on macOS (arm64 + x64) + Linux (x64)
- [ ] `release-desktop.yml`: triggered by `desktop-v*` tags, creates GitHub Release (draft)
- [ ] `create-release.sh`: interactive script — bump version, create tag, push, monitor workflow
- [ ] macOS code signing + notarization via CI secrets
- [ ] Release notes generated from conventional commits
- [ ] Multi-arch macOS manifest merging (arm64 + x64 → `latest-mac.yml`)

### T46 — Canary Channel (optional)
**Complexity**: Medium
**Priority**: Low

**Acceptance**:
- [ ] `electron-builder.canary.ts` — separate app ID, canary icons
- [ ] Scheduled builds every 12h (only if code changed)
- [ ] Rolling `desktop-canary` tag

---

## Pending Pipeline & UX Items

### T53 — Worktree Path Relocation
**Priority**: High
- Move worktree creation from sibling dir to `~/.exegol/pipelines/{project-name}/{branch}`
- Requires Rust `create_worktree()` change in `core-rust/src/git/mod.rs`
- Update executor.ts path construction

### T54 — Pipeline Auto-Close for Interactive CLIs
**Priority**: High
- Add `pipelineIdleCloseSeconds` config field to AgentProvider (Settings UI)
- Pipeline executor monitors PTY output idle time
- After N seconds of no output → send Ctrl+C to force-close interactive CLIs
- Default: 50s. Configurable per provider in Settings
- Affects: Gemini, OpenCode, Kiro (CLIs that don't auto-exit)

### T55 — Push Validation Before Worktree
**Priority**: High
- Before creating pipeline worktree: check `git rev-list HEAD...@{u}`
- If local ahead of origin → show warning modal with "Push & Continue" / "Continue anyway"
- Block pipeline start until resolved
- Also check `git status --porcelain` for uncommitted changes

### Other Pending Items

| Item | Description | Priority |
|------|-------------|----------|
| Pipeline terminal repaint | Investigate xterm.js repaint artifacts in inline pipeline terminal | Medium |
| T45 — CI/CD Release Pipeline | GitHub Actions when repo goes to GitHub | Medium |
| T46 — Canary Channel | Optional, after T45 | Low |

---

## Completed (V3 — 2026-03-27)

### PTY Sidecar Architecture (inspired by collaborator-ai/collab-public)
- [x] T52 — Ring Buffer (8MB circular byte buffer per session, snapshot/write/clear)
- [x] T52 — Sidecar Protocol (JSON-RPC 2.0 over Unix domain socket, NDJSON framing)
- [x] T52 — Sidecar Entry Point (standalone detached process, manages all PTY sessions)
- [x] T52 — Sidecar Client + Discovery (spawn/reuse/PID file, JSON-RPC client with 10s request timeout)
- [x] T52 — PtyHost Facade (sidecar mode + legacy fallback, session routing by mode)
- [x] T52 — Session Reconnection (reattach surviving agents after window reload, ring buffer replay)
- [x] T52 — Renderer Data Coalescing (5ms batch before term.write(), reduces render artifacts)

### Build & Branding
- [x] App Icon — Hexagon network with code symbols (>_, {}, #, //)
- [x] DMG Background — Dark terminal theme with code snippets
- [x] Build Config — author/description in package.json, pinned Electron 41.0.2

### Bug Fixes
- [x] Agent "not found" errors — agents.get returns null instead of throwing (stale pane recovery)
- [x] Tray menu rebuild optimization — only rebuild when agent count changes

---

## Completed (V3 — 2026-03-23/24)

### UI Polish
- [x] T04 — Task Filter (All/Active/Done toggle in kanban top bar, filters visible columns)

### Notifications & Tray
- [x] T49 — System Tray (tray icon + context menu, show/hide + running agents list + quit, badge count, app stays alive on close, refreshTray on agent status change)
- [x] T40b — Pane Drag-Out to New Tab (extractPaneToNewTab store action, draggable PaneToolbar with grip handle, pop-out button, drop target on tab bar with visual indicator)

### Notifications System
- [x] T47 — System Notifications (Electron Notification API, click→focus+navigate, skip shells, settings toggle)
- [x] T48 — In-App Toast Stack (bottom-right, auto-dismiss 5s, max 3, color-coded, click→navigate)
- [x] T03 — Parse Codex/Aider JSONL Logs (log-parser.ts: Codex sessions + Aider markdown/cache, scan mutation with dedup)
- [x] T03 — Token Cost in Sidebar AgentMiniCard (ProjectsSection.tsx, accent color, adaptive decimals)

### Multi-Agent Pipelines
- [x] T50 — Pipeline Executor (singleton, event-driven: startRun/advanceStep/onStepComplete)
- [x] T50 — Pipeline Data Layer (migration 024, templates + runs tables, shared types/schemas)
- [x] T50 — Pipeline IPC (11 tRPC procedures, push events, preload bridge)
- [x] T50 — Pipeline UI (Pipelines sub-tab, template editor, run timeline, preset templates)
- [x] T50 — cwdOverride for shared worktrees (AgentCreate + AgentManager)
- [x] T50 — Loop mechanism (review→fix cycle, loopBackTo + max iterations guard)
- [x] T50 — Crash recovery (recoverStalePipelineRuns on startup)

### Skill Installer
- [x] T51 — Curated Registry + Installer Module
- [x] T51 — Skill Import/Install UI (SkillInstallModal, SkillImportDialog)
- [x] T51 — Canonical path management (~/.agents/skills/)

### Cluster F — Terminal Scalability
- [x] T35 — PTY Subprocess Isolation + Backpressure + Binary IPC
- [x] T36 — Headless Emulator + Shell Readiness Gating (OSC-777) + Mode Tracking
- [x] T37 — Scrollback Optimization (async + sync flush on exit, 5K matched)
- [x] T38 — WebGL Context Pooling (IntersectionObserver visibility)
- [x] Async FD Write on PTY (fs.write with exponential backoff)
- [x] Session Reattach Protocol (TerminalModes + rehydrate sequences)

### Agent Hooks & Wrappers
- [x] Shell Wrappers (zsh ZDOTDIR + bash rcfile + marker injection)
- [x] Claude Code Hook Injection (Stop, PostToolUse, UserPromptSubmit)
- [x] Codex Hook Injection (SessionStart, Stop)
- [x] Notify Handler (fs.watch + EXEGOL_AGENT_ID guard)

### Cluster G — UI Polish
- [x] T07 — Port Conflict Detection
- [x] T19 — Dynamic Model Catalog (DB-backed, 9 models)
- [x] T33 — LLM-as-Judge Tier 3
- [x] T39 — Diff Viewer UX (collapsed, split default, expand/collapse all)
- [x] T39b — Terminal Loading State
- [x] T40 — Tab Auto-Naming + Icons
- [x] T40 — Tab DnD Reorder + Merge (directional drop zones)
- [x] T41 — Agent Launcher Pane Fix
- [x] T42 — Tab Keyboard Navigation (Ctrl+Tab, Cmd+Shift+]/[, Cmd+1-9)

### Cluster H — Distribution
- [x] T43 — Build & Package (electron-builder.ts, icons, entitlements, ASAR unpacking)
- [x] T44 — Auto-Updater (electron-updater, 4h check, UpdateBanner UI, channel detection)

### Bug Fixes
- [x] Shell readiness only for plain shells (no 15s timeout on agent CLIs)
- [x] Scrollback sync flush on exit (no more "No history available")
- [x] Auto-create tab when tabs=0
- [x] DnD stopPropagation (tab reorder doesn't trigger pane merge)
- [x] xterm refit after merge
- [x] notify.sh guard (EXEGOL_AGENT_ID)

---

## Previous Completed

V1 (T01-T16) and V2 (T17-T34): 34/34 tasks complete.
See `docs/tasks_completed/2026_03.md` for full log.
