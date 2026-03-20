# Exegol — Task Board V3

> **Quality gate before PR**:
> - `npx @biomejs/biome check --fix apps/ packages/shared/src/ packages/ui/src/`
> - `npx tsc --noEmit -p apps/desktop/tsconfig.node.json && npx tsc --noEmit -p apps/desktop/tsconfig.web.json`
> - Max 400-500 LOC per file
> - Log work in `docs/tasks_completed/2026_03.md`

---

## Cluster H — Distribution & Auto-Updates

> Build, package, sign, distribute, and auto-update the Electron app.
> Inspired by **Superset**: electron-builder + GitHub Releases + electron-updater + canary channel.
> **Reference**: `github.com/superset-sh/superset` — `electron-builder.ts`, `auto-updater.ts`, `.github/workflows/`

### T43 — Build & Package (Phase 1)
**Complexity**: Medium
**Priority**: HIGH — blocks all distribution

**What to implement**: electron-builder config to generate installable macOS DMG, Windows exe, Linux AppImage.

**Files**: New `apps/desktop/electron-builder.ts`, new `apps/desktop/src/resources/build/` (icons, entitlements)

**Acceptance**:
- [ ] `electron-builder.ts` config: app ID (`com.exegol.desktop`), product name, ASAR with native module unpacking (node-pty, libsql, @exegol/core-rust)
- [ ] App icons: `icon.icns` (macOS), `icon.ico` (Windows), `icon.png` (Linux) — in `src/resources/build/icons/`
- [ ] macOS: DMG + ZIP targets, hardened runtime, entitlements (JIT, unsigned memory, audio, automation)
- [ ] macOS entitlements: `entitlements.mac.plist` + `entitlements.mac.inherit.plist`
- [ ] Windows: NSIS installer (x64), `oneClick: false`, `allowToChangeInstallationDirectory: true`
- [ ] Linux: AppImage (x64)
- [ ] `bun run package` script in package.json produces local build
- [ ] Native modules unpacked from ASAR: node-pty, libsql, @exegol/core-rust bindings
- [ ] Build produces working app that launches and spawns agents

### T44 — Auto-Updater (Phase 2)
**Complexity**: Medium
**Priority**: HIGH — enables seamless updates

**Study**: Superset `apps/desktop/src/main/lib/auto-updater.ts`

**Files**: New `apps/desktop/src/main/system/auto-updater.ts`, `main/index.ts`, renderer notification UI

**Acceptance**:
- [ ] `electron-updater` with generic provider pointing to GitHub Releases
- [ ] Feed URL: `https://github.com/{owner}/{repo}/releases/latest/download/`
- [ ] Auto-check on startup + every 4 hours
- [ ] States: idle, checking, downloading, ready, error
- [ ] Auto-download in background (no user action needed)
- [ ] On app quit with update ready: install automatically
- [ ] Silent network errors (no dialog for ENOTFOUND, CONNECTION_REFUSED)
- [ ] Manual "Check for Updates" in settings or Help menu
- [ ] Renderer notification: "Update available — restart to install" banner

### T45 — CI/CD Release Pipeline (Phase 3)
**Complexity**: High
**Priority**: Medium — manual release works without this

**Files**: New `.github/workflows/build-desktop.yml`, `release-desktop.yml`, `apps/desktop/create-release.sh`

**Acceptance**:
- [ ] `build-desktop.yml`: reusable workflow, builds on macOS (arm64 + x64) + Linux (x64)
- [ ] `release-desktop.yml`: triggered by `desktop-v*` tags, creates GitHub Release (draft)
- [ ] `create-release.sh`: interactive script — bump version, create tag, push, monitor workflow
- [ ] macOS code signing via CI secrets (CSC_LINK, APPLE_ID, APPLE_TEAM_ID)
- [ ] macOS notarization (automatic via electron-builder `notarize: true`)
- [ ] Release notes generated from conventional commits (`gh api repos/.../releases/generate-notes`)
- [ ] Multi-arch macOS manifest merging (arm64 + x64 → `latest-mac.yml`)
- [ ] Artifact names: `Exegol-{version}-{arch}.{ext}` + stable-named copies for updater

### T46 — Canary Channel (Phase 3b, optional)
**Complexity**: Medium
**Priority**: Low — nice-to-have for beta testing

**Acceptance**:
- [ ] `electron-builder.canary.ts` — separate app ID (`com.exegol.desktop.canary`), canary icons
- [ ] Version suffix: `-canary.{YYYYMMDDHHmmss}` (auto-generated in CI)
- [ ] Canary feed URL: `https://github.com/{owner}/{repo}/releases/download/desktop-canary/`
- [ ] Rolling `desktop-canary` tag (overwritten each build)
- [ ] Scheduled builds every 12h (only if code changed)
- [ ] Channel detection from version string (`prerelease() !== null`)

---

## Cluster I — Notifications System

