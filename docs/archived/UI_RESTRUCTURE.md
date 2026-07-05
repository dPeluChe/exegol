# UI Restructure Plan — Agreed March 2026

> Reduce 15 flat tabs to 3 grouped tabs + 1 new pane type + 1 global modal.
> Goal: clean navigation, logical grouping, natural workflow.

## Before (15 tabs)
```
Agents | Tasks | Prompts | Diff | Oplog | Scheduler | Scoring | Skills | Memory | Messages | Queue | Search | Tokens | Resources | Activity
```

## After (3 tabs + sub-tabs)

### Tab 1: Agents (unchanged)
Workspace pane system. Pane types:
- `terminal` — agent CLI
- `browser` — webview with URL bar
- `files` — file explorer + Monaco viewer
- `git` — **NEW**: diff + stage + commit + push + oplog/undo
- `empty` — agent selector grid

### Tab 2: Project (3 sub-tabs)
```
┌─────────────────────────────────────────────┐
│ Tasks (Kanban) │ Prompts & Skills │ Memory  │
└────────────────┴──────────────────┴─────────┘
```

**Tasks (Kanban)**:
- Parses TODO.md/TASKS.md from repo as source of truth
- Renders as kanban cards: Backlog → In Progress → Done
- Assign task → creates worktree + spawns agent with instructions
- Queue is the internal execution engine (not a separate UI)
- Handoff messages appear as task status updates
- Scheduler integration: scheduled tasks appear in backlog

**Prompts & Skills**:
- Toggle between Prompts (per-project text templates) and Skills (global personas)
- Prompts: CRUD, categories, pin, copy, inject into agent
- Skills: browse, toggle per-project, requirement status, role badges

**Memory**:
- Auto-extracted knowledge from agent sessions
- Category filters, search, manual add/delete
- Export to `.exegol/MEMORY.md` (user-triggered)

### Tab 3: Monitor (2 sub-tabs)
```
┌─────────────────────────────────────┐
│ Resources & Tokens │    Scoring     │
└────────────────────┴────────────────┘
```

**Resources & Tokens** (merged):
- System: CPU/RAM/Disk with sparklines
- Per-agent: process metrics
- Token costs: per-model breakdown, per-agent costs, daily trend
- Period selector (7d/14d/30d)

**Scoring**:
- Auto-parsed from agent output (compiles, tests, files changed)
- Success rate by CLI type, by project, over time
- Heuristic signals — not a judge, a counter

## Elements that are no longer tabs

| Was | Becomes |
|-----|---------|
| Diff | Git pane (openable in workspace alongside terminals) |
| Oplog | Section inside Git pane ("Agent Operations" with undo) |
| Search | Cmd+K global modal (spotlight-style) |
| Activity | Sidebar section (collapsible event log) |
| Messages | Integrated into Tasks kanban (handoff = task status) |
| Queue | Internal engine powering Tasks kanban execution |
| Scheduler | Tasks sub-tab integration (scheduled = recurring backlog items) |

## Sidebar (enhanced)
```
Projects
  └─ Project X
      ├─ 2 agents running
      ├─ 3 tasks (1 in progress, 2 backlog)
      ├─ 1 scheduled task
      ├─ 8 memories
      └─ Open in IDE

Recent Sessions
Schedulers Overview
Activity Feed (last 5 events, collapsible)
Resources Overview
```

## Implementation Phases

### Phase 1 — Tab restructuring ✅
- WorkspaceTabs: 15 → 3 main tabs (Agents, Project, Monitor)
- WorkspaceView: sub-tab routing with always-mounted Agents
- PromptsSkillsSection, ResourcesTokensSection (merged)
- GitPane (Diff + Oplog toggle, new pane type)
- Responsive EmptyPane (3 breakpoints)
- Agent cleanup on close (pane/tab/Cmd+W)

### Phase 2 — Settings overhaul ✅
- CliSettings: cards grid, YOLO/Active toggles, registry-connected
- GeneralSettings: IDE cards, theme buttons, Kbd visual hotkeys
- TerminalSettings: font detection, recommended fonts list
- All launchers read from provider registry (enabled filter)

### Phase 3 — Activity to sidebar
- Move ActivitySection content to sidebar as collapsible feed
- Show last 5 events, expandable
- Remove standalone Activity section from workspace

### Phase 4 — Git pane: stage + commit + push
- File list with staged/unstaged toggle
- Stage individual files or all
- Commit message input + commit button
- Push button with remote status
- Oplog section preserved (agent operations + undo)

### Phase 5 — Project run commands
- Detect run scripts from package.json (dev, build, test, lint)
- Quick-run buttons in project sidebar or Project tab
- Port detection integration (show which port after `npm run dev`)
- Stop running processes

### Phase 6 — Cmd+K Search modal
- Spotlight-style overlay (global shortcut)
- Search across: scrollback, prompts, tasks, memories
- Results with entity type icons + snippet preview
- Navigate to result (open pane, scroll to match)

### Phase 7 — Tasks Kanban
- Parse TODO.md as kanban source (Backlog → In Progress → Done)
- Card renderer with drag-and-drop
- Assign task → create worktree + spawn agent
- Queue/Messages integrated as execution layer

### Phase 8 — Bundle Nerd Font
- Include MesloLGS NF in app assets (~1MB)
- @font-face in CSS, always available
- Terminal icons work out of the box
