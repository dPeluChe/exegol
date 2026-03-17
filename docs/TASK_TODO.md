# Exegol — Task Board

> Tasks organized by domain cluster. Each cluster is **isolated** — no file conflicts between clusters.
> Clusters can run in parallel via worktrees. PRs merge to `main`.
>
> **Quality gate before PR**:
> - `npx @biomejs/biome check --fix apps/ packages/shared/src/ packages/ui/src/`
> - `npx tsc --noEmit -p apps/desktop/tsconfig.node.json && npx tsc --noEmit -p apps/desktop/tsconfig.web.json`
> - Max 400-500 LOC per file
> - Log work in `docs/tasks_completed/2026_03.md`

---

## Cluster A — Agent Lifecycle & Monitoring

> Everything related to how agents spawn, run, get tracked, and report data.
> Touches: `main/agents/`, `main/tokens/`, `main/db/queries.ts`, sidebar agent display.

### T01 — Wire Git Worktrees into Agent Spawn ✅
**Complexity**: Medium
When "Use worktree" is checked, create an isolated git worktree before spawning the agent. Auto-cleanup on stop if no changes.
**Files**: `main/agents/manager.ts`, `packages/core-rust/` (napi build wiring), `main/db/queries.ts`, `ipc/procedures/agents.ts`, `renderer/components/agents/SpawnAgentDialog.tsx`
**Acceptance**:
- [x] Agent spawns in isolated worktree (cwd = worktree path)
- [x] Branch name auto-generated from task description if empty
- [x] Worktree auto-cleaned if no changes on stop
- [x] Worktree kept + user notified if changes exist
- [x] DB: agents.worktree_id linked, worktrees table populated

### T03 — Token Usage Monitor (JSONL Parser) ✅
**Complexity**: Medium
Parse local JSONL logs from CLI agents to show real token usage and costs. Display in workspace Token Usage tab and sidebar per-agent.
**Files**: New `main/tokens/log-parser.ts`, `ipc/procedures/token-usage.ts`, `main/db/queries.ts`, `renderer/.../TokensSection.tsx`, `renderer/.../ProjectsSection.tsx`
**Acceptance**:
- [x] Parse Claude Code JSONL logs (`~/.claude/projects/**/`)
- [ ] Parse at least one other (Codex or Aider)
- [x] Store in token_usage table (with `source` column: agent vs log_scan)
- [x] TokensSection: per-agent breakdown, per-model costs, 30-day chart
- [ ] Sidebar: token cost in AgentMiniCard

### T11 — Re-launch Stopped Agents ✅
**Complexity**: Low
Button on stopped/completed agents to re-launch with same task description.
**Files**: `renderer/.../ProjectsSection.tsx`, `renderer/.../ResourcesSection.tsx`, `hooks/use-trpc.ts`
**Acceptance**:
- [x] "Re-launch" button on inactive agents
- [x] Creates new agent with same task + CLI type
- [x] Focuses new agent terminal

### T14 — Per-Agent Process Metrics ✅
**Complexity**: Low
Show CPU/memory per running agent process in Resources tab.
**Files**: `main/system/resources.ts`, `renderer/.../ResourcesSection.tsx`
**Acceptance**:
- [x] Query `ps -o pcpu,rss -p <pid>` for running agents
- [x] Show in Resources agent table

---

## Cluster B — Terminal & Editor

> Everything related to terminal rendering, splitting, diffs, and scrollback.
> Touches: `renderer/components/terminal/`, `renderer/components/workspace/sections/DiffSection.tsx`, terminal stores.

### T02 — Diff Viewer ✅
**Complexity**: High
Real diff viewer with syntax highlighting. Show git diffs for project or worktree.
**Files**: `renderer/.../DiffSection.tsx` (rewrite), new diff rendering component, `main/ipc/procedures/` (diff queries), `packages/core-rust/src/git/mod.rs` (get_worktree_diff exists)
**Acceptance**:
- [x] Unified diff view
- [x] Split (side-by-side) view toggle
- [ ] Syntax highlighting (Shiki)
- [x] Per-file navigation
- [x] Refresh on file changes
- [x] Binary file detection (shows "Binary file changed" for .png, .jpg, .db, .node, etc.)

