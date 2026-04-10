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

## Pre-launch Polish Wave ✅ COMPLETED (v0.3.0)

Shipped April 10, 2026. Full details in
[`docs/tasks_completed/2026_04.md`](./tasks_completed/2026_04.md#2026-04-10-pre-launch-polish-wave-v030)
and [`docs/CHANGELOG.md`](./CHANGELOG.md#030--2026-04-10).

Completed in this wave: T83 Smart Git Button, T84 Picture-in-Picture,
T85 Layout Presets + custom saved, T86 First Paint Optimization,
T87 Renderer Bundle Audit, plus sidecar recovery fix, bundled Nerd Fonts,
Cmd+W pane close, workspace as default view, browser pane navigation, and
the terminal font settings rewrite.

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

## Suggested Order (pending only — completed tasks moved to tasks_completed/)

### Next wave (P0 + P1)
1. **T57** — Review Inbox / Attention Center
2. **T65** — Parallel Multi-Agent on Worktrees
3. **T68** — Repo Map + Semantic Search
4. **T77** — DB Row Validation with Zod Schemas

### Stabilization & quality (P2 — do in any order)
5. T78 — Explicit Pipeline State Machine
6. T80 — Structured Error Classification
7. T81 — Dependency Injection for Singletons
8. T82 — Shared Package Schema Enrichment

### Competitor-inspired backlog (P2-P3)
9. **T88** — Ralph Loops in Pipelines (evaluator step)
10. **T89** — Exegol CLI (sidecar client)
11. **T90** — Terminal ↔ Chat dual view
12. **T91** — Lifecycle scripts per repo
13. **T92** — Cross-repo workspaces
14. **T93** — Mobile companion app
15. **T94** — Headless daemon mode

---

## Distribution (pending GitHub)

### T45 — CI/CD Release Pipeline
**Priority**: P3 — activate when repo goes to GitHub

### T46 — Canary Channel
**Priority**: P3

---

## Completed

- V1-V3 + performance pass (69+ tasks): see `docs/tasks_completed/2026_03.md`.
- April 2026 quickwins + quality foundation: see `docs/tasks_completed/2026_04.md`.
- **v0.3.0 pre-launch polish wave** (T83-T87 + PiP + recovery + fonts):
  see `docs/tasks_completed/2026_04.md#2026-04-10-pre-launch-polish-wave-v030`
  and the v0.3.0 entry in `docs/CHANGELOG.md`.
