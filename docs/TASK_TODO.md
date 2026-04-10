# Exegol — Task Board

> Audience: current contributors planning the next implementation wave after the initial MVP.
> This board is the active backlog for product differentiation, operational confidence, and release readiness.

> **Quality gate before PR**
> - `npx @biomejs/biome check --fix apps/ packages/shared/src/ packages/ui/src/`
> - `npx tsc --noEmit -p apps/desktop/tsconfig.node.json && npx tsc --noEmit -p apps/desktop/tsconfig.web.json`
> - Max 400-500 LOC per file unless a refactor task explicitly says otherwise

---

## Priority Order

### P0 — Pre-launch polish wave ✅ COMPLETED (v0.3.0)
> Goal: ship a tight, fast, delightful V1 before tackling any new feature surface.
- ~~**Smart git button** (T83)~~ ✅ — context-aware button with 11 states + AI commit messages
- ~~**Picture-in-Picture pane float** (T84)~~ ✅ — terminal + browser floating windows
- ~~**Layout presets** (T85)~~ ✅ — 6 built-in + custom saved + Bottom Terminal w/ shell
- ~~**First paint optimization** (T86)~~ ✅ — 4-12ms criticalPath, ~280ms firstPaint dev
- ~~**Renderer bundle audit** (T87)~~ ✅ — 1,987 KB → 1,026 KB (−48%) via lazy chunks

Bonus wins in the same wave (not in the original T83-T87 scope):
- Sidecar version protocol + auto-upgrade (session.listInfo)
- Real dead-session recovery (no more stuck-as-running agents)
- 3 Nerd Fonts bundled (MesloLGS NF, FiraCode NF, JetBrainsMono NF) — 6.8 MB
- Font settings UX: grouped list, per-card preview, promote on click
- Cmd+W closes pane (not window) via custom macOS app menu
- Workspace as default view + stale project auto-recovery
- Browser pane back/forward/reload + empty state
- Terminal "Starting..." overlay no longer stuck on reattach

### P0 — Must land before broad release push
- ~~Worktrees real por agente~~ ✅ T61
- Inbox de revisión y atención (T57)
- ~~Review flow con resumen de riesgo~~ ✅ T62
- ~~Performance stabilization pass~~ ✅ T63
- ~~Command Palette~~ ✅ T64
- Multi-agent paralelo sobre worktrees (T65)
- ~~**Test coverage (T74)**~~ ✅
- ~~**Monolith decomposition (T75)**~~ ✅

### P1 — Strong differentiation right after P0
- ~~Session resume determinístico~~ ✅ T66
- ~~Agent hook system con eventos estructurados~~ ✅ T67
- Repo map + semantic search (T68)
- ~~**Tier 3 scoring via SDK (T76)**~~ ✅
- **DB validation layer (T77)** — Zod schemas for DB rows

### P2 — Valuable follow-ups once the core is stable
- Diff line comments
- Activity classification
- **Pipeline state machine (T78)** — explicit transitions
- ~~**MCP reconnection (T79)**~~ ✅
- **Structured error handling (T80)** — transient vs permanent classification
- **DI for singletons (T81)** — testability improvement
- **Shared package enrichment (T82)** — more Zod schemas for IPC/DB payloads
- **Ralph loops in pipelines** (T88) — evaluator step for iterative refinement
- **Exegol CLI** (T89) — headless client over sidecar socket
- **Terminal ↔ Chat dual view** (T90) — same session, two presentations
- **Lifecycle scripts per repo** (T91) — setup/run/teardown in git
- Issue tracker expansion
- ~~Dark-black theme~~ ✅ T72

### P3 — Strategic bets / larger scope
- SSH remote development
- CI/CD release pipeline
- Canary channel
- **Cross-repo workspaces** (T92) — front + back in one workspace
- **Mobile companion** (T93) — monitor agents from phone via daemon
- **Headless daemon mode** (T94) — remote WebSocket for cloud/server deploys

---

## Active Backlog

### T56 — Agent Status via Terminal Title ✅ COMPLETED
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

### T61 — Real Worktree Isolation per Agent ✅ COMPLETED (PR #13)
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

### T62 — Review Readiness + Risk Summary ✅ COMPLETED (PR #11)
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

### T63 — Desktop Performance Stabilization Pass ✅ COMPLETED (PR #12)
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

### T64 — Command Palette ✅ COMPLETED
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

### T66 — Session Isolation & Deterministic Resume ✅ COMPLETED
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

### T67 — Agent Hook Event System ✅ COMPLETED
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

### T72 — Dark-Black Theme ✅ COMPLETED
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

