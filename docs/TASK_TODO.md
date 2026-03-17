# Exegol — Task Board

> Tasks ready for assignment. Each task is self-contained and can be worked on in a feature branch.
> Branch naming: `feat/<task-id>` (e.g., `feat/T01-worktree-wiring`)
>
> **Base branch**: `main` (commit `3582db9` — lint 0, TS 0, Rust clean)
>
> **Rules for agents/devs**:
> 1. Create feature branch from `main`
> 2. Work only in the files listed for your task
> 3. Run `npx @biomejs/biome check --fix apps/ packages/shared/src/ packages/ui/src/` before committing
> 4. Run `npx tsc --noEmit -p apps/desktop/tsconfig.node.json && npx tsc --noEmit -p apps/desktop/tsconfig.web.json`
> 5. Log completed work in `docs/tasks_completed/2026_03.md`
> 6. Max 400-500 LOC per file. Split if larger.

---

## Priority: HIGH (Phase 1 completion)

### T01 — Wire Git Worktrees into Agent Spawn
**Status**: PLANNED | **Complexity**: Medium | **Files**: 5-8
**Description**: Connect the existing Rust git2 worktree scaffold to the agent spawn flow. When "Use worktree" is checked in SpawnAgentDialog, create an isolated worktree before spawning the agent.
**Depends on**: Nothing (Rust scaffold exists, DB table exists)
**Key files**:
- `apps/desktop/src/main/agents/manager.ts` — add worktree creation before pty.spawn, set cwd to worktree path
- `packages/core-rust/src/git/mod.rs` — already has create_worktree, list_worktrees, remove_worktree
- `packages/core-rust/package.json` — needs napi build wiring to desktop app
- `apps/desktop/src/main/ipc/procedures/agents.ts` — pass worktree config to manager
- `apps/desktop/src/main/db/queries.ts` — createWorktree, link agent to worktree
- `apps/desktop/src/renderer/components/agents/SpawnAgentDialog.tsx` — branch name field already exists
**Acceptance criteria**:
- [ ] Agent spawns in isolated worktree when checkbox enabled
- [ ] Worktree auto-cleaned if no changes on agent stop
- [ ] Worktree kept if changes exist, user notified
- [ ] Branch name auto-generated from task description if empty
- [ ] DB records updated (agents.worktree_id, worktrees table)

### T02 — Diff Viewer
**Status**: STUB | **Complexity**: High | **Files**: 4-6
**Description**: Replace the DiffSection placeholder with a real diff viewer. Show git diffs for the active project or a specific worktree.
**Depends on**: T01 (worktrees) preferred but can work with project root diffs
**Key files**:
- `apps/desktop/src/renderer/components/workspace/sections/DiffSection.tsx` — rewrite
- `apps/desktop/src/main/ipc/procedures/` — new `diff.ts` procedure (or add to agents/projects)
- `packages/core-rust/src/git/mod.rs` — `get_worktree_diff` already exists
- New: diff rendering component (unified + split view, syntax highlighting via Shiki)
**Acceptance criteria**:
- [ ] Show unified diff of all changes in current project/worktree
- [ ] Split (side-by-side) view toggle
- [ ] Syntax highlighting
- [ ] Per-file navigation
- [ ] Refresh on file changes

### T03 — Token Usage Monitor (JSONL Parser)
**Status**: STUB | **Complexity**: Medium | **Files**: 5-7
**Description**: Parse local JSONL logs from CLI agents to show real token usage and costs.
**Depends on**: Nothing
**Key files**:
- New: `apps/desktop/src/main/tokens/log-parser.ts` — parse Claude Code (`~/.claude/projects/**/`), Codex, Aider logs
- `apps/desktop/src/main/ipc/procedures/token-usage.ts` — wire parser data into tRPC
- `apps/desktop/src/main/db/queries.ts` — recordTokenUsage, getProjectTokenUsage
- `apps/desktop/src/renderer/components/workspace/sections/TokensSection.tsx` — rewrite with charts/tables
- `apps/desktop/src/renderer/components/layout/ProjectsSection.tsx` — show token mini-bar per agent
- `apps/desktop/src/renderer/hooks/use-trpc.ts` — useTokenUsage hooks
**Acceptance criteria**:
- [ ] Parse Claude Code JSONL logs (input_tokens, output_tokens, model, cost)
- [ ] Parse at least one other agent's logs (Codex or Aider)
- [ ] Store parsed data in token_usage table
- [ ] TokensSection shows: per-agent breakdown, per-model costs, 30-day history
- [ ] Sidebar shows token cost per agent in AgentMiniCard

