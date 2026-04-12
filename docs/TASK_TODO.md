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
- **Review Inbox / Attention Center** (T57)
- **Parallel Multi-Agent on Worktrees** (T65)

### P1 — Strong differentiation right after P0
- **Project Indexing with Ollama + sqlite-vec** (T100) — foundation for T68
- **Repo Map + Semantic Search** (T68) — vector search + agent skill + MCP tool
- **DB validation layer** (T77) — Zod schemas for DB rows

### P2 — Valuable follow-ups once the core is stable
- Diff line comments (T69)
- Activity classification (T70)
- Issue tracker expansion (T71)
- **Pipeline state machine** (T78) — explicit transitions
- **Structured error handling** (T80) — transient vs permanent classification
- **DI for singletons** (T81) — testability improvement
- **Shared package enrichment** (T82) — more Zod schemas for IPC/DB payloads
- **Ralph loops in pipelines** (T88) — evaluator step for iterative refinement
- **Exegol CLI** (T89) — headless client over sidecar socket
- **Terminal ↔ Chat dual view** (T90) — same session, two presentations
- **Lifecycle scripts per repo** (T91) — setup/run/teardown in git
- **Agent access modes** (T99) — read/write per session + session metadata
- **Focus-aware panel targeting** (T95) — new panes open next to focused pane
- **Bang commands** (T96) — `!command` in Command Palette for quick shell runs

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

### T68 — Repo Map + Semantic Search (via Vector Index)
**Priority**: P1 | **Effort**: High | **Source**: Aider + Continue.dev + opencode-codebase-index

**Why**
- This is one of the clearest ways to improve agent performance on large repos.
- Strong differentiator when combined with handoff, skills, and pipelines.
- Research shows AST-aware chunking (Tree-sitter) achieves **70% Recall@5** vs
  42% for naive fixed-size chunks — the quality gap is enormous.

**Depends on**
- T100 (Project Indexing) — provides the indexed embeddings + sqlite-vec storage.
  T68 is the search/retrieval layer that consumers (agents, UI, PR review) use.

**Scope**
- **Query interface**: `exegol search <query>` CLI command (connects to sidecar
  socket → queries sqlite-vec) + tRPC procedure `search.semantic(query, topK)`
- **Agent skill**: auto-injected skill explaining `exegol search` so CLI agents
  can discover and use it mid-task without pre-injection (avoids extra token cost)
- **MCP tool** (Claude Code only): `search_project` tool exposed via local MCP
  server so Claude Code auto-discovers it natively
- **UI surface**: SearchSection in workspace with semantic search input → results
  with file path, line range, relevance score, and code preview
- **Hybrid retrieval**: combine sqlite-vec cosine similarity + SQLite FTS5 keyword
  match, fused with Reciprocal Rank Fusion (RRF) for best results
- Definition/reference graph ranking (future v2 — requires full AST analysis)

**Acceptance**
- Agents can query the project index via CLI command or MCP tool during execution
- Search answers semantic intent ("how does auth work") not just string match
- Results return in <50ms for repos up to 10K files

**Likely files**
- `apps/desktop/src/main/ipc/procedures/search.ts` (semantic query endpoint)
- `apps/desktop/src/main/indexer/search.ts` (new — hybrid retrieval logic)
- `packages/cli/src/commands/search.ts` (new — CLI entry point, T89 companion)
- `apps/desktop/src/main/mcp/tools/search-project.ts` (new — MCP tool)
- `apps/desktop/src/main/skills/defaults.ts` (auto-inject search skill)
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

### T96 — Bang Commands in Command Palette
**Priority**: P2 | **Effort**: Low (1 day) | **Source**: kcosr/assistant

**Why**
- kcosr/assistant lets users type `!ls -la` in the chat to run a shell command
  inline with streaming output. This bridges the gap between "open a terminal" and
  "just run one quick command" — useful for checking git status, running tests, or
  verifying a build without leaving the workspace context.
