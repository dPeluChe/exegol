# Exegol — Task Board

> Audience: current contributors planning the next implementation wave after the initial MVP.
> This board is the active backlog for product differentiation, operational confidence, and release readiness.

> **Quality gate before PR**
> - `npx @biomejs/biome check --fix apps/ packages/shared/src/ packages/ui/src/`
> - `npx tsc --noEmit -p apps/desktop/tsconfig.node.json && npx tsc --noEmit -p apps/desktop/tsconfig.web.json`
> - Max 400-500 LOC per file unless a refactor task explicitly says otherwise

---

## Priority Order

### P0 — Must land before broad release push
- Worktrees real por agente
- Inbox de revisión y atención
- Review flow con resumen de riesgo
- Performance stabilization pass
- Command Palette
- Multi-agent paralelo sobre worktrees

### P1 — Strong differentiation right after P0
- Session resume determinístico
- Agent hook system con eventos estructurados
- Repo map + semantic search

### P2 — Valuable follow-ups once the core is stable
- Diff line comments
- Activity classification
- Lifecycle scripts por proyecto
- Issue tracker expansion
- Dark-black theme

### P3 — Strategic bets / larger scope
- SSH remote development
- CI/CD release pipeline
- Canary channel

---

## Active Backlog

### T56 — Agent Status via Terminal Title
**Priority**: High | **Effort**: Low | **Source**: Orca

**Why**
- Complement the current Rust stdout/status parsing with title escape sequence signals.
- Reduces parser brittleness for providers that already expose state in terminal title.

**Scope**
- Read terminal title escape sequences (`\033]0;...\007`) in PTY flow
- Detect: idle, working, permission-needed, waiting-input
- Update agent badge/state without extra renderer polling

**Likely files**
- `apps/desktop/src/main/terminal/*`
- `apps/desktop/src/main/agents/title-status.ts`
- `apps/desktop/src/renderer/stores/agents.ts`

---

### T57 — Review Inbox / Attention Center
**Priority**: P0 | **Effort**: Medium | **Source**: cmux + Orca + Exegol analysis

**Why**
- Exegol needs a single place to see which agent needs attention right now.
- This directly attacks supervision fatigue in multi-agent workflows.

**Scope**
- Replace simple unread/star markers with a real inbox model
- Track attention states: `needs_input`, `review_ready`, `completed_unread`, `failed`, `permission_needed`
- Show unread badge, last meaningful status text, branch, listening port, and latest test signal
- Persist per-agent attention state across app restarts
- Add sidebar surface plus workspace section for triage

**Acceptance**
- A stopped or waiting agent is visible in one triage surface without opening its pane
- User can mark items as read / starred / pinned
- Attention state survives restart

**Likely files**
- `apps/desktop/src/main/agents/*`
- `apps/desktop/src/main/system/ports.ts`
- `apps/desktop/src/renderer/components/layout/*`
- `apps/desktop/src/renderer/components/workspace/sections/AgentsSection.tsx`
- `apps/desktop/src/renderer/stores/agents.ts`

---

### T58 — Runtime Permission Modes
**Priority**: High | **Effort**: Medium | **Source**: Anvil

**Why**
- Creates clearer runtime control for risky or high-cost agent sessions.
- Useful foundation for scheduler, hooks, and later automations.

**Scope**
- Modes: `implement`, `plan`, `approve`
- Configurable at spawn time
- Runtime mode switching via toolbar or agent controls
- Propagate mode into pipeline steps and scheduler runs

**Likely files**
- `apps/desktop/src/main/agents/*`
- `apps/desktop/src/main/pipeline/*`
- `apps/desktop/src/renderer/components/agents/SpawnAgentModal.tsx`
- `apps/desktop/src/renderer/components/terminal/*`

---

### T59 — Virtual Scrolling for Large Lists
**Priority**: Medium | **Effort**: Low | **Source**: Anvil

**Why**
- Cheap performance win for large projects and long-running sessions.

**Scope**
- Add virtualization to agent lists, memory lists, and file explorer
- Prefer small dependency footprint and avoid rewriting list behavior

**Likely files**
- `apps/desktop/src/renderer/components/layout/*`
- `apps/desktop/src/renderer/components/workspace/FileExplorer.tsx`
- `apps/desktop/src/renderer/components/workspace/sections/MemorySection.tsx`

---

### T60 — Project Hook Scripts (`exegol.yaml`)
**Priority**: P2 | **Effort**: Medium | **Source**: Orca + Emdash

**Why**
- Projects often need setup/teardown steps around worktree creation and archival.
- This becomes much more useful once worktrees are real.