---

## Codebase Quality & Health (from deep analysis)

> These tasks surfaced from a comprehensive codebase audit (April 2026).
> They address technical debt, testability, and robustness gaps that will compound if left unattended.

### T74 — Test Coverage Foundation ✅ COMPLETED (PR #14)
**Priority**: P0 | **Effort**: High | **Source**: Deep codebase analysis

**Why**
- The project has **zero TypeScript/JavaScript tests**. With ~32K LOC and complex business logic
  (pipeline state machine, scoring heuristics, memory extraction, handoff generation, ring buffer),
  this is the single highest technical risk. A bug in the pipeline state machine or scoring formula
  can silently corrupt data with no safety net.

**Scope**
- Add Vitest (preferred) or Jest as test runner
- Priority 1: Unit tests for pure functions:
  - `agents/scoring.ts` — scoring formula, Tier 1 regex patterns, composite score calculation
  - `agents/handoff.ts` — token limit detection patterns, scrollback summary generation
  - `memory/extractor.ts` — extraction rules, deduplication logic, similarity scoring
  - `memory/store.ts` — relevance scoring formula, token budget enforcement
  - `pipeline/context.ts` — prompt template interpolation (`{{task}}`, `{{diff}}`, `{{previousOutput}}`)
  - `terminal/ring-buffer.ts` — write, wrap, snapshot correctness
- Priority 2: Integration tests:
  - Pipeline state transitions (pending → running → paused → completed → cancelled)
  - Queue executor dispatch with dependency resolution
  - Agent spawn lifecycle with worktree creation/cleanup
- Priority 3: Component tests for critical UI:
  - WorkspacePane pane type rendering
  - Agent store push event handling
- Target: ≥60% coverage on main process business logic

**Likely files**
- New: `apps/desktop/src/main/__tests__/*`
- New: `apps/desktop/src/renderer/__tests__/*`
- `package.json` (add test runner dependency + script)
- `apps/desktop/package.json` or `apps/desktop/vitest.config.ts`

---

### T75 — Monolith File Decomposition ✅ COMPLETED (PR #14)
**Priority**: P0 | **Effort**: Medium | **Source**: Deep codebase analysis

**Why**
- Four files significantly exceed the 400-500 LOC quality gate:
  - `manager.ts` (~682 LOC): AgentManager handles spawn, reattach, stop, worktree cleanup,
    output processing, scrollback buffering, completion callbacks, title tracking
  - `WorkspacePane.tsx` (~800 LOC / 28KB): single component renders 5 pane types
  - `executor.ts` (~550 LOC / 19KB): PipelineExecutor with complex state machine
  - `pty-host.ts` (~630 LOC / 21KB): PtyHost handles legacy + sidecar + shell gating + scrollback

**Scope**
- `manager.ts` → split into:
  - `agent-spawner.ts` (spawn logic, worktree setup, env building)
  - `agent-output-processor.ts` (output parsing, scrollback buffering, token limit detection)
  - `agent-lifecycle.ts` (stop, cleanup, reattach, completion callbacks)
  - `agent-manager.ts` (thin orchestrator, public API)
- `WorkspacePane.tsx` → extract each pane type into its own component:
  - `TerminalPaneContent.tsx`, `BrowserPaneContent.tsx`, `FilesPaneContent.tsx`,
  - `GitPaneContent.tsx`, `EmptyPaneContent.tsx`
- `executor.ts` → split into:
  - `pipeline-state-machine.ts` (transition logic, validation)
  - `pipeline-agent-spawner.ts` (step execution, YOLO flag injection)
  - `pipeline-executor.ts` (orchestrator, public API)
- `pty-host.ts` → split into:
  - `pty-session-manager.ts` (session lifecycle, cleanup)
  - `pty-shell-gating.ts` (shell readiness marker logic)
  - `pty-scrollback.ts` (scrollback flush, throttle)
  - `pty-host.ts` (thin facade)

**Acceptance**
- No file exceeds 400 LOC (excluding type-only files)
- All existing behavior preserved (no functional changes)
- Quality gate passes after refactor

---

### T76 — Replace curl with SDK in Tier 3 Scoring ✅ COMPLETED
**Priority**: P1 | **Effort**: Low | **Source**: Deep codebase analysis

**Why**
- Tier 3 LLM-as-judge scoring calls the Anthropic API via `execFile("curl", ...)`:
  - API key travels as a CLI argument (visible in `ps aux`)
  - No retry logic on transient failures
  - Manual JSON parsing from stdout is fragile
  - 30s timeout doesn't cover all edge cases

