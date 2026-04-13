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
- **Parallel Multi-Agent on Worktrees** (T65)

### P2 — Valuable follow-ups once the core is stable
- ~~Diff line comments (T69)~~ ✓ v0.5.0
- Activity classification (T70)
- Issue tracker expansion (T71)
- **Pipeline state machine** (T78) — explicit transitions
- **Structured error handling** (T80) — transient vs permanent classification
- **DI for singletons** (T81) — testability improvement
- **Shared package enrichment** (T82) — more Zod schemas for IPC/DB payloads
- **Ralph loops in pipelines** (T88) — evaluator step for iterative refinement
- **Terminal ↔ Chat dual view** (T90) — same session, two presentations
- **Lifecycle scripts per repo** (T91) — setup/run/teardown in git
- ~~**Focus-aware panel targeting** (T95) — new panes open next to focused pane~~ ✓ v0.5.0

### P3 — Strategic bets / larger scope
- **SSH Remote Development** (T73)
- **CI/CD release pipeline** (T45) — activate when repo goes public
- **Canary channel** (T46)
- **Cross-repo workspaces** (T92) — front + back in one workspace
- **Mobile companion app** (T93) — monitor agents from phone via daemon
- **Headless daemon mode** (T94) — remote WebSocket for cloud/server deploys
- **Panel Plugin SDK** (T97) — extensible panel system, community plugins, v1.0 architecture

---

## Active Backlog

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

### T95 — Focus-Aware Panel Targeting
**Priority**: P2 | **Effort**: Low (half day) | **Source**: kcosr/assistant

**Why**
- When an agent or a handler calls `addPane` / `splitPane`, the new pane currently
  goes to a deterministic-but-arbitrary slot. kcosr/assistant tracks the "focused
  pane" and opens new panels next to where the user is looking. This small polish
  makes multi-pane workflows feel natural instead of requiring manual rearrangement
  after every spawn.
- We already have `focusedPaneId` in the workspace store — it just isn't used as
  the default target for new content.

**Scope**
- Modify `addPane` / `splitPane` / agent-spawn pane placement to prefer
  `focusedPaneId` as the insertion target when the caller doesn't specify a slot
- If `focusedPaneId` is inside a split, the new pane splits relative to it
- If `focusedPaneId` is null (nothing focused), fall back to current behavior
- Optional: PaneContextMenu action "Open agent here" that uses the right-clicked
  pane as the target

**Likely files**
- `apps/desktop/src/renderer/stores/workspace.ts` (addPane, splitPane)
- `apps/desktop/src/renderer/components/workspace/EmptyPaneContent.tsx`
- `apps/desktop/src/renderer/components/agents/AgentLauncher.tsx`

---

### T97 — Panel Plugin SDK
**Priority**: P3 | **Effort**: Very large (2-4 weeks) | **Source**: kcosr/assistant

**Why**
- This is the single biggest architectural evolution Exegol could make for community
  growth. Today every workspace section (Tasks, Prompts, Memory, Pipelines,
  Resources, Scoring) is a hardcoded React component. Adding a new panel requires
  editing core code. kcosr/assistant proves the plugin model works: a manifest.json
  + server.js + bundle.js + auto-generated CLI — drop it in a directory and the app
  discovers it at runtime.
- Exegol becomes a **platform** instead of a **product**: community members build
  panels for Jira integration, Notion sync, custom dashboards, etc. without PRs.
- Pairs naturally with T89 (CLI): each plugin's operations become CLI commands
  automatically, just like kcosr/assistant's SKILL.md + bin/<plugin>-cli pattern.

**Scope (exploratory — needs a design spike first)**
- Define a `PluginManifest` JSON schema:
  - `id`, `name`, `version`, `description`
  - `panels`: list of `{ id, label, icon, bundlePath }`
  - `operations`: list of tool/HTTP/CLI operations the plugin exposes
  - `serverModule`: optional Node.js entry point for backend logic
  - `permissions`: what IPC/tRPC procedures the plugin can call
- Plugin discovery at startup: scan `~/.exegol/plugins/` + bundled official plugins
- **Backend host**: load server modules into sandboxed contexts in the main process,
  expose their operations as tRPC sub-routers
- **Frontend loader**: dynamic `<script>` loader + global panel registry API
  (similar to kcosr's `registerPanel()`)
- **Panel chrome**: iframe or React lazy + dynamic import per panel, with a host
  API object (state persistence, IPC to backend, session context)
- **Official plugins migration**: gradually extract Tasks, Prompts, Memory, etc. into
  `packages/plugins/official/` following the same contract, so they serve as
  reference implementations
- **CLI generation**: for each plugin operation, emit a CLI binding in `packages/cli/`
  (if T89 lands first) or a generated standalone script

**Design constraints**
- Security: plugins must not access the full main process — sandboxed IPC only
- Bundle impact: panel bundles loaded on demand (lazy), not in the initial chunk
- Backward compat: existing users who never install plugins see zero difference
- DX: `exegol plugin create <name>` scaffolds a hello-world plugin with manifest +
  server + panel

**Likely files (new)**
- New: `packages/plugin-sdk/` (manifest schema, host API types, panel protocol)
- New: `apps/desktop/src/main/plugins/host.ts` (discovery, loader, sandbox)
- New: `apps/desktop/src/main/plugins/registry.ts` (operation → tRPC bridge)
- New: `apps/desktop/src/renderer/lib/plugin-loader.ts` (dynamic panel loading)
- Modified: `apps/desktop/src/renderer/components/workspace/WorkspaceView.tsx`
  (render plugin panels alongside built-in sections)

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

### Next wave (P0)
1. **T65** — Parallel Multi-Agent on Worktrees

### Stabilization & quality (P2)
2. T78 — Explicit Pipeline State Machine
3. T80 — Structured Error Classification
4. T81 — Dependency Injection for Singletons
5. T82 — Shared Package Schema Enrichment

### Competitor-inspired backlog (P2-P3)
6. **T88** — Ralph Loops in Pipelines (evaluator step)
7. **T90** — Terminal ↔ Chat dual view
8. **T91** — Lifecycle scripts per repo
9. **T95** — Focus-aware panel targeting (quick win)
10. **T92** — Cross-repo workspaces
11. **T93** — Mobile companion app
12. **T94** — Headless daemon mode
13. **T97** — Panel Plugin SDK (v1.0 architecture — design spike first)

---

## Distribution (pending GitHub)

### T45 — CI/CD Release Pipeline
**Priority**: P3 — activate when repo goes to GitHub

### T46 — Canary Channel
**Priority**: P3

