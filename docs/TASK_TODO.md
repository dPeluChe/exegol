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
- **Test coverage (T74)** — zero TS/JS tests is the highest technical risk
- **Monolith decomposition (T75)** — 4 files exceed 500 LOC

### P1 — Strong differentiation right after P0
- Session resume determinístico
- Agent hook system con eventos estructurados
- Repo map + semantic search
- **Tier 3 scoring via SDK (T76)** — replace curl with proper HTTP client
- **DB validation layer (T77)** — Zod schemas for DB rows

### P2 — Valuable follow-ups once the core is stable
- Diff line comments
- Activity classification
- **Pipeline state machine (T78)** — explicit transitions
- **MCP reconnection (T79)** — auto-reconnect on server drop
- **Structured error handling (T80)** — transient vs permanent classification
- **DI for singletons (T81)** — testability improvement
- **Shared package enrichment (T82)** — more Zod schemas for IPC/DB payloads
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

---

## Codebase Quality & Health (from deep analysis)

> These tasks surfaced from a comprehensive codebase audit (April 2026).
> They address technical debt, testability, and robustness gaps that will compound if left unattended.

### T74 — Test Coverage Foundation
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

### T75 — Monolith File Decomposition
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

### T76 — Replace curl with SDK in Tier 3 Scoring
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

### T79 — MCP Host Auto-Reconnection
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
