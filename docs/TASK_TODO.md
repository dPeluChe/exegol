# Exegol — Task Board

> **Quality gate before PR**:
> - `npx @biomejs/biome check --fix apps/ packages/shared/src/ packages/ui/src/`
> - `npx tsc --noEmit -p apps/desktop/tsconfig.node.json && npx tsc --noEmit -p apps/desktop/tsconfig.web.json`
> - Max 400-500 LOC per file

---

## New Features (inspired by Anvil + Orca analysis)

### T56 — Agent Status via Terminal Title
**Priority**: High | **Effort**: Low | **Source**: Orca
- Read terminal title escape sequences (`\033]0;...\007`) to detect agent state
- Detect: idle, working, permission-needed for Claude Code, Gemini, Codex, etc.
- Complement existing Rust status parser with title-based detection
- Update agent status badge in sidebar without extra IPC

### T57 — Unread/Star Notifications on Worktrees
**Priority**: High | **Effort**: Medium | **Source**: Orca
- Star/unread marker on worktrees (Gmail-like) when agent finishes work
- Auto-set when agent transitions working → idle
- Manual toggle via UI
- Persists across sessions
- Visual badge in sidebar worktree list

### T58 — Runtime Permission Modes
**Priority**: High | **Effort**: Medium | **Source**: Anvil
- Modes: `implement` (all tools), `plan` (read-only + plan files), `approve` (confirm each edit)
- Configurable per agent spawn (SpawnAgentModal selector)
- Runtime mode switching via toolbar button
- Propagates to pipeline steps

### T59 — Virtual Scrolling for Large Lists
**Priority**: Medium | **Effort**: Low | **Source**: Anvil
- Add react-virtuoso or TanStack Virtual to: MemorySection, agent lists, file explorer
- Only render visible items (prevents DOM bloat with 500+ items)

### T60 — Project Hook Scripts (exegol.yaml)
**Priority**: Medium | **Effort**: Medium | **Source**: Orca
- `exegol.yaml` in project root with `setup` and `archive` hooks
- Setup: runs after worktree creation (npm install, env setup, etc.)
- Archive: runs before worktree deletion (cleanup, backup, etc.)
- 2-minute timeout, async non-blocking
- Environment vars: EXEGOL_ROOT_PATH, EXEGOL_WORKTREE_PATH, EXEGOL_BRANCH

---

## Distribution (pending GitHub)

### T45 — CI/CD Release Pipeline
**Priority**: Medium — activate when repo goes to GitHub

### T46 — Canary Channel (optional)
**Priority**: Low

---

## UX Polish (pending)

| Item | Description | Priority |
|------|-------------|----------|
| Timezone config | Verify timestamps display in user's local timezone | Low |
| Polling constants | Centralize refetchInterval values into shared constants | Low |
| Settings UI for pipelineIdleCloseSeconds | Per-provider toggle in Settings | Low |

---

## Completed

V1-V3 + Performance Pass: 69+ tasks complete.
See `docs/tasks_completed/2026_03.md` for full log.