> System-level and in-app notifications for agent lifecycle events.
> Currently: hooks fire events to `~/.exegol/events/` but nothing shows them to the user.

### T47 — System Notifications (Native OS)
**Complexity**: Low
**Priority**: Medium

**Problem**: When an agent completes, fails, or needs input, the user has no notification if Exegol is in the background. No system tray presence.

**Files**: New `main/system/notifications.ts`, `main/agents/manager.ts`, `main/index.ts`

**Acceptance**:
- [ ] Electron `Notification` API for native OS notifications
- [ ] Notify on: agent completed, agent failed, agent crashed, agent waiting for input
- [ ] Notification includes: agent CLI type, task description (truncated), status
- [ ] Click notification → focus Exegol window + navigate to agent's terminal
- [ ] Respect "Do Not Disturb" / Focus mode (Electron handles this natively)
- [ ] Settings toggle: enable/disable notifications (default: enabled)
- [ ] Don't notify for shells (cliType === "shell")

### T48 — In-App Toast Notifications
**Complexity**: Low
**Priority**: Medium

**Problem**: No in-app feedback for system events (update available, agent events, port detected, scheduler fired). User must check sidebar/status bar manually.

**Files**: New `renderer/components/common/ToastProvider.tsx`, `renderer/stores/toasts.ts`

**Acceptance**:
- [ ] Toast notification system (stack, auto-dismiss after 5s, manual dismiss)
- [ ] Toast types: info, success, warning, error
- [ ] Events that trigger toasts: agent completed/failed, update available, port conflict detected, scheduler task fired
- [ ] Position: bottom-right (standard for desktop apps)
- [ ] Max 3 visible toasts, queue overflow
- [ ] Clicking toast navigates to relevant view (agent terminal, settings, etc.)

### T49 — System Tray
**Complexity**: Low
**Priority**: Low

**Problem**: When window is closed, app exits. No background presence for monitoring agents.

**Files**: New `main/system/tray.ts`, `main/index.ts`

**Acceptance**:
- [ ] System tray icon (matches app icon, smaller variant)
- [ ] Tray menu: show/hide window, running agents list, quit
- [ ] Click tray icon → toggle window visibility
- [ ] App stays alive when window closed (macOS: already default, Windows/Linux: need tray)
- [ ] Tray icon badge: number of running agents (macOS dock badge too)
- [ ] Right-click menu shows running agent names + status

---

## Remaining Minor Items (deferred from V1/V2)

| Source | Item | Status |
|--------|------|--------|
| T03 | Parse Codex or Aider JSONL logs (not just Claude Code) | Deferred |
| T03 | Token cost in sidebar AgentMiniCard | Deferred |
| T04 | Filter tasks: all / pending / completed | Deferred |

---

## Cluster G — Pending UI Items

### T40b — Pane Drag-Out to New Tab
**Complexity**: Medium
**Priority**: Low

**Acceptance**:
- [ ] Panes within a tab can be dragged out to create a new tab
- [ ] Drag handle visible on pane toolbar

---

## Completed (V3 — this session)

### Cluster F — Terminal Scalability (all done)
- [x] T35 — PTY Subprocess Isolation + Backpressure + Binary IPC
- [x] T36 — Headless Emulator + Shell Readiness Gating (OSC-777) + Mode Tracking
- [x] T37 — Scrollback Optimization (async + sync flush on exit, 5K matched)
- [x] T38 — WebGL Context Pooling (IntersectionObserver visibility)
- [x] Async FD Write on PTY (fs.write with exponential backoff)
- [x] Session Reattach Protocol (TerminalModes + rehydrate sequences + sessionSnapshot)

### Agent Hooks & Wrappers (all done)
- [x] Shell Wrappers (zsh ZDOTDIR + bash rcfile + marker injection)
- [x] Claude Code Hook Injection (Stop, PostToolUse, UserPromptSubmit)
- [x] Codex Hook Injection (SessionStart, Stop)
- [x] Notify Handler (fs.watch + EXEGOL_AGENT_ID guard)

### Cluster G — UI Polish (all done)
- [x] T07 — Port Conflict Detection
- [x] T19 — Dynamic Model Catalog (DB-backed)
- [x] T33 — LLM-as-Judge Tier 3
- [x] T39 — Diff Viewer UX
- [x] T39b — Terminal Loading State
- [x] T40 — Tab Auto-Naming + Icons
- [x] T40 — Tab DnD Reorder + Merge
- [x] T41 — Agent Launcher Pane Fix
- [x] T42 — Tab Keyboard Navigation

### Bug Fixes (this session)
- [x] Shell readiness only for plain shells
- [x] Scrollback sync flush on exit
- [x] Auto-create tab when tabs=0
- [x] DnD stopPropagation
- [x] xterm refit after merge
- [x] notify.sh guard

---

## Previous Completed

V1 (T01-T16) and V2 (T17-T34): 34/34 tasks complete.
See `docs/tasks_completed/2026_03.md` for full log.
