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
5. Design final app icon (replace placeholder in `src/resources/build/icons/`)
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

## Cluster I — Notifications System (pending)

> Good candidate for a parallel agent — no file conflicts with other clusters.

### T47 — System Notifications (Native OS)
**Complexity**: Low
**Priority**: Medium

**Files**: New `main/system/notifications.ts`, `main/agents/manager.ts`

**Acceptance**:
- [ ] Electron `Notification` API on agent completed/failed/crashed/waiting_input
- [ ] Click notification → focus window + navigate to agent terminal
- [ ] Settings toggle enable/disable (default: enabled)
- [ ] Skip shells (cliType === "shell")

### T48 — In-App Toast Notifications
**Complexity**: Low
**Priority**: Medium

**Files**: New `renderer/components/common/ToastProvider.tsx`, `renderer/stores/toasts.ts`

**Acceptance**:
- [ ] Toast stack (bottom-right, auto-dismiss 5s, max 3 visible)
- [ ] Types: info, success, warning, error
- [ ] Events: agent lifecycle, update available, port conflict, scheduler fired
- [ ] Click toast → navigate to relevant view

### T49 — System Tray
**Complexity**: Low
**Priority**: Low

**Acceptance**:
- [ ] Tray icon + menu (show/hide, running agents, quit)
- [ ] App stays alive when window closed
- [ ] Badge: number of running agents

---

## Remaining Minor Items

| Source | Item | Status |
|--------|------|--------|
| T03 | Parse Codex or Aider JSONL logs | Deferred |
| T03 | Token cost in sidebar AgentMiniCard | Deferred |
| T04 | Filter tasks: all / pending / completed | Deferred |
| T40b | Pane drag-out to new tab | Low priority |

---

## Completed (V3 — 2026-03-20)

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