**Scope**
- Replace `execFileAsync("curl", ...)` with either:
  - The `@anthropic-ai/sdk` package (preferred, already exists in the ecosystem)
  - Or `fetch()` with proper headers (lighter alternative)
- Add structured error handling (rate limit, timeout, auth error)
- Ensure API key is never passed as CLI argument
- Keep the non-fatal pattern (scoring never blocks agent completion)

**Likely files**
- `apps/desktop/src/main/agents/scoring.ts` — `evaluateTier3()` function

---

### T77 — DB Row Validation with Zod Schemas
**Priority**: P1 | **Effort**: Medium | **Source**: Deep codebase analysis

**Why**
- DB rows are cast with `as Record<string, unknown>` and mapped manually
  (`row.id as string`, `row.status as AgentStatus`). No validation layer exists between
  SQLite and business logic. A schema mismatch or migration gap can cause silent type corruption.

**Scope**
- Add Zod schemas for all DB row types in `packages/shared/src/schemas/`:
  - `agent-row.ts`, `project-row.ts`, `worktree-row.ts`, `pipeline-row.ts`
  - `memory-row.ts`, `score-row.ts`, `activity-row.ts`, etc.
- Validate rows at the query boundary (in `db/queries/*.ts`)
- Use `schema.parse(row)` or `schema.safeParse(row)` with logging on failure
- Keep performance in mind: parse on read, not on every intermediate operation

**Likely files**
- `packages/shared/src/schemas/*` (new schemas)
- `apps/desktop/src/main/db/queries/*.ts` (add validation)
- `apps/desktop/src/main/db/migrations.ts` (ensure new columns have schemas)

---

### T78 — Explicit Pipeline State Machine
**Priority**: P2 | **Effort**: Medium | **Source**: Deep codebase analysis

**Why**
- Pipeline state transitions (pending → running → paused → completed → cancelled) are handled
  via direct DB updates + callbacks without explicit transition validation. Invalid transitions
  (e.g., cancelling a completed pipeline, advancing a cancelled one) are not guarded.

**Scope**
- Define allowed transitions as a map:
  ```
  pending  → running
  running  → paused, completed, failed, cancelled
  paused   → running, cancelled
  completed → (terminal)
  failed   → (terminal)
  cancelled → (terminal)
  ```
- Add transition guard in `PipelineExecutor` methods
- Log invalid transition attempts as warnings
- Optionally: use a lightweight FSM library (xstate/fsm) or just a transition table

**Likely files**
- `apps/desktop/src/main/pipeline/executor.ts`
- New: `apps/desktop/src/main/pipeline/state-machine.ts`

---

### T79 — MCP Host Auto-Reconnection ✅ COMPLETED
**Priority**: P2 | **Effort**: Low | **Source**: Deep codebase analysis

**Why**
- The MCP host connects via stdio or HTTP but has no reconnection logic. If an MCP server
  crashes or restarts, it stays in "error" state until the user reconnects manually.
  This is especially painful for stdio-based servers that may crash on large inputs.

**Scope**
- Add exponential backoff reconnection for disconnected servers
- Track last-known config in `McpHost.servers` for reconnection
- Limit retries (max 5 attempts, then mark as "failed")
- Add manual reconnect button in UI (or auto-reconnect on next tool call)
- Emit IPC event on reconnection status change

**Likely files**
- `apps/desktop/src/main/mcp/host.ts`
- `apps/desktop/src/main/ipc/procedures/mcp.ts`
- `apps/desktop/src/renderer/hooks/use-trpc-mcp.ts`

---

### T80 — Structured Error Classification
**Priority**: P2 | **Effort**: Medium | **Source**: Deep codebase analysis

**Why**
- Error handling is inconsistent: some operations are "non-fatal, try/catch" (scoring, memory,
  worktree cleanup), others propagate errors. There's no classification between transient
  (retryable) and permanent (fatal) errors. This makes debugging harder and prevents intelligent
  retry logic.

**Scope**
- Define error classes: `TransientError`, `PermanentError`, `TimeoutError`
- Classify known failure modes:
  - Transient: DB locked, socket ECONNREFUSED, API rate limit
  - Permanent: file not found, invalid config, auth failure
  - Timeout: PTY spawn, API call, git operation
- Add retry helper for transient errors (max 3, exponential backoff)
- Standardize logger calls with error classification metadata

**Likely files**
- New: `apps/desktop/src/main/lib/errors.ts`
- `apps/desktop/src/main/lib/logger.ts` (enrich with error type)
- All main process modules (gradual adoption)

---

### T81 — Dependency Injection for Singletons
**Priority**: P2 | **Effort**: Medium | **Source**: Deep codebase analysis