**Scope**
- `exegol.yaml` in project root with `setup`, `archive`, `preAgent`, `postAgent` hooks
- 2-minute timeout and non-blocking execution
- Environment vars: `EXEGOL_ROOT_PATH`, `EXEGOL_WORKTREE_PATH`, `EXEGOL_BRANCH`, `EXEGOL_AGENT_ID`

**Depends on**
- T61 for worktree lifecycle integration

**Likely files**
- `apps/desktop/src/main/hooks/*`
- `apps/desktop/src/main/agents/*`
- `apps/desktop/src/main/db/*`

---

### T61 — Real Worktree Isolation per Agent
**Priority**: P0 | **Effort**: High | **Source**: Codex + Superset + Exegol analysis

**Why**
- Biggest trust gap today: agents still run in the project root instead of isolated worktrees.
- This is the main operational-confidence feature for release.

**Scope**
- Wire the existing Rust git2 scaffold into agent spawn flow
- Create one worktree per agent with deterministic branch naming
- Persist worktree metadata and auto-cleanup policy
- Allow handoff/continue to reuse or branch from prior worktree when appropriate
- Surface current worktree path and branch in UI

**Acceptance**
- New agent spawns into its own worktree, not the root project
- Two agents can modify the same repo in parallel without touching each other
- Worktree cleanup is explicit, safe, and logged

**Likely files**
- `packages/core-rust/src/git/*`
- `apps/desktop/src/main/agents/*`
- `apps/desktop/src/main/db/*`
- `apps/desktop/src/main/ipc/procedures/agents.ts`
- `packages/shared/*`

---

### T62 — Review Readiness + Risk Summary
**Priority**: P0 | **Effort**: Medium | **Source**: Exegol analysis

**Why**
- Diff alone is not enough; the review bottleneck is reading and reconstructing risk manually.

**Scope**
- Create a “ready for review” summary per agent/session
- Include: files touched, commands run, tests detected, open ports, dependency file changes, binary changes, and failure signals
- Add a compact reviewer summary card before full diff
- Make review state visible from sidebar and diff workspace

**Acceptance**
- Reviewer can understand blast radius without opening every file hunk
- High-risk changes are highlighted first

**Likely files**
- `apps/desktop/src/main/ipc/procedures/diff.ts`
- `apps/desktop/src/main/agents/scoring.ts`
- `apps/desktop/src/main/system/ports.ts`
- `apps/desktop/src/renderer/components/workspace/sections/DiffSection.tsx`
- `apps/desktop/src/renderer/components/workspace/GitPane.tsx`

---

### T63 — Desktop Performance Stabilization Pass
**Priority**: P0 | **Effort**: Medium | **Source**: Exegol analysis

**Why**
- The current product has several hotspots that will get worse as more features land.
- This should happen before adding more constant polling and heavy summaries.

**Scope**
- Replace scattered polling with centralized push-first refresh where possible
- Reduce or cache heavy resource calls (`du`, `git worktree`, `pgrep`, `ps`)
- Stop reparsing full diffs when only status metadata changed
- Move sync file I/O in the main process to async where it affects user flows
- Centralize refetch constants and stop duplicate intervals

**Hotspots already identified**
- `apps/desktop/src/renderer/hooks/use-trpc.ts`
- `apps/desktop/src/renderer/hooks/use-trpc-resources.ts`
- `apps/desktop/src/main/system/resources.ts`
- `apps/desktop/src/main/ipc/procedures/files.ts`
- `apps/desktop/src/renderer/components/workspace/FileExplorer.tsx`

**Acceptance**
- Fewer background intervals
- Lower CPU wakeups while idle
- Large repos remain responsive while resources/diff/task panes are open

---

### T64 — Command Palette
**Priority**: P0 | **Effort**: Low | **Source**: Emdash

**Why**
- High UX value for relatively small effort.
- Gives one entry point for projects, agents, panes, settings, search, and commands.

**Scope**
- `Cmd+Shift+P` global palette
- Search projects, agents, tabs, settings, scheduler actions, prompts, and common commands
- Fuzzy search with keyboard-only navigation

**Likely files**
- `apps/desktop/src/renderer/components/*`
- `apps/desktop/src/renderer/hooks/use-hotkeys.ts`
- `apps/desktop/src/renderer/stores/app.ts`

---

### T65 — Parallel Multi-Agent on Worktrees
**Priority**: P0 | **Effort**: Medium | **Source**: Emdash + Codex + Exegol analysis