### T08 — Terminal Split Panes ✅
**Complexity**: High
Split terminal views within a single agent tab (horizontal/vertical), like tmux.
**Files**: `renderer/.../TerminalPanel.tsx` (refactor), new `TerminalSplitView.tsx`, `stores/terminals.ts`
**Acceptance**:
- [x] Split current terminal horizontally (Cmd+D) or vertically (Cmd+Shift+D)
- [x] Independent terminals per pane
- [x] Resize panes by dragging
- [x] Close individual panes

### T16 — Terminal Scrollback Persistence ✅
**Complexity**: Medium
Save terminal output to disk for review after agent completes or app restarts.
**Files**: `main/agents/manager.ts` (capture scrollback), new scrollback storage, `renderer/.../TerminalPanel.tsx` (load for stopped agents)
**Acceptance**:
- [x] Terminal output saved to file per agent session
- [x] Stopped agents show read-only terminal with historical output
- [x] File stored in app userData directory

---

## Cluster C — Workspace Tabs (Content Sections)

> New workspace sections with their own DB tables, CRUD, and UI.
> Touches: `renderer/components/workspace/sections/`, `WorkspaceTabs.tsx`, `WorkspaceView.tsx`, new DB migrations and procedures.

### T04 — Task Viewer from Markdown ✅
**Complexity**: Medium
Load .md files with checkbox tasks, render as interactive task list.
**Files**: `renderer/.../TasksSection.tsx` (rewrite), new `lib/markdown-tasks.ts`, new `ipc/procedures/files.ts`
**Acceptance**:
- [x] Load .md file (file picker or project root TODO.md/plan.md)
- [x] Render checkboxes with nesting
- [x] Toggle checkbox → writes back to .md file
- [x] Progress indicator (X of Y complete)
- [ ] Filter: all / pending / completed
- [x] Auto-probes TODO.md, todo.md, TASKS.md, tasks.md, plan.md, PLAN.md on mount

### T09 — Prompts & Templates ✅
**Complexity**: Medium
Save reusable prompts/templates per project. Quick-copy or inject into agent spawn.
**Files**: New sidebar section, new workspace tab, new DB migration (prompts table), new `ipc/procedures/prompts.ts`, `WorkspaceTabs.tsx`, `WorkspaceView.tsx`
**Acceptance**:
- [x] CRUD prompt templates per project
- [x] Categories: task, review, debug, custom
- [x] One-click copy to clipboard
- [x] Pre-fill SpawnAgentDialog with selected prompt
- [x] Sidebar section with recent/pinned prompts

### T10 — File Explorer Panel ✅
**Complexity**: High
Browse project files from within Exegol. Tree view in secondary panel.
**Files**: New `renderer/.../FileExplorer.tsx`, new `ipc/procedures/files.ts` (readdir, stat), `renderer/.../AgentsSection.tsx` (secondary panel)
**Acceptance**:
- [x] Tree view of project directory
- [x] Expand/collapse folders, file icons by extension
- [x] Click file → show content in secondary panel (read-only)
- [x] Respects .gitignore

---

## Cluster D — Infrastructure Services

> Background services in main process. No renderer UI overlap with other clusters.
> Touches: `main/scheduler/`, `main/system/`, `main/ipc/procedures/`, sidebar overviews.

### T05 — Internal Scheduler Engine ✅
**Complexity**: Medium
Cron-based scheduler that runs agent tasks on a cadence. Uses croner (already installed).
**Files**: New `main/scheduler/engine.ts`, new `ipc/procedures/scheduler.ts`, `renderer/.../SchedulerSection.tsx` (rewrite), `renderer/.../SchedulersOverview.tsx`, `main/db/queries.ts`
**Acceptance**:
- [x] Create scheduled task: prompt + cron + CLI agent
- [x] Scheduler runs tasks at intervals (croner)
- [x] Results in scheduled_results table
- [x] SchedulerSection UI: task list, create form, result viewer
- [x] SchedulersOverview: active/upcoming tasks
- [x] Event-based completion via onAgentComplete callbacks (replaced 5s polling)

### T07 — Port Detection ✅
**Complexity**: Medium
Detect listening ports per project and display in sidebar.
**Files**: New `main/system/ports.ts`, `ipc/procedures/resources.ts`, `renderer/.../ProjectsSection.tsx`, `main/db/queries.ts`
**Acceptance**:
- [x] Detect ports via `lsof -iTCP -sTCP:LISTEN`
- [x] Parse config files (vite.config, next.config, package.json) for expected ports
- [x] Show port + status in sidebar per project
- [x] Click port → open in browser
- [ ] Conflict warning for duplicate ports