- Our Command Palette (Cmd+K) is already the power-user entry point. Adding a `!`
  prefix for shell execution makes it a true Swiss-army surface.

**Scope**
- Detect `!` prefix in Command Palette input → intercept, strip prefix
- Spawn a one-shot shell session (via PTY sidecar, same as quick-terminal) in a
  temporary or ephemeral pane
- Stream output back into either:
  - A toast/popover that auto-dismisses after command completes (for short commands)
  - A new terminal tab (for long-running commands)
- Show exit code indicator (success/failure)
- Optional: history of recent bang commands for re-run (store in agent_events or
  in-memory)

**Likely files**
- `apps/desktop/src/renderer/components/CommandPalette.tsx` (detect `!` prefix)
- `apps/desktop/src/main/agents/manager.ts` (one-shot shell spawn)
- `apps/desktop/src/renderer/components/common/ToastStack.tsx` (streaming toast)

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

### T99 — Agent Access Modes + Session Metadata
**Priority**: P2 | **Effort**: Low (1 day) | **Source**: Nora (withnora.run)

**Why**
- Nora enforces explicit read/write mode per agent session. A "read-only" agent
  can explore the repo, read files, and reason about architecture without the
  risk of accidental writes, commits, or destructive operations. This is
  valuable for review, exploration, and onboarding scenarios.
- Session metadata tracking (tool, agent name, task text, access mode, launch
  target, branch, workspace path, status) is richer than what we currently
  store. More metadata = better Recent Sessions display, better scoring
  context, and better recovery diagnostics.

**Scope**
- Add `accessMode: "read" | "write"` field to `AgentCreate` schema (default:
  "write" for backward compat)
- Read mode enforcement: when spawning in read mode, use a worktree checkout
  with `--detach` (no branch to commit to) and strip write-related environment
  variables (GIT_AUTHOR_*, EXEGOL_ALLOW_COMMIT, etc.)
- UI: toggle in SpawnAgentModal and the quick-launch bar
- Session metadata: extend `agents` DB table with `access_mode TEXT`,
  `launch_target TEXT` (pane id or "new-tab"), `resolved_model TEXT`
- Surface in Recent Sessions sidebar: show access mode badge + model used

**Likely files**
- `packages/shared/src/schemas/agent.ts` (schema update)
- `apps/desktop/src/main/agents/manager.ts` (spawn env for read mode)
- `apps/desktop/src/main/agents/spawn-env.ts` (strip write env vars)
- `apps/desktop/src/main/db/migrations.ts` (new columns)
- `apps/desktop/src/renderer/components/agents/SpawnAgentModal.tsx` (toggle)
- `apps/desktop/src/renderer/components/layout/RecentSessions.tsx` (metadata)

---

### T100 — Project Indexing with Ollama Embeddings + sqlite-vec
**Priority**: P1 | **Effort**: Large (1-2 weeks) | **Source**: ai-code-review-system
  + opencode-codebase-index + Continue.dev + supermemory/code-chunk

**Why**
- Foundation for T68 (semantic search), T98 (AI PR review), and agent context
  injection. Without a local vector index of the project, agents start blind
  and waste tokens exploring. With it, Exegol can instantly surface the 5 most
  relevant code sections for any query — whether from a user search, an agent
  tool call, or a PR review.
- Research shows AST-aware chunking via Tree-sitter achieves **70% Recall@5**
  vs 42% for naive line-based chunks (supermemory/code-chunk benchmarks). The
  quality difference is the difference between useful and useless retrieval.

**Architecture (all local, no cloud services)**
```
Ollama (localhost:11434)         ← embedding model (nomic-embed-text)
  ↓
Tree-sitter (core-rust)          ← AST-aware chunking (functions, classes, etc.)
  ↓
sqlite-vec (libSQL extension)    ← vector storage + cosine similarity search
  + SQLite FTS5                  ← keyword index for hybrid retrieval
  ↓
Reciprocal Rank Fusion           ← merge vector + keyword results
```