**Why**
- Pipelines are useful, but Exegol also needs “3 agents attack one problem in parallel, then compare”.
- Strong user-facing differentiator once T61 exists.

**Scope**
- Add a parallel execution mode for one task across N worktrees
- Shared prompt template, isolated branches/worktrees
- Compare runs in one review surface
- Allow “promote best result” or continue from selected branch

**Depends on**
- T61

**Likely files**
- `apps/desktop/src/main/pipeline/*`
- `apps/desktop/src/main/agents/*`
- `apps/desktop/src/renderer/components/workspace/sections/PipelineSection.tsx`
- `apps/desktop/src/renderer/hooks/use-trpc-pipeline.ts`

---

### T66 — Session Isolation & Deterministic Resume
**Priority**: P1 | **Effort**: Medium | **Source**: Emdash

**Why**
- Users expect “continue where it left off” after app close/crash.
- Exegol already has PTY sidecar and scrollback persistence, so this is a natural next step.

**Scope**
- Deterministic `session-id` mapping per provider where supported
- Persist PTY session map and agent-to-session relationship
- Discover resumable sessions on startup
- Resume with explicit user action and safety checks

**Depends on**
- T61 recommended

**Likely files**
- `apps/desktop/src/main/terminal/*`
- `apps/desktop/src/main/agents/*`
- `apps/desktop/src/main/db/*`
- `apps/desktop/src/renderer/components/terminal/*`

---

### T67 — Agent Hook Event System
**Priority**: P1 | **Effort**: Medium | **Source**: Emdash + Codex direction

**Why**
- Output parsing alone is fragile.
- Structured agent-originated events enable better review, inbox, scheduler, and automations.

**Scope**
- Local callback endpoint or secure IPC bridge for agent-emitted events
- Supported events: task complete, permission needed, test result, PR opened, review ready
- Per-agent token/secret for event auth
- Native hook support for providers that expose it; wrapper fallback for others

**Likely files**
- `apps/desktop/src/main/agents/*`
- `apps/desktop/src/main/terminal/shell-wrappers.ts`
- `apps/desktop/src/main/hooks/*`
- `apps/desktop/src/main/ipc/*`

---

### T68 — Repo Map + Semantic Search
**Priority**: P1 | **Effort**: High | **Source**: Aider + Exegol analysis

**Why**
- This is one of the clearest ways to improve agent performance on large repos.
- Strong differentiator when combined with handoff, skills, and pipelines.

**Scope**
- Tree-sitter repo map generation in Rust
- Definition/reference graph and ranking
- Token-budgeted map injection into spawn context
- Semantic search over repo map + sessions + skills

**Acceptance**
- Agents can receive compact repo-aware context automatically
- Search can answer semantic intent, not just string match

**Likely files**
- `packages/core-rust/src/*`
- `apps/desktop/src/main/memory/*`
- `apps/desktop/src/main/ipc/procedures/search.ts`
- `apps/desktop/src/main/db/queries/search.ts`
- `apps/desktop/src/renderer/components/workspace/sections/SearchSection.tsx`

---

### T69 — Diff Review with Line Comments
**Priority**: P2 | **Effort**: Medium | **Source**: Emdash

**Why**
- Good next step after T62, but not as urgent as solving review readiness first.

**Scope**
- Persist inline review comments per file/hunk/line
- Add comment threads in unified/split diff
- Optional “merge/review complete” workflow state

**Depends on**
- T62 preferred

**Likely files**
- `apps/desktop/src/main/ipc/procedures/diff.ts`
- `apps/desktop/src/main/db/*`
- `apps/desktop/src/renderer/components/workspace/sections/diff/*`

---

### T70 — Activity Classification (Busy / Idle / Neutral)
**Priority**: P2 | **Effort**: Low | **Source**: Emdash

**Why**
- Adds a finer-grained signal than raw status parsing.
- Useful for T57 attention routing.

**Scope**
- Real-time classification per provider
- Debounced busy/idle transitions
- Visual language in sidebar and terminal tab chrome

**Depends on**
- T56 is complementary but not required

**Likely files**
- `apps/desktop/src/main/agents/status-parser.ts`
- `apps/desktop/src/main/agents/title-status.ts`
- `apps/desktop/src/renderer/components/layout/*`

---

### T71 — Issue Tracker Expansion (Linear / Jira)
**Priority**: P2 | **Effort**: Medium | **Source**: Emdash

**Why**
- GitHub Issues is a good start, but adoption expands if task ingest is not GitHub-only.