---

## Cluster E — Settings & Appearance

> UI/UX polish. Touches settings components and global styles only.
> No overlap with agent, terminal, or workspace logic.

### T06 — Open in IDE ✅
**Complexity**: Low
Button to open project/worktree in configured IDE.
**Files**: `main/ide/opener.ts`, `ipc/procedures/projects.ts` (openInIde mutation), `renderer/.../ProjectsSection.tsx`, `hooks/use-trpc.ts`
**Acceptance**:
- [x] Button per project in sidebar → opens in IDE
- [x] Uses settings.defaultIde (code, cursor, zed, idea, webstorm)
- [x] Custom IDE path for 'custom' type

### T12 — Theme System (Light/Dark/System) ✅
**Complexity**: Medium
Apply theme selection from Settings. Currently dark is hardcoded.
**Files**: `styles/globals.css` (light theme vars), `App.tsx` (useTheme), `hooks/use-theme.ts`, `TerminalPanel.tsx` (terminal colors)
**Acceptance**:
- [x] Light theme CSS variables
- [x] System theme auto-detection
- [x] Theme applies immediately (no reload)
- [x] Terminal colors match theme
- [x] Smooth CSS transitions for bg/color/border (xterm excluded to prevent flicker)

### T13 — Recent Sessions (DB-backed) ✅
**Complexity**: Low
Populate sidebar "Recent Sessions" with past agent sessions from DB.
**Files**: `renderer/.../RecentSessions.tsx`, `main/db/queries.ts`, `hooks/use-trpc.ts`, `ipc/procedures/agents.ts`
**Acceptance**:
- [x] Show last 10 completed/stopped agents across all projects
- [x] Click → navigate to project + show agent details

### T15 — API Key Management ✅
**Complexity**: Medium
Store API keys in OS keychain via Electron safeStorage.
**Files**: `main/security/keystore.ts`, `ipc/procedures/apikeys.ts`, `renderer/.../ApiKeysSettings.tsx`, `main/agents/manager.ts`, `hooks/use-trpc.ts`
**Acceptance**:
- [x] Securely store/retrieve API keys (safeStorage encryption)
- [x] UI: password input fields with save/delete per provider
- [x] Keys injected into agent env on spawn

---

## Cluster Summary — Assignment Map

| Cluster | Tasks | Touches | Can parallel with |
|---------|-------|---------|-------------------|
| **A — Agent Lifecycle** | T01, T03, T11, T14 | main/agents/, main/tokens/, db/queries, sidebar agents | B, C, D, E |
| **B — Terminal & Editor** | T02, T08, T16 | terminal components, DiffSection, terminal stores | A, C, D, E |
| **C — Workspace Tabs** | T04, T09, T10 | workspace sections, new DB tables, new procedures | A, B, D, E |
| **D — Infrastructure** | T05, T07 | main/scheduler/, main/system/ports, sidebar overviews | A, B, C, E |
| **E — Settings & Appearance** | T06, T12, T13, T15 | settings, styles, sidebar RecentSessions | A, B, C, D |

**All 5 clusters can run simultaneously.** Zero file conflicts between clusters if each stays within its listed files.

**Quick wins** (< 2 hours): T06, T11, T13, T14
**Heavy lifts** (> 1 day): T02, T08, T10

---

## Post-Merge Improvements (completed)

Cross-cutting quality improvements applied after all cluster branches merged to main:

- [x] **queries.ts refactor**: Split 576 LOC monolith into 7 domain files under `db/queries/` with barrel re-export
- [x] **Migration 012**: Added `source` column to `token_usage` table (agent vs log_scan distinction)
- [x] **Scheduler event-based**: Replaced 5s polling with `onAgentComplete` callbacks in SchedulerEngine
- [x] **IDE PATH validation**: `opener.ts` runs `which` to validate binary exists before launching
- [x] **Binary file detection**: DiffFileView shows "Binary file changed" for non-text extensions
- [x] **Task auto-probe**: TasksSection probes TODO.md, todo.md, TASKS.md, tasks.md, plan.md, PLAN.md on mount
- [x] **Theme transitions**: Smooth CSS transitions for bg/color/border (xterm excluded to prevent flicker)
- [x] **Biome lint**: 115 files, 0 errors, 0 warnings