**Why**
- Six core subsystems use global singletons: `getAgentManager()`, `getPtyHost()`,
  `getPipelineExecutor()`, `getSchedulerEngine()`, `getProviderRegistry()`, `getMcpHost()`.
  This makes unit testing nearly impossible (can't inject mocks), prevents parallel test execution,
  and makes reasoning about state harder.

**Scope**
- Introduce a lightweight AppContext or ServiceContainer:
  ```ts
  interface AppContext {
    db: Database;
    agentManager: AgentManager;
    ptyHost: PtyHost;
    pipelineExecutor: PipelineExecutor;
    scheduler: SchedulerEngine;
    registry: AgentProviderRegistry;
    mcpHost: McpHost;
  }
  ```
- Pass context via constructor injection (not global accessors)
- Keep singletons as a thin facade for backward compat during migration
- Enable test contexts with mock implementations

**Likely files**
- New: `apps/desktop/src/main/app-context.ts`
- All singleton modules (gradual migration)

---

### T82 — Shared Package Schema Enrichment
**Priority**: P2 | **Effort**: Low | **Source**: Deep codebase analysis

**Why**
- `@exegol/shared` has 18 type files but only 5 Zod schemas. IPC payloads and DB rows
  lack runtime validation. Adding schemas would catch contract violations at the boundary
  between main/renderer processes.

**Scope**
- Add Zod schemas for:
  - IPC request/response payloads (tRPC procedure inputs)
  - DB write operations (AgentCreate, ProjectCreate, etc.)
  - MCP tool call results
  - Pipeline step definitions and run states
  - Scheduler task definitions
- Export from `packages/shared/src/schemas/index.ts`
- Use in tRPC procedure validators (`.input(schema)`)

**Likely files**
- `packages/shared/src/schemas/*` (new and existing)
- `packages/shared/src/types/*` (keep types, add corresponding schemas)

---

## Pre-launch Polish Wave

### T83 — Smart Git Button in GitPane ✅ COMPLETED (v0.3.0)
**Priority**: P0 | **Effort**: Low (1 day) | **Source**: Superconductor inspiration

**Shipped**
- `diff.gitState` / `createPullRequest` / `mergePullRequest` /
  `suggestCommitMessage` tRPC procedures.
- `SmartGitAction` component with 11 states: conflicts, commit (N files),
  push, push-new-branch, create-PR, merge-PR, view-PR, pr-merged,
  pr-closed, install-gh, up-to-date.
- gh CLI detection cached on first use.
- Sparkles button on the commit input runs Claude Haiku on the diff to
  generate a conventional-commit-style message (gated on Anthropic API
  key).

**Why**
- GitPane currently shows diff + oplog but commit/push/PR flow requires multiple
  manual steps. A single context-aware button that knows what comes next (stage →
  commit → push → PR → merge → resolve conflicts) is one of the highest-value UX
  wins for non-power-git-users working alongside agents.
- Reduces switching to terminal for routine git operations.

**Scope**
- Add a `SmartGitAction` component in GitPane that computes the next action based
  on git state:
  - Dirty working tree → "Commit changes"
  - Committed + no upstream → "Push branch"
  - Pushed + no PR → "Create PR" (via `gh pr create`)
  - PR exists + mergeable → "Merge PR"
  - Conflicts → "Resolve conflicts" (open conflict view)
- Show a preview label with the next-state badge
- Commit message picker: auto-generated from diff (reuse scoring SDK path) or manual
- Customizable action chain per project (store in settings)
- All actions surface result via existing toast stack

**Likely files**
- `apps/desktop/src/renderer/components/workspace/GitPane.tsx`
- New: `apps/desktop/src/renderer/components/workspace/SmartGitAction.tsx`
- `apps/desktop/src/main/ipc/procedures/git.ts` (new commit/push/pr helpers)
- `packages/core-rust/src/git/*` (porcelain state detection)

---

### T84 — Picture-in-Picture Pane Float ✅ COMPLETED (v0.3.0)
**Priority**: P0 | **Effort**: Low (half day) | **Source**: Superconductor inspiration

**Shipped**
- `apps/desktop/src/main/windows/floating.ts` manages per-paneId
  BrowserWindows (frameless, alwaysOnTop: "floating").
- Renderer routes on `?floatingPane=...` query string: main window
  mounts `<App/>`, floating windows lazy-load `<FloatingPaneRoot/>`.
- Terminal float shares the PTY via ring buffer + getSnapshot replay.
  Main pane shows a "Floating — Return to pane" placeholder so only
  one xterm instance is ever attached to the PTY at a time.
- Browser float has full back/forward/reload + DevTools toggle.
  DevTools opens on the webview's webContents (not the React shell)
  and temporarily drops alwaysOnTop so the detached DevTools window
  is visible.
- `use-floating-pane-sync` hook auto-unfloats when the floating
  window closes via traffic light.

**Why**
- Ability to float any pane (terminal, browser, files) into a detached always-on-top
  window is a huge productivity multiplier for monitoring long-running agents while
  working in another pane or app.
- Directly addresses "I want to see the agent working while I write code elsewhere".

**Scope**
- Add "Pop out to floating window" action in pane context menu (already has "Pop
  out to new tab" — add PiP as sibling)
- Main process: create a frameless `BrowserWindow` with `alwaysOnTop: true`,
  transparent titlebar, load the same renderer with a `?pane=<id>` route
- Lightweight IPC coordination: original pane shows placeholder "Floating", floating
  window shows the pane content
- On floating window close → re-attach to original tab
- Persist PiP state across app reloads if feasible (optional v1.1)

**Likely files**
- New: `apps/desktop/src/main/windows/floating.ts`
- `apps/desktop/src/main/index.ts` (register floating window handler)
- `apps/desktop/src/renderer/components/workspace/PaneContextMenu.tsx`
- `apps/desktop/src/renderer/components/workspace/WorkspacePane.tsx`
- `apps/desktop/src/renderer/stores/workspace.ts` (floating state)

---

### T85 — Layout Presets ✅ COMPLETED (v0.3.0)
**Priority**: P0 | **Effort**: Low (half day) | **Source**: Superconductor inspiration

**Shipped**
- 6 built-in presets: Single, Split Horizontal, Split Vertical,
  Three Columns, Bottom Terminal (70/30), 2×2 Grid.
- `apps/desktop/src/renderer/lib/layout-presets.ts` exports
  pure-function helpers: `computePresetTransformation`,
  `computeCustomPresetTransformation`, `templateFromLayout`.
- `LayoutPresets` dropdown in the tab bar with live SVG glyph previews.
- Preset slots accept `slotTypes` hints — Bottom Terminal creates a
  real terminal with a shell agent spawned on apply, not an empty pane.
- **Save current layout** as a named custom preset (persisted in
  workspace store). Custom layouts capture per-slot type + url +
  filePath so applying them to a fresh tab recreates equivalent
  panes.
- Extras preservation: if the destination tab has more panes than
  the preset has slots, the overflow is stuffed into the last slot
  as a nested vertical split so no pane is ever lost.

**Why**
- Users often want a quick switch between canonical layouts without manually
  splitting panes: "all terminals stacked", "code + terminal at bottom",
  "two side-by-side". Our split system is more flexible but costs more clicks.
- Presets complement (don't replace) the free-form split system already in place.

**Scope**
- Define preset layouts as `LayoutNode` templates:
  - **Stacked**: vertical splits, all same type
  - **Split horizontal**: 50/50 left/right
  - **Bottom terminal**: 70/30 top code + bottom terminal
  - **Three columns**: 33/33/33
- Add a "Layouts" dropdown in tab bar (next to the `+` tab button)
- Selecting a preset: transform the current tab's layout to match, preserving
  pane contents by round-robin assignment
- Let users save custom layouts as named presets (store in workspace store)

**Likely files**
- New: `apps/desktop/src/renderer/components/workspace/LayoutPresets.tsx`
- `apps/desktop/src/renderer/components/workspace/WorkspaceTabBar.tsx`
- `apps/desktop/src/renderer/stores/workspace.ts` (applyLayoutPreset action)
- New: `apps/desktop/src/renderer/lib/layout-presets.ts` (templates)

---

### T86 — First Paint Optimization ✅ COMPLETED (v0.3.0)
**Priority**: P0 | **Effort**: Medium | **Source**: Superconductor benchmark
("<50ms startup")

**Shipped — measured on M1 Pro, dev mode**
```
[Startup] dbInit:        2-9ms
[Startup] criticalPath:  4-12ms
[Startup] windowCreated: 80-102ms
[Startup] firstPaint:    277-391ms  (target was <1.5s)
```

- Deferred ensureDefaultSkills/ShellWrappers/AgentWrappers to a
  background IIFE after window creation.
- Deferred stale agents + memories cleanup to background.
- Added startMark/endMark instrumentation with a single-log guard
  (firstPaint no longer re-logs on window reactivation).
- Lazy-loaded all non-default workspace sections, xterm + addons,
  SettingsPanel, ProjectList, CommandPalette, and FloatingPaneRoot.
- See `docs/BENCHMARKS.md` for the full before/after breakdown.

**Why**
- Electron cold start is our biggest measurable weakness vs. native competitors.
  Superconductor markets <50ms; we're likely around 1-2s. Most of it is loading
  21 tRPC routers + main-process subsystems before the window shows anything.
- Reducing first paint is the single biggest perceived-quality upgrade we can
  ship before launch.

**Scope**
- Measure current baseline (main process boot time, first renderer paint, first
  interactive) and publish as benchmark doc
- Move non-critical main subsystems to lazy init: scheduler, pipeline executor,
  queue, MCP host start on first use — not on app ready
- Split tRPC router registration: only `projects`, `agents`, `workspace` needed
  before first paint; everything else register lazily on first call
- Renderer: defer queries that aren't visible on initial view (recent sessions,
  activity feed, token usage)
- Preload script: audit and trim what gets exposed on window.api
- Target: first interactive in < 800ms on M1

**Likely files**
- `apps/desktop/src/main/index.ts` (defer subsystem init)
- `apps/desktop/src/main/ipc/router.ts` (lazy router registration)
- `apps/desktop/src/main/agents/manager.ts` (lazy getters)
- `apps/desktop/src/main/pipeline/executor.ts` (lazy singleton)
- `apps/desktop/src/renderer/App.tsx` (defer non-critical queries)
- New: `docs/BENCHMARKS.md`

---

### T87 — Renderer Bundle Audit ✅ COMPLETED (v0.3.0)
**Priority**: P0 | **Effort**: Low | **Source**: T86 companion

**Shipped**
- Added `rollup-plugin-visualizer` + `ANALYZE=1 bun run build:analyze`
  script producing `apps/desktop/dist/bundle-stats.html` treemap.
- `index.js` initial chunk: **1,987 KB → 1,026 KB** (−48%).
- Lazy chunks produced for: TerminalInstance (595 KB), Zod schemas
  (113 KB), all 6 non-default workspace sections (31-53 KB each),
  SettingsPanel (51 KB), ProjectList, CommandPalette, FloatingPaneRoot.
- Remaining weight in `index.js` documented in `docs/BENCHMARKS.md`
  (react-dom, react-resizable-panels, tailwind-merge, Radix primitives).

**Why**
- Bundle size directly impacts first paint and memory footprint. We haven't
  audited what ships in the initial chunk since project start.
- Monaco editor, xterm WebGL, Radix, lucide icons: all candidates for code split
  or tree shaking.

**Scope**
- Run `vite build --mode production` and inspect output bundle (rollup-plugin-visualizer)
- Identify heavy dependencies in the initial chunk:
  - Monaco: already lazy? verify
  - xterm + addons: required on first paint?
  - lucide-react: tree-shake unused icons
  - Radix: individual imports not barrel
- Set a bundle budget: initial chunk < 500KB gzipped
- Add CI check (when CI lands) to fail PRs that blow the budget
- Convert any dynamic components to React.lazy + Suspense

**Likely files**
- `apps/desktop/vite.config.ts` (add visualizer plugin, bundle budget)
- Multiple renderer components (lazy imports)
- `apps/desktop/src/renderer/App.tsx` (Suspense boundaries)

---

## Post-launch Backlog — Inspired by Competitors

### T88 — Ralph Loops in Pipelines
**Priority**: P2 | **Effort**: Medium | **Source**: Paseo orchestration skills

**Why**
- Current pipeline loop mechanism (`loopBackTo` + maxIterations) is static. Paseo's
  "Ralph" pattern runs a lightweight evaluator between steps that decides whether
  the previous step met the acceptance criteria. This turns pipelines from scripts
  into goal-seeking workflows.

**Scope**
- New step type: `evaluator` with fields `acceptanceCriteria` (prompt),
  `onPassNext` (step id), `onFailNext` (step id, usually a loop-back), `maxLoops`
- PipelineExecutor: when the evaluator step runs, it spawns a small agent with
  `{{previousOutput}}` + `{{diff}}` + criteria, parses response as `PASS` or
  `RETRY: <feedback>`, and routes accordingly
- Retry path injects the `<feedback>` into the next step's prompt as
  `{{retryFeedback}}`
- UI: distinct icon in PipelineEditor, visual loop arrow when editing
- Safety: hard max (e.g., 10 iterations) even if maxLoops is higher

**Likely files**
- `packages/shared/src/types/pipeline.ts` (new step type)
- `apps/desktop/src/main/pipeline/executor.ts` (evaluator routing)
- `apps/desktop/src/main/pipeline/context.ts` (retryFeedback variable)
- `apps/desktop/src/renderer/components/workspace/sections/pipeline/PipelineEditor.tsx`

---

### T89 — Exegol CLI (sidecar client)
**Priority**: P2 | **Effort**: Medium | **Source**: Paseo multi-client architecture

**Why**
- Having a CLI that talks to the running sidecar unlocks: CI automation, scripting,
  headless usage on servers, and parity with Paseo's workflow. It also doubles as
  a test harness for the sidecar itself.

**Scope**
- New package: `packages/cli/` — Bun/Node CLI, published as `exegol` binary
- Connects to `~/.exegol/pty-sidecar.sock` using the existing JSON-RPC protocol
- Commands (v1):
  - `exegol status` — list agents + pipeline runs
  - `exegol run <pipeline-name> [--project <id>] [--watch]`
  - `exegol logs <agent-id> [--follow]` — stream ring buffer
  - `exegol projects` — list projects
  - `exegol providers` — list available providers
- Commands (v1.1):
  - `exegol spawn <provider> --prompt "..."` — one-off agent
  - `exegol stop <agent-id>`
  - `exegol export <run-id>` — dump pipeline run as JSON
- Reuses shared types from `@exegol/shared` (no duplication)

**Likely files**
- New: `packages/cli/src/index.ts`
- New: `packages/cli/src/sidecar-client.ts`
- New: `packages/cli/src/commands/*.ts`
- `packages/shared/src/types/sidecar-protocol.ts` (may need to export)

---

### T90 — Terminal ↔ Chat Dual View
**Priority**: P2 | **Effort**: Medium | **Source**: Superconductor

**Why**
- Non-technical users (PMs, designers watching a demo) benefit from a conversational
  view of an agent session without the ANSI noise. Toggling lets you get CLI depth
  when debugging and clean reading when reviewing.

**Scope**
- Parse the existing scrollback buffer into conversational turns: detect user
  prompts (input echoes) vs agent output (post-prompt blocks)
- Provider-specific parsers for Claude Code, Codex, Aider (they have distinct
  output patterns); fallback to generic "alternate lines"
- Toggle button in terminal pane header: Terminal / Chat
- Chat view is read-only, reuses DarkReader-style clean rendering
- Do NOT touch the underlying PTY — this is a pure render layer

**Likely files**
- New: `apps/desktop/src/renderer/components/terminal/ChatView.tsx`
- New: `apps/desktop/src/renderer/lib/terminal-to-chat.ts` (parsers)
- `apps/desktop/src/renderer/components/terminal/TerminalPanel.tsx` (toggle state)

---

### T91 — Lifecycle Scripts per Repo
**Priority**: P2 | **Effort**: Low | **Source**: Superconductor + our own T60

**Why**
- Power users want deterministic environment setup per repo: "before spawning any
  agent, run `npm install`", "after commit, run tests". Shareable via git.
- Supersedes T60's project-hook idea with a simpler concrete format.

**Scope**
- Define `.exegol/lifecycle.yaml` format:
  ```yaml
  setup: npm install && bun run build:rust
  beforeAgent: source .env.local
  afterCommit: bun test
  teardown: rm -rf dist
  ```
- Loaded on project detect, cached in settings
- Run setup on first agent spawn (show progress in status bar)
- Run beforeAgent per agent spawn (inject into PTY env)
- Run afterCommit from smart git button (T83)
- Teardown on worktree cleanup
- UI: Settings tab showing the loaded script with edit button

**Likely files**
- New: `apps/desktop/src/main/lifecycle/loader.ts`
- `apps/desktop/src/main/agents/manager.ts` (run beforeAgent)
- `apps/desktop/src/main/agents/worktrees.ts` (run teardown)
- `apps/desktop/src/renderer/components/workspace/sections/SettingsSection.tsx`

---

### T92 — Cross-repo Workspaces
**Priority**: P3 | **Effort**: Large | **Source**: Superconductor

**Why**
- Multi-repo projects (frontend + backend + infra) are extremely common. Users
  today open 3 Exegol windows or switch projects constantly. Sharing a workspace
  across repos with coordinated branches would be a significant differentiator.

**Scope**
- Allow a workspace tab to bind to N projects instead of 1
- Branch coordination: when creating a branch in repo A, offer to create the same
  named branch in repo B, C
- Shared agent context: an agent spawned in this workspace can have working paths
  in all bound repos
- Cross-repo diff view: single diff screen showing changes across repos
- Requires significant refactor of workspace store + ProjectContext

**Likely files**
- `apps/desktop/src/renderer/stores/workspace.ts` (multi-project binding)
- `apps/desktop/src/renderer/contexts/ProjectContext.tsx`
- `apps/desktop/src/main/agents/manager.ts` (multi-cwd agent)
- `apps/desktop/src/renderer/components/workspace/GitPane.tsx` (cross-repo diff)

---

### T93 — Mobile Companion App
**Priority**: P3 | **Effort**: Very large | **Source**: Paseo Expo client

**Why**
- Long-running agents benefit enormously from remote monitoring: get notified on
  the phone when an agent enters `waiting_input`, approve/deny, read scrollback.
  This is Paseo's killer differentiator.
- Requires T94 (daemon mode) as prerequisite.

**Scope**
- New Expo/React Native app in `apps/mobile/`
- Connects to daemon via WebSocket + auth token (QR code pairing)
- v1: read-only — list agents, status, read ring buffer, push notifications
- v1.1: approve waiting_input, send one-line prompts, kill agents
- v2: full terminal view via a terminal emulator library

**Likely files**
- New: `apps/mobile/` (entire new Expo app)
- `apps/desktop/src/main/daemon/ws-server.ts` (WebSocket transport for mobile)
- `apps/desktop/src/main/security/pairing.ts` (QR token exchange)

---

### T94 — Headless Daemon Mode
**Priority**: P3 | **Effort**: Large | **Source**: Paseo daemon architecture

**Why**
- Prerequisite for T93 (mobile) and a valuable standalone feature: run Exegol
  on a server/VPS and connect from anywhere. Enables CI-style agent pipelines
  without keeping the desktop app open.

**Scope**
- Extract the sidecar + DB + agent manager into a standalone daemon that runs
  without Electron (pure Node)
- Expose the existing tRPC router over WebSocket in addition to IPC
- Auth: token-based, stored in OS keychain for desktop client, in user file for
  mobile/CLI
- Desktop app becomes "a thin client to the daemon" by default, can still run
  embedded daemon for local use
- CLI (T89) also benefits from remote connection mode

**Likely files**
- New: `apps/daemon/` (standalone daemon bundle)
- `apps/desktop/src/main/ipc/router.ts` (WebSocket transport)
- `apps/desktop/src/main/security/keystore.ts` (daemon tokens)
- `packages/shared/src/transport/*` (shared ws protocol)

---

## Execution Lanes for Parallel Work

Use these lanes only if multiple agents are working concurrently. The goal is disjoint write sets.

### Lane A — Git Isolation Core
**Tasks**
- T61
- T65
- T66
- T78

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
- T75
- T80

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
- T79

**Owned files**
- `apps/desktop/src/main/hooks/*`
- `apps/desktop/src/main/memory/*`
- `apps/desktop/src/main/ipc/procedures/search.ts`
- `apps/desktop/src/main/db/queries/search.ts`
- `apps/desktop/src/renderer/components/workspace/sections/SearchSection.tsx`

**Do not overlap with**
- Lane A unless a shared spawn-context contract changes

### Lane F — Testability & Quality Foundation
**Tasks**
- T74
- T76
- T77
- T81
- T82

**Owned files**
- New: `apps/desktop/src/main/__tests__/*`
- New: `apps/desktop/src/renderer/__tests__/*`
- `packages/shared/src/schemas/*`
- `apps/desktop/src/main/lib/errors.ts` (new)
- `apps/desktop/src/main/app-context.ts` (new)
- `apps/desktop/src/main/agents/scoring.ts` (T76: curl → SDK)

**Do not overlap with**
- Lane D file decomposition (T75) — coordinate on manager.ts split
- Lane A spawn context changes unless agreed first

---

## Suggested Order

1. T61 — Real Worktree Isolation per Agent
2. T75 — Monolith File Decomposition (prerequisite for testability)
3. T74 — Test Coverage Foundation (highest risk mitigation)
4. T63 — Desktop Performance Stabilization Pass
5. T57 — Review Inbox / Attention Center
6. T62 — Review Readiness + Risk Summary
7. T64 — Command Palette
8. T65 — Parallel Multi-Agent on Worktrees
9. T76 — Replace curl with SDK in Tier 3 Scoring (quick security win)
10. T77 — DB Row Validation with Zod Schemas
11. T66 — Session Isolation & Deterministic Resume
12. T67 — Agent Hook Event System
13. T68 — Repo Map + Semantic Search
14. T78 — Explicit Pipeline State Machine
15. T79 — MCP Host Auto-Reconnection
16. T80 — Structured Error Classification
17. T81 — Dependency Injection for Singletons
18. T82 — Shared Package Schema Enrichment

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