**Scope**
- Add Linear and Jira task import/create flows
- Convert ticket into task/prompt/agent assignment
- Link review outcome or PR back to source ticket

**Likely files**
- `apps/desktop/src/main/ipc/procedures/github.ts`
- `apps/desktop/src/main/ipc/*`
- `apps/desktop/src/renderer/components/workspace/sections/TasksSection.tsx`

---

### T72 — Dark-Black Theme
**Priority**: P2 | **Effort**: Low | **Source**: Emdash

**Why**
- Quick UX win, especially for OLED-heavy users.

**Scope**
- Add `dark-black` variant to current theme system
- Keep xterm and chrome aligned

**Likely files**
- `apps/desktop/src/renderer/styles/globals.css`
- `apps/desktop/src/renderer/hooks/use-theme.ts`
- `apps/desktop/src/renderer/components/settings/GeneralSettings.tsx`

---

### T73 — SSH Remote Development
**Priority**: P3 | **Effort**: High | **Source**: Emdash

**Why**
- High upside, but too large to mix into the current release-critical wave.

**Scope**
- Remote project registration via SSH
- PTY over SSH with reconnect/persistence strategy
- Remote git/worktree operations
- Credentials in OS keychain

**Likely files**
- New remote subsystem in `apps/desktop/src/main/*`
- Agent spawn flow
- Project model and settings

---

## Execution Lanes for Parallel Work

Use these lanes only if multiple agents are working concurrently. The goal is disjoint write sets.

### Lane A — Git Isolation Core
**Tasks**
- T61
- T65
- T66

**Owned files**
- `packages/core-rust/src/git/*`
- `apps/desktop/src/main/agents/*`
- `apps/desktop/src/main/terminal/*`
- `apps/desktop/src/main/ipc/procedures/agents.ts`
- `apps/desktop/src/main/db/*`

**Do not overlap with**
- Diff UI work in Lane C
- Renderer performance work in Lane D unless a shared interface is agreed first

### Lane B — Attention / UX Command Surfaces
**Tasks**
- T57
- T64
- T70
- T72

**Owned files**
- `apps/desktop/src/renderer/components/layout/*`
- `apps/desktop/src/renderer/components/common/*`
- `apps/desktop/src/renderer/hooks/use-hotkeys.ts`
- `apps/desktop/src/renderer/stores/*`

**Do not overlap with**
- Git/Diff procedure changes in Lane C

### Lane C — Review Experience
**Tasks**
- T62
- T69

**Owned files**
- `apps/desktop/src/main/ipc/procedures/diff.ts`
- `apps/desktop/src/renderer/components/workspace/GitPane.tsx`
- `apps/desktop/src/renderer/components/workspace/sections/DiffSection.tsx`
- `apps/desktop/src/renderer/components/workspace/sections/diff/*`

**Do not overlap with**
- T63 changes to diff refresh behavior unless coordinated up front

### Lane D — Performance / Main Process Hygiene
**Tasks**
- T59
- T63

**Owned files**
- `apps/desktop/src/renderer/hooks/use-trpc*.ts`
- `apps/desktop/src/main/system/resources.ts`
- `apps/desktop/src/main/ipc/procedures/files.ts`
- `apps/desktop/src/renderer/components/workspace/FileExplorer.tsx`

**Do not overlap with**
- Lane C diff UI files

### Lane E — Intelligence Layer
**Tasks**
- T67
- T68
- T71

**Owned files**
- `apps/desktop/src/main/hooks/*`
- `apps/desktop/src/main/memory/*`
- `apps/desktop/src/main/ipc/procedures/search.ts`
- `apps/desktop/src/main/db/queries/search.ts`
- `apps/desktop/src/renderer/components/workspace/sections/SearchSection.tsx`

**Do not overlap with**
- Lane A unless a shared spawn-context contract changes

---

## Suggested Order

1. T61 — Real Worktree Isolation per Agent
2. T63 — Desktop Performance Stabilization Pass
3. T57 — Review Inbox / Attention Center
4. T62 — Review Readiness + Risk Summary
5. T64 — Command Palette
6. T65 — Parallel Multi-Agent on Worktrees
7. T66 — Session Isolation & Deterministic Resume
8. T67 — Agent Hook Event System
9. T68 — Repo Map + Semantic Search

---

## Distribution (pending GitHub)

### T45 — CI/CD Release Pipeline
**Priority**: P3 — activate when repo goes to GitHub

### T46 — Canary Channel
**Priority**: P3

---

## Completed

V1-V3 + performance pass: 69+ tasks complete.
See `docs/tasks_completed/2026_03.md` for the full log.