### T04 — Task Viewer from Markdown
**Status**: STUB | **Complexity**: Medium | **Files**: 3-5
**Description**: Load any .md file with checkbox tasks and render as interactive task list.
**Depends on**: Nothing
**Key files**:
- `apps/desktop/src/renderer/components/workspace/sections/TasksSection.tsx` — rewrite
- New: `apps/desktop/src/renderer/lib/markdown-tasks.ts` — parse markdown checkboxes
- `apps/desktop/src/main/ipc/procedures/` — new procedure to read/write .md files
- `apps/desktop/src/preload/index.ts` — may need file dialog for .md selection
**Acceptance criteria**:
- [ ] Load .md file via file picker or from project root (TODO.md, plan.md)
- [ ] Render checkbox tasks with nested indentation
- [ ] Toggle checkboxes from UI → writes back to .md file
- [ ] Progress indicator (X of Y tasks complete)
- [ ] Filter: all / pending / completed

### T05 — Internal Scheduler Engine
**Status**: STUB | **Complexity**: Medium | **Files**: 4-6
**Description**: Implement the cron-based scheduler that runs agent tasks on a cadence.
**Depends on**: Nothing (DB tables and croner dep exist)
**Key files**:
- New: `apps/desktop/src/main/scheduler/engine.ts` — croner-based scheduler
- `apps/desktop/src/main/ipc/procedures/` — new `scheduler.ts` procedure (CRUD + run)
- `apps/desktop/src/renderer/components/workspace/sections/SchedulerSection.tsx` — rewrite with task list/form
- `apps/desktop/src/renderer/components/layout/SchedulersOverview.tsx` — show real data
- `apps/desktop/src/main/db/queries.ts` — scheduled task CRUD queries
**Acceptance criteria**:
- [ ] Create scheduled task: prompt + cron expression + CLI agent
- [ ] Scheduler runs tasks at configured intervals (uses croner)
- [ ] Results stored in scheduled_results table
- [ ] SchedulerSection UI: list tasks, create new, view results
- [ ] SchedulersOverview sidebar: show active/upcoming tasks

### T06 — Open in IDE
**Status**: PLANNED | **Complexity**: Low | **Files**: 3-4
**Description**: Add "Open in IDE" button that opens the project/worktree in the user's configured IDE.
**Depends on**: Nothing
**Key files**:
- `apps/desktop/src/main/ipc/procedures/projects.ts` — add `openInIde` mutation
- `apps/desktop/src/renderer/components/layout/ProjectsSection.tsx` — add IDE button per project
- `apps/desktop/src/renderer/components/workspace/sections/AgentsSection.tsx` — add IDE button per worktree
- New or update: shell command mapping (code, cursor, zed, idea, webstorm → CLI commands)
**Acceptance criteria**:
- [ ] Button in sidebar per project opens in configured IDE
- [ ] Uses settings.defaultIde to determine command
- [ ] Works for: VS Code (`code`), Cursor (`cursor`), Zed (`zed`), JetBrains (`idea`/`webstorm`)
- [ ] Custom IDE path from settings used for 'custom' type

### T07 — Port Detection
**Status**: PLANNED | **Complexity**: Medium | **Files**: 4-5
**Description**: Detect listening ports per project/worktree and display in sidebar.
**Depends on**: Nothing
**Key files**:
- New: `apps/desktop/src/main/system/ports.ts` — detect ports via `lsof -iTCP -sTCP:LISTEN`
- `apps/desktop/src/main/ipc/procedures/resources.ts` — add ports query
- `apps/desktop/src/renderer/components/layout/ProjectsSection.tsx` — show port badges
- `apps/desktop/src/main/db/queries.ts` — port_registry CRUD
- Config parser: read vite.config, next.config, package.json for configured ports
**Acceptance criteria**:
- [ ] Detect active listening ports per project directory
- [ ] Parse config files for expected ports
- [ ] Show port number + status in sidebar under each project
- [ ] Click port → open `http://localhost:{port}` in default browser
- [ ] Conflict warning when two worktrees use same port

