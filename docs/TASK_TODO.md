# Exegol — Task Board V3

> **Quality gate before PR**:
> - `npx @biomejs/biome check --fix apps/ packages/shared/src/ packages/ui/src/`
> - `npx tsc --noEmit -p apps/desktop/tsconfig.node.json && npx tsc --noEmit -p apps/desktop/tsconfig.web.json`
> - Max 400-500 LOC per file
> - Log work in `docs/tasks_completed/2026_03.md`

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

**Problem**: Panes within a split tab cannot be dragged out to create a new independent tab. Only tab-to-tab merge is supported.

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
- [x] T07 — Port Conflict Detection (detectPortConflicts + portConflicts endpoint)
- [x] T19 — Dynamic Model Catalog (DB-backed with 9 model defaults, settings.modelCatalog)
- [x] T33 — LLM-as-Judge Tier 3 (claude-haiku eval, clarity/completeness/correctness)
- [x] T39 — Diff Viewer UX (collapsed default, split view, expand/collapse all)
- [x] T39b — Terminal Loading State (spinner + agent name until first data)
- [x] T40 — Tab Auto-Naming + Icons (derive from pane type, respect manual renames)
- [x] T40 — Tab DnD Reorder + Merge (drag tabs to reorder, drop on pane for directional split)
- [x] T41 — Agent Launcher Pane Fix (never replace running agents)
- [x] T42 — Tab Keyboard Navigation (Ctrl+Tab, Cmd+Shift+]/[, Cmd+1-9)

### Bug Fixes (this session)
- [x] Shell readiness only for plain shells (no 15s timeout on agent CLIs)
- [x] Scrollback sync flush on exit (no more "No history available")
- [x] Auto-create tab when tabs=0 (no dead-end empty state)
- [x] DnD stopPropagation (tab reorder doesn't trigger pane merge)
- [x] xterm refit after merge (requestAnimationFrame + exegol:refit-terminals)
- [x] notify.sh guard (EXEGOL_AGENT_ID check prevents external Claude sessions)

---

## Previous Completed

V1 (T01-T16) and V2 (T17-T34): 34/34 tasks complete.
See `docs/tasks_completed/2026_03.md` for full log.
V2 board archived at `docs/archived/TASK_TODO_V2.md`.