**Scope**
- **Settings UI**: enable indexing toggle, Ollama URL + model picker with
  auto-detect (`ollama list`), pull-if-missing button, exclude patterns
  (node_modules, dist, .git, *.lock, binaries)
- **Indexer (main process background worker)**:
  - On project open: scan repo files, SHA-256 hash per file, skip unchanged
  - Tree-sitter parsing in `core-rust`: extract functions, classes, interfaces,
    type definitions as discrete chunks with docstrings + scope chain (follow
    supermemory/code-chunk approach for 70% recall)
  - Fallback: for non-parseable files, 500-line overlap chunking
  - Batch embedding via Ollama API (`/api/embed`), 50 chunks per batch
  - Store in DB: `file_index` (project_id, path, hash, language, indexed_at),
    `file_chunks` (file_id, content, embedding BLOB, start_line, end_line)
  - sqlite-vec virtual table for ANN queries (`vec_search`)
  - SQLite FTS5 index on chunk content for keyword fallback
  - Branch-aware catalog (from opencode-codebase-index): hash-deduplicated
    embeddings + branch membership table. Branch switch = catalog update,
    not re-embedding
- **Incremental updates**:
  - Watch for git changes (post-commit hook or file watcher)
  - Only re-index files whose SHA-256 changed
  - Delete removed files' chunks + vectors
  - Force push / first commit → full re-index fallback
- **Status surface**: indexing progress in StatusBar (X/Y files, estimated time)
- **Performance targets** (based on codesearch/flupkede benchmarks):
  - Initial index (10K files): <5 min
  - Incremental (1% changes): <30s
  - Query (top-5 chunks): <50ms

**DB schema (new tables)**
```sql
CREATE TABLE file_index (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  path TEXT NOT NULL,
  hash TEXT NOT NULL,          -- SHA-256 of file content
  language TEXT,
  chunk_count INTEGER DEFAULT 0,
  indexed_at INTEGER,
  UNIQUE(project_id, path)
);

CREATE TABLE file_chunks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES file_index(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding BLOB,              -- float32[768] for nomic-embed-text
  start_line INTEGER,
  end_line INTEGER,
  chunk_type TEXT DEFAULT 'function'  -- function, class, block, fallback
);

-- sqlite-vec virtual table for cosine similarity search
CREATE VIRTUAL TABLE file_chunks_vec USING vec0(
  chunk_id TEXT,
  embedding float[768]
);

-- FTS5 for hybrid keyword search
CREATE VIRTUAL TABLE file_chunks_fts USING fts5(
  content, file_path,
  content='file_chunks'
);
```

**Likely files (new)**
- New: `apps/desktop/src/main/indexer/project-indexer.ts` (background worker)
- New: `apps/desktop/src/main/indexer/chunker.ts` (Tree-sitter + fallback)
- New: `apps/desktop/src/main/indexer/embedder.ts` (Ollama API client)
- New: `apps/desktop/src/main/indexer/search.ts` (hybrid retrieval + RRF)
- New: `packages/core-rust/src/chunker/` (Tree-sitter AST parsing for chunks)
- `apps/desktop/src/main/db/migrations.ts` (file_index + file_chunks tables)
- `apps/desktop/src/main/db/queries/indexer.ts` (CRUD for chunks)
- `apps/desktop/src/renderer/components/settings/GeneralSettings.tsx` (indexing config)
- `apps/desktop/src/renderer/components/layout/StatusBar.tsx` (indexing progress)

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
13. **T95** — Focus-aware panel targeting (quick win)
14. **T96** — Bang commands in Command Palette (quick win)
15. **T99** — Agent access modes read/write + session metadata
16. **T92** — Cross-repo workspaces
17. **T93** — Mobile companion app
18. **T94** — Headless daemon mode
19. **T97** — Panel Plugin SDK (v1.0 architecture — design spike first)

---

## Distribution (pending GitHub)

### T45 — CI/CD Release Pipeline
**Priority**: P3 — activate when repo goes to GitHub

### T46 — Canary Channel
**Priority**: P3