---

## Priority: MEDIUM (UX improvements)

### T08 — Terminal Split Panes
**Status**: PLANNED | **Complexity**: High | **Files**: 5-8
**Description**: Allow splitting terminal views (horizontal/vertical) within a single agent tab, like tmux.
**Depends on**: Nothing
**Key files**:
- `apps/desktop/src/renderer/components/terminal/TerminalPanel.tsx` — refactor for multi-pane
- New: `apps/desktop/src/renderer/components/terminal/TerminalSplitView.tsx`
- `apps/desktop/src/renderer/stores/terminals.ts` — add layout state (pane tree)
- `react-resizable-panels` — already a dependency, use for split layout
**Acceptance criteria**:
- [ ] Split current terminal horizontally or vertically
- [ ] Each pane is an independent terminal
- [ ] Resize panes by dragging divider
- [ ] Close individual panes
- [ ] Keyboard shortcut for split (Cmd+D horizontal, Cmd+Shift+D vertical)

### T09 — Prompts & Templates
**Status**: DISCUSSED | **Complexity**: Medium | **Files**: 5-7
**Description**: Save reusable prompts/templates per project. Quick-copy to clipboard or inject into agent.
**Depends on**: Nothing
**Key files**:
- New: `apps/desktop/src/renderer/components/layout/PromptsSection.tsx` — sidebar section
- New: `apps/desktop/src/renderer/components/workspace/sections/PromptsSection.tsx` — workspace tab
- New: DB migration for prompts table (id, project_id, title, content, category, created_at)
- `apps/desktop/src/main/ipc/procedures/` — new `prompts.ts` procedure
- `apps/desktop/src/main/db/queries.ts` — prompts CRUD
- `apps/desktop/src/renderer/components/workspace/WorkspaceTabs.tsx` — add Prompts tab
- `apps/desktop/src/renderer/components/workspace/WorkspaceView.tsx` — render PromptsSection
**Acceptance criteria**:
- [ ] Create/edit/delete prompt templates per project
- [ ] Categories: task prompts, review prompts, debug prompts, custom
- [ ] One-click copy to clipboard
- [ ] Use as agent task description (pre-fill SpawnAgentDialog)
- [ ] Sidebar section shows recent/pinned prompts

### T10 — File Explorer Panel
**Status**: DISCUSSED | **Complexity**: High | **Files**: 5-8
**Description**: Browse project files from within Exegol. Tree view of the project directory.
**Depends on**: Nothing
**Key files**:
- New: `apps/desktop/src/renderer/components/workspace/FileExplorer.tsx`
- New: `apps/desktop/src/main/ipc/procedures/files.ts` — readdir, stat, read file
- `apps/desktop/src/renderer/components/workspace/sections/AgentsSection.tsx` — add file explorer as secondary panel
- `apps/desktop/src/renderer/stores/` — file explorer state
**Acceptance criteria**:
- [ ] Tree view of project directory
- [ ] Expand/collapse folders
- [ ] File icons by extension
- [ ] Click file → show content in secondary panel (read-only)
- [ ] Show in sidebar or as secondary panel in workspace

### T11 — Re-launch Stopped Agents
**Status**: DISCUSSED | **Complexity**: Low | **Files**: 3-4
**Description**: Add ability to re-launch an agent that was stopped/completed with the same task description.
**Depends on**: Nothing
**Key files**:
- `apps/desktop/src/renderer/components/layout/ProjectsSection.tsx` — add re-launch button to inactive AgentMiniCard
- `apps/desktop/src/renderer/components/workspace/sections/ResourcesSection.tsx` — add re-launch in agent table
- `apps/desktop/src/renderer/hooks/use-trpc.ts` — useSpawnAgent mutation
**Acceptance criteria**:
- [ ] "Re-launch" button on stopped/completed/failed agents
- [ ] Creates new agent with same task description + CLI type
- [ ] Focuses the new agent terminal
- [ ] Original agent stays in history

