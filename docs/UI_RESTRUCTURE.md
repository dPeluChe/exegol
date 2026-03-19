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

### Phase 1 — Tab restructuring
- WorkspaceTabs: 15 → 3 main tabs
- WorkspaceView: sub-tab routing
- New ProjectView with internal tab state
- New MonitorView with internal tab state

### Phase 2 — Merge components
- PromptsSkillsSection (merge Prompts + Skills with toggle)
- ResourcesTokensSection (merge Resources + Tokens)
- DiffOplog into Git pane (merge Diff + Oplog)

### Phase 3 — Search modal
- Cmd+K global shortcut
- SearchModal component (spotlight-style overlay)
- Remove Search tab

### Phase 4 — Activity to sidebar
- ActivityFeed sidebar section
- Remove Activity tab

### Phase 5 — Git pane type
- New pane type "git" in workspace store
- GitPane component: file list + diff + stage + commit + oplog
- Openable from empty pane grid or sidebar

### Phase 6 — Tasks Kanban (biggest change)
- Parse TODO.md as kanban source
- Card renderer with drag-and-drop
- Assign → worktree + agent spawn pipeline
- Queue/Messages integrated as execution layer