### T12 — Theme System
**Status**: PLANNED | **Complexity**: Medium | **Files**: 4-6
**Description**: Actually apply the theme selection from Settings. Currently dark is hardcoded.
**Depends on**: Nothing
**Key files**:
- `apps/desktop/src/renderer/styles/globals.css` — add light theme CSS vars
- `apps/desktop/src/renderer/App.tsx` — apply theme class to root element
- `apps/desktop/src/renderer/stores/app.ts` — read theme from settings
- `apps/desktop/src/renderer/components/settings/GeneralSettings.tsx` — theme selector already exists
- `apps/desktop/src/renderer/components/terminal/TerminalPanel.tsx` — terminal theme colors
**Acceptance criteria**:
- [ ] Light theme with appropriate CSS variables
- [ ] System theme auto-detection
- [ ] Theme change applies immediately (no reload)
- [ ] Terminal colors match selected theme

---

## Priority: LOW (Phase 2+ preparation)

### T13 — Recent Sessions (DB-backed)
**Status**: STUB | **Complexity**: Low | **Files**: 3-4
**Description**: Populate the "Recent Sessions" sidebar section with actual past agent sessions from DB.
**Key files**:
- `apps/desktop/src/renderer/components/layout/RecentSessions.tsx`
- `apps/desktop/src/main/db/queries.ts` — query recent completed/stopped agents
- `apps/desktop/src/renderer/hooks/use-trpc.ts` — useRecentSessions hook
- `apps/desktop/src/main/ipc/procedures/agents.ts` — add recentSessions query

### T14 — Per-Agent Process Metrics
**Status**: PLANNED | **Complexity**: Low | **Files**: 2-3
**Description**: Show CPU and memory usage per running agent process.
**Key files**:
- `apps/desktop/src/main/system/resources.ts` — implement getAgentProcessMetrics using `ps -o pcpu,rss -p <pid>`
- `apps/desktop/src/renderer/components/workspace/sections/ResourcesSection.tsx` — show in agent table
- `apps/desktop/src/renderer/components/layout/ProjectsSection.tsx` — show mini metric per agent

### T15 — API Key Management (OS Keychain)
**Status**: PLANNED | **Complexity**: Medium | **Files**: 3-4
**Description**: Store API keys in macOS Keychain / Windows Credential Store instead of plaintext.
**Key files**:
- New dep: `keytar` or `@electron/safeStorage`
- `apps/desktop/src/main/ipc/procedures/settings.ts` — encrypt/decrypt API keys
- `apps/desktop/src/renderer/components/settings/GeneralSettings.tsx` — API key input fields
- Settings tab or new "API Keys" tab

### T16 — Terminal Scrollback Persistence
**Status**: DISCUSSED | **Complexity**: Medium | **Files**: 3-4
**Description**: Save terminal output to disk so it can be reviewed after agent completes or app restarts.
**Key files**:
- `apps/desktop/src/main/agents/manager.ts` — capture scrollback to file on agent stop
- New: scrollback storage (file per agent session in userData)
- `apps/desktop/src/renderer/components/terminal/TerminalPanel.tsx` — load scrollback for stopped agents

---

## Assignment Guide

**Parallelizable tasks** (no dependencies between them):
- T01 + T03 + T04 + T05 + T06 + T07 can all run in parallel
- T08 + T09 + T10 are independent of each other
- T11 + T12 + T13 + T14 are all independent

**Suggested agent assignments** (4 agents in parallel):
- **Agent A**: T01 (Worktrees) → T02 (Diff Viewer) — these are sequential
- **Agent B**: T03 (Token Monitor) + T05 (Scheduler)
- **Agent C**: T04 (Task Viewer) + T09 (Prompts) + T11 (Re-launch)
- **Agent D**: T06 (Open IDE) + T07 (Ports) + T08 (Terminal Split)

**Quick wins** (can be done in <2 hours each):
- T06 (Open in IDE)
- T11 (Re-launch Stopped Agents)
- T13 (Recent Sessions from DB)
- T14 (Per-Agent Process Metrics)
