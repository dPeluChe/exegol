# Exegol — Task Board

> Audience: current contributors planning the next implementation wave after the initial MVP.
> This board is the active backlog for product differentiation, operational confidence, and release readiness.

> **Quality gate before PR**
> - `npx @biomejs/biome check --fix apps/ packages/shared/src/ packages/ui/src/`
> - `npx tsc --noEmit -p apps/desktop/tsconfig.node.json && npx tsc --noEmit -p apps/desktop/tsconfig.web.json`
> - Max 400-500 LOC per file unless a refactor task explicitly says otherwise

---

## Priority Order

### Wave 1 — Stack Optimizations (Terax Review, 2026-05) — FIRST FOCUS
Strategic context: we stay on **Electron + spawned-CLI agents** (our core differentiator).
Terax (Tauri-based terminal) is more focused than us — but ships several patterns sharper
than ours. We adopt them inside our stack. Full analysis: `docs/RESEARCH/TERAX_STACK_REVIEW.md`.

**Bundle as 1 PR — quick wins (S, low risk, orthogonal):**
- **Build & bundle opts** (T108) — Vite manualChunks + esbuild drop debugger/console.debug + chrome134 target
- **Streaming UX libs** (T110) — `streamdown` + diff cache LRU (use-stick-to-bottom deferred — no streaming surface today)
- **tokenlens model registry** (T111) — augment our DB catalog with model context-window info
- **electron-window-state** (T121) — restore window size/position across launches

**Terminal/PTY hardening (S–M):**
- **PTY flusher hardening** (T113) — 4ms coalesce + ESC c on overflow + WebGL context-loss recovery
- **OSC 7 + OSC 133 shell integration** (T112) — cwd + prompt boundaries + exit code for shell panes
- **DormantRing for hidden panes** (T115) — 256KB bounded chunk ring (foundation for T114)

**Security & defense-in-depth (S–M):**
- **Security hardening** (T117) — bidi-char Trojan Source, NTFS ADS, fork bombs, dangerous-command regex
- **CSP header in renderer** (T118) — explicit `script-src 'self' 'wasm-unsafe-eval'` + `connect-src` allowlist
- **Capability allowlist pattern** (T119) — Tauri-style declarative allowlist for tRPC routers/IPC channels

**Larger / deferred:**
- **Rust search crates** (T116, M) — `ignore` + `grep-regex` + `grep-searcher` + `globset` in core-rust
- **Settings as separate window** (T120, M) — use floating BrowserWindow infra
- **xterm renderer pool** (T114, L) — 5-slot LRU pool with snapshot+replay, blocks N-WebGL-context lag
- **Vercel AI SDK + Ollama** (T122, M, P3) — replace 2 fetch calls in `diff.ts` + `scoring.ts`, unlock Ollama via `@ai-sdk/openai-compatible`

### P0 — Must land before broad release push
- **Parallel Multi-Agent on Worktrees** (T65)
- **Release config** (T103) — owner/repo, notarization, canary channel, release checklist

### P1 — Differentiators for first users
- **Worktree isolation status** (T105) — visible badge per agent: `project root | isolated | pipeline | fallback`
- **Agent stop reason** (T106) — "Why did this agent stop?" panel: exit code, last N lines, resume available
- **Agent comparator** (T107) — side-by-side diff summary + score + cost for parallel runs; promote/continue buttons
- **Ralph loops in pipelines** (T88) — evaluator step for iterative refinement

### P2 — Valuable follow-ups once the core is stable
- Issue tracker expansion (T71)

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

**Done (v0.4.3)**
- Types: `AgentAccessMode` (`read`, `write`, `plan`) + DB migration
- Spawn-time injection (prompt prefix + `EXEGOL_ACCESS_MODE` env var)
- SpawnAgentModal mode selector (Full Access / Plan Only / Read Only)
- Access mode badge in live terminal toolbar
- Pipeline step `accessMode` field + executor propagation + editor UI

**Remaining**
- Runtime mode switching (change mode while agent is running)
- Scheduler task `accessMode` propagation

**Likely files**
- `apps/desktop/src/main/agents/*`
- `apps/desktop/src/main/pipeline/*`
- `apps/desktop/src/renderer/components/agents/SpawnAgentModal.tsx`
- `apps/desktop/src/renderer/components/terminal/*`

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
**Priority**: P3 | **Effort**: High | **Source**: Emdash + Orca (stablyai/orca)

**Why**
- High upside, but too large to mix into the current release-critical wave.
- Orca already ships SSH with a clean provider dispatch pattern worth following.

**Scope**
- Remote project registration via SSH
- PTY over SSH with reconnect/persistence strategy
- Remote git/worktree operations
- Credentials in OS keychain

**Architecture reference — Orca's provider dispatch pattern**
Orca (stablyai/orca) implements SSH via parallel provider pairs in `src/main/providers/`:
```
local-pty-provider.ts    ←→  ssh-pty-provider.ts
(local git via runner.ts) ←→  ssh-git-provider.ts
(local fs)                ←→  ssh-filesystem-provider.ts
```
Each operation (spawn PTY, run git command, read/write files) has a local and SSH variant
behind a dispatch layer (`provider-dispatch.ts`). The dispatch routes based on project
location (local path vs ssh://host). Key files to study:
- `ssh-pty-provider.ts` — PTY sessions over SSH with shell-ready detection
- `ssh-git-provider.ts` — git commands tunneled through SSH
- `ssh-filesystem-dispatch.ts` — file read/write routing

**Recommended approach for Exegol:**
1. Create `apps/desktop/src/main/providers/` with `types.ts` defining `PtyProvider`, `GitProvider`, `FsProvider` interfaces
2. Extract current local implementations as `local-pty-provider.ts`, `local-git-provider.ts`
3. Add SSH variants that implement the same interfaces
4. Dispatch layer reads project config (`project.remote?: { host, user, path }`)
5. Agent spawn flow calls provider.createPty() instead of hardcoded local PTY

**Likely files**
- New: `apps/desktop/src/main/providers/*` (dispatch + local/SSH provider pairs)
- `apps/desktop/src/main/agents/manager.ts` (spawn via provider dispatch)
- `apps/desktop/src/main/terminal/pty-sidecar-client.ts` (local PTY → provider interface)
- `packages/core-rust/src/git/` (local git → provider interface)
- Project model and settings (remote SSH config)

---

## Codebase Quality & Health (from deep analysis)

> These tasks surfaced from a comprehensive codebase audit (April 2026).
> They address technical debt, testability, and robustness gaps that will compound if left unattended.

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

### T103 — Release Config Completion
**Priority**: P0 | **Effort**: Small | **Source**: Audit 2026-04-27

**Why**
- `electron-builder.ts` still has `publish.owner: "OWNER"` placeholder and `notarize: false`.
- No canary/stable channel separation. No release checklist.

**Scope**
- Fill `owner`/`repo` in electron-builder publish config
- Define `stable` and `canary` channel update feeds
- Document notarization steps (requires Apple Developer credentials)
- Add `scripts/release-checklist.md`: typecheck → lint → tests → package mac → smoke launch → auto-update test

**Likely files**
- `apps/desktop/electron-builder.ts`
- `scripts/release-checklist.md` (new)

---

### T105 — Worktree Isolation Status Badge
**Priority**: P1 | **Effort**: Small | **Source**: Audit 2026-04-27

**Why**
- When an agent runs in project root (worktree creation failed silently), the user assumes isolation that doesn't exist.
- Making this visible builds trust and helps diagnose worktree problems.

**Scope**
- Derive isolation mode from agent state: `isolated` (has worktree_id) | `pipeline` (shared pipeline worktree) | `project-root` (no worktree) | `fallback` (worktree creation failed)
- Show as a small badge in the terminal toolbar (next to access mode badge)
- Click badge → tooltip with worktree path + branch

**Likely files**
- `apps/desktop/src/renderer/components/terminal/TerminalPanel.tsx`
- `apps/desktop/src/renderer/components/terminal/TerminalToolbar.tsx`
- `packages/shared/src/types/agent.ts`

---

### T106 — Agent Stop Reason Panel
**Priority**: P1 | **Effort**: Small | **Source**: Audit 2026-04-27

**Why**
- Currently when an agent stops/crashes, the user sees the terminal go silent with no structured explanation.
- "Why did this agent stop?" is a common question.

**Scope**
- On stopped/failed/crashed terminal: show overlay or expandable section with:
  - Status (completed / failed / crashed / stopped)
  - Exit code + signal if available
  - Last `current_step` value
  - Whether session resume is available (resumeCommand present in DB)
  - Quick action: Resume / New agent with same task / View diff
- Does not replace existing terminal output — sits above or below it

**Likely files**
- `apps/desktop/src/renderer/components/terminal/TerminalPanel.tsx`
- `apps/desktop/src/renderer/components/terminal/AgentStopReason.tsx` (new)

---

### T107 — Agent Comparator (parallel runs)
**Priority**: P1 | **Effort**: Medium | **Source**: Audit 2026-04-27

**Why**
- T65 (parallel multi-agent) creates N branches for the same task. Without a comparison surface, the user has to manually diff all of them.

**Scope**
- Comparison view when a parallel run completes: N columns (one per agent)
- Per column: diff summary (files changed, insertions/deletions), agent score, cost, duration, test status
- Promote button: apply worktree as main branch, discard others
- Continue button: pick one branch as base for the next step
- Depends on T65

**Likely files**
- `apps/desktop/src/renderer/components/workspace/sections/ParallelRunComparator.tsx` (new)
- `apps/desktop/src/main/ipc/procedures/parallel.ts`
- `apps/desktop/src/main/db/queries/parallel-runs.ts`

---

## Terax Review — Stack Optimizations (Wave 1)

> Source: `docs/RESEARCH/TERAX_STACK_REVIEW.md` (Terax-AI vs Exegol comparison, 2026-05-21).
> All tasks below cite specific Terax files when copying patterns.
> Strategic stance: keep AI-spawned CLI as our core; adopt Terax's tighter implementation patterns.

### T108 — Vite Build & Bundle Optimizations
**Priority**: Wave 1 / P1 | **Effort**: S | **Source**: Terax `vite.config.ts:16-67`

**Why**
- Initial renderer chunk currently loads xterm + all addons + future SDKs eagerly.
- `console.debug/info/trace` and `debugger` ship to users in prod builds.
- Build target locked to a conservative Chromium; we control Electron's Chromium (41 → chrome134) — wasted polyfills today.

**Scope**
- Add `build.rollupOptions.output.manualChunks` to `electron.vite.config.ts` (renderer config): one chunk for xterm + addons, one per future `@ai-sdk/*` provider (T122 placeholder), one for monaco (or codemirror if T114-companion lands).
- Add `build.esbuild: { drop: ['debugger'], pure: ['console.debug','console.info','console.trace'] }`.
- Set `build.target: 'chrome134'` (verify with smoke launch — falls back to 'chrome120' if anything breaks).
- Measure initial `index.js` size before/after (current ~1,026 KB per `CLAUDE.md`).

**Likely files**
- `apps/desktop/electron.vite.config.ts`

---

### T110 — Streaming UX Libraries
**Priority**: Wave 1 / P2 | **Effort**: S | **Source**: Terax `package.json`, `src/modules/editor/lib/diffCache.ts:1-104`

**Why**
- Our markdown rendering for agent output is `react-markdown` (re-parses on every stream chunk).
- Our auto-scroll-to-bottom in `TerminalPanel` is hand-rolled and weakly correct.
- Our diff IPC has no cache → "open same file twice" pays the full diff cost.

**Scope**
- Add `streamdown` (~40 KB gzip) — drop-in for agent message rendering and pipeline output.
- Add `use-stick-to-bottom` (~5 KB) — replace ad-hoc scroll-to-bottom in `TerminalPanel.tsx` and any chat/oplog stream view.
- Implement diff cache: LRU 6 entries + in-flight Promise dedup, keyed by `${repo}|${kind}|${mode}|${path}`. Invalidate per-repo on git mutations.
- Pattern reference: `src/modules/editor/lib/diffCache.ts:1-104`.

**Likely files**
- `apps/desktop/package.json` (deps)
- Renderer markdown components (find via grep for `react-markdown`)
- `apps/desktop/src/renderer/components/terminal/TerminalPanel.tsx`
- `apps/desktop/src/main/ipc/procedures/diff.ts` (cache layer)

---

### T111 — tokenlens Token Counter
**Priority**: Wave 1 / P2 | **Effort**: S | **Source**: Terax `package.json:64`

**Why**
- We log token usage from agent CLI output where available, but have no in-app token estimator for arbitrary text.
- Useful for the Monitor tab's Tokens panel and for future prompt-builder UIs.

**Scope**
- Add `tokenlens` (~30 KB) to renderer deps.
- Wire into `MonitorView` / Resources & Tokens section: per-agent token estimate, prompt-size badge in any compose surface.
- Consider exposing a small helper `estimateTokens(text, model)` in `packages/shared`.

**Likely files**
- `apps/desktop/package.json`
- `apps/desktop/src/renderer/components/workspace/sections/MonitorTokens.tsx` (or equivalent)
- `packages/shared/src/lib/tokens.ts` (new helper, optional)

---

### T112 — OSC 7 + OSC 133 Shell Integration
**Priority**: Wave 1 / P1 | **Effort**: M | **Source**: Terax `src-tauri/src/modules/pty/scripts/` + `src/modules/terminal/lib/osc-handlers.ts:1-86`

**Why**
- Our `status_parser.rs` parses agent CLI output via regex — fragile and content-specific.
- For **shell panes** (non-agent, plain `$SHELL`) we have no reliable cwd tracking or prompt-boundary detection.
- OSC 7 (cwd) + OSC 133 A/B/C/D (prompt start/end/pre-exec/done+exit-code) are content-agnostic ANSI sequences emitted by the shell itself.
- Unlocks: per-pane cwd badge, Smart Git Button refresh after `git commit` without polling, "jump to previous command" navigation.

**Scope**
- Lift Terax init scripts: `zshenv.zsh`, `zprofile.zsh`, `zlogin.zsh`, `zshrc.zsh`, `bashrc.bash`, `profile.ps1` (future Windows).
- Materialize under `~/.exegol/shell-integration/` on first run.
- When spawning a shell pane (NOT an agent CLI — those have their own loop), wrap shell command with `ZDOTDIR=...` (zsh) or `--rcfile ...` (bash).
- Frontend OSC handlers in renderer: register OSC 7 + OSC 133 sequences on xterm, push parsed cwd into workspace store, register `IMarker` at each `A` for jump-to-prompt.
- **Threat model**: reject OSC 7 updates emitted while `inCommand` is true (prevents SSH session from spoofing cwd badge). Mirror Terax `osc-handlers.ts:27-32`.
- Apply only to `terminal` panes with `kind: shell` (no agent CLI). Status parser stays for agent panes.

**Likely files**
- `apps/desktop/src/main/terminal/shell-integration/` (new — init scripts)
- `apps/desktop/src/main/terminal/shell-wrappers.ts` (materialize + wrap on spawn)
- `apps/desktop/src/renderer/components/terminal/osc-handlers.ts` (new — frontend parser)
- `apps/desktop/src/renderer/components/terminal/TerminalInstance.tsx` (register handlers)
- `apps/desktop/src/renderer/stores/workspace.ts` (per-pane cwd state)

---

### T113 — PTY Flusher Hardening
**Priority**: Wave 1 / P1 | **Effort**: S | **Source**: Terax `src-tauri/src/modules/pty/session.rs:86-271` + frontend WebGL context-loss handling

**Why**
- Current sidecar overflow behavior may slice partial ANSI/CSI sequences → broken rendering.
- We have no WebGL context-loss handler (Mac sleep/wake can drop GPU contexts → blank terminal).

**Scope**
- Audit `apps/desktop/src/main/terminal/pty-sidecar-entry.ts` flusher:
  - Confirm coalescing window (Terax uses 4ms, MAX_PENDING 4 MiB).
  - On overflow: **drop entire pending buffer + emit `ESC c` (hard reset) + dim notice**. Never slice partial CSI sequences.
- Add WebGL context-loss handler in `TerminalInstance.tsx`:
  - Listen for `webglcontextlost` on the canvas.
  - 250 ms delay → re-attach WebGL addon.
  - **Add max-retry counter (e.g., 3) — if GPU is truly gone, fall back to canvas renderer** (this is the gap in Terax's impl, anti-pattern listed in the review).

**Likely files**
- `apps/desktop/src/main/terminal/pty-sidecar-entry.ts`
- `apps/desktop/src/renderer/components/terminal/TerminalInstance.tsx`

---

### T114 — xterm Renderer Pool
**Priority**: Wave 1 / P3 | **Effort**: L | **Source**: Terax `src/modules/terminal/lib/rendererPool.ts:1-700`

**Why**
- Today: 1 xterm instance per pane = 1 WebGL context per pane. 10+ tabs saturates GPU and balloons memory.
- Terax keeps ≤5 active slots in a pool; hidden tabs release their slot after snapshotting screen + push live ring into DormantRing (T115).
- When the tab returns: pick best slot (LRU, deprioritize alt-screen + focused), reset, write snapshot, replay ring. For alt-screen TUIs (vim, htop): discard ring, force SIGWINCH "kick".

**Scope**
- Lift `rendererPool.ts` into `apps/desktop/src/renderer/lib/terminal-pool.ts`.
- Replace `TerminalInstance` with `usePooledTerminal(paneId, container)` hook.
- Permanent off-screen recycler div (`position: fixed; left: -99999px; contain: strict`).
- Wire `WorkspacePane` so hidden panes release the slot instead of unmounting.
- Floating PiP (T84) integration: ensure snapshot/replay works when a pane detaches.
- WebGL context-loss recovery (already in T113, adapt for pool).

**Depends on**
- T115 (DormantRing) — ideally ship T115 first as standalone, then build pool on top.

**Risk**
- Our sidecar ring already provides instant reconnect; pool's value is only above ~5 concurrent tabs.
- Cross-cuts Workspace, FloatingPaneRoot, ring-buffer reattach, snapshot replay.

**Likely files**
- `apps/desktop/src/renderer/lib/terminal-pool.ts` (new)
- `apps/desktop/src/renderer/components/terminal/TerminalInstance.tsx` (replaced or wrapped)
- `apps/desktop/src/renderer/components/workspace/WorkspacePane.tsx`
- `apps/desktop/src/renderer/FloatingPaneRoot.tsx`

---

### T115 — DormantRing for Hidden Panes
**Priority**: Wave 1 / P2 | **Effort**: S | **Source**: Terax `src/modules/terminal/lib/dormantRing.ts:1-71`

**Why**
- Today: when a pane is hidden or detached, the renderer-side ring is gone (we rely 100% on the sidecar's 8 MB ring for replay).
- For hidden tabs that aren't released yet, a small in-memory chunk ring is enough to bridge.
- Foundation block for T114 (renderer pool) but useful standalone.

**Scope**
- Implement bounded chunk ring: 256 KB / 256 chunks max.
- On overflow: keep most-recent slice + prepend `ESC c` + a dim "[buffer overflow — earlier output dropped]" notice.
- Push every write into ring while pane is hidden; flush on un-hide.
- Standalone hook `useDormantRing(paneId)` consumed by `TerminalInstance.tsx` when `paneVisible === false`.

**Likely files**
- `apps/desktop/src/renderer/lib/dormant-ring.ts` (new)
- `apps/desktop/src/renderer/components/terminal/TerminalInstance.tsx`

---

### T116 — Rust Search Crates (ignore + grep-* + globset)
**Priority**: Wave 1 / P1 | **Effort**: M | **Source**: Terax `src-tauri/Cargo.toml` + `fs::search`, `fs::grep`

**Why**
- We have no in-process fast file search or content grep — would have to spawn `rg` from a shell, parse output.
- `ignore` crate (powers ripgrep) respects `.gitignore` natively, returns structured results.
- Critical foundation for any future in-process AI tool that needs to read project context.

**Scope**
- Add Rust crates to `packages/core-rust/Cargo.toml`: `ignore`, `grep-regex`, `grep-searcher`, `grep-matcher`, `globset`.
- New module `packages/core-rust/src/search/` with napi exports:
  - `fs_search(query: string, root: string, limits: { maxResults: number }) -> SearchResult[]`
  - `fs_grep(pattern: string, root: string, opts: { caseInsensitive, hidden, maxMatches }) -> GrepHit[]`
- Wire into tRPC procedures so renderer can drive Command Palette file finder + future search panel.
- Bundle cost: ~1 MB added to `.node` artifact — acceptable.

**Likely files**
- `packages/core-rust/Cargo.toml`
- `packages/core-rust/src/search/mod.rs` (new)
- `packages/core-rust/src/lib.rs` (export napi bindings)
- `apps/desktop/src/main/ipc/procedures/search.ts` (new or expand)

---

### T117 — Security Hardening (path-guard + command-guard)
**Priority**: Wave 1 / P1 | **Effort**: S | **Source**: Terax `src/modules/ai/lib/security.ts:31-402`

**Why**
- Our `path-guard.ts` is narrow (`.env` / `.ssh` prefix matches).
- Terax's guard catches more: bidi-char Trojan Source attacks, NTFS Alternate Data Streams (`name:stream`), fork bombs (`:(){ :|:& };:`), `rm -rf ~` / `/` / `$HOME` variants, `curl|sh`, `dd of=/dev/disk`.
- Defense-in-depth: even if an agent gets adversarial input, the boundary check refuses obviously dangerous operations.

**Scope**
- Expand `apps/desktop/src/main/security/path-guard.ts`:
  - Add bidi-char detection (`‪-‮`, `⁦-⁩`).
  - Add NTFS ADS collapse (Windows future-proof).
  - Re-canonicalize symlinks and re-check after resolution (already there per T104 — verify).
- New `apps/desktop/src/main/security/command-guard.ts`:
  - Refuse: fork bombs, `rm -rf` on home/root, `dd of=/dev/...`, `curl|sh`, `wget -O- | sh`.
  - Apply at any shell-exec boundary (currently only spawn — extend if/when we add one-shot exec).
- Unit tests covering each refusal in `__tests__/`.

**Likely files**
- `apps/desktop/src/main/security/path-guard.ts`
- `apps/desktop/src/main/security/command-guard.ts` (new)
- `apps/desktop/src/main/security/__tests__/`

---

### T118 — CSP Header in Renderer
**Priority**: Wave 1 / P1 | **Effort**: S | **Source**: Terax `tauri.conf.json:27`

**Why**
- Renderer has no Content-Security-Policy. With browser pane loading arbitrary URLs, XSS surface is larger than necessary.
- Defense-in-depth — explicit allowlist of script sources and connect targets.

**Scope**
- Add `<meta http-equiv="Content-Security-Policy" content="...">` to `apps/desktop/src/renderer/index.html`.
- Suggested baseline:
  - `default-src 'self'`
  - `script-src 'self' 'wasm-unsafe-eval'`
  - `style-src 'self' 'unsafe-inline'` (Tailwind needs inline)
  - `img-src 'self' data: blob: https:`
  - `connect-src 'self' https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com ...` (whatever providers we hit directly).
- Verify the browser pane webview doesn't inherit this (it's its own webContents).

**Likely files**
- `apps/desktop/src/renderer/index.html`

---

### T119 — Capability Allowlist Pattern (Tauri-style)
**Priority**: Wave 1 / P2 | **Effort**: M | **Source**: Terax `src-tauri/capabilities/default.json:9-28`

**Why**
- Today the preload exposes the full tRPC surface and every IPC channel to the renderer via `contextBridge`.
- With a XSS hole the attacker gets everything. Tauri's capability allowlist limits this declaratively.

**Scope**
- New `apps/desktop/src/preload/capabilities.json`: declarative list of allowed tRPC procedure paths + raw IPC channels.
- Modify `apps/desktop/src/preload/index.ts` to enforce the allowlist before forwarding.
- Modify `apps/desktop/src/main/ipc/router.ts` to also enforce (defense in depth — preload check + main check).
- Doc: `docs/ARCHITECTURE/CAPABILITIES.md` explaining the model.

**Likely files**
- `apps/desktop/src/preload/capabilities.json` (new)
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/main/ipc/router.ts`

---

### T120 — Settings as Separate BrowserWindow
**Priority**: Wave 1 / P2 | **Effort**: M | **Source**: Terax `src-tauri/src/lib.rs:32-86`

**Why**
- Today `SettingsPanel` is a modal in the main window — opening it covers the terminal layout.
- We already have `windows/floating.ts` (T84 PiP) — same primitive works for a settings window.
- Better multitask: keep an eye on agent output while changing API keys, themes, etc.

**Scope**
- New `apps/desktop/src/main/windows/settings.ts`:
  - `openSettingsWindow(tab?: string)`: open if not exists, focus if exists, emit deep-link event for specific tab.
  - `parent: mainWindow` (lifecycle tied — closes when main closes).
  - **Do NOT use `alwaysOnTop: true`** — anti-pattern (fights Mission Control on macOS, listed in review).
- Renderer: settings webview entry (`?settings=1`) mounts `<SettingsPanel/>` standalone.
- Replace current modal trigger with IPC call to `openSettingsWindow`.
- Deep-link example: "No API key" error → button "Open API Keys" → `openSettingsWindow('api-keys')`.

**Likely files**
- `apps/desktop/src/main/windows/settings.ts` (new)
- `apps/desktop/src/main/ipc/procedures/window.ts` (new IPC)
- `apps/desktop/src/renderer/main.tsx` (route on `?settings=1`)
- `apps/desktop/src/renderer/components/settings/SettingsPanel.tsx` (adapt to standalone)

---

### T121 — electron-window-state
**Priority**: Wave 1 / P2 | **Effort**: S | **Source**: Terax `tauri-plugin-window-state` (analog)

**Why**
- Window size and position aren't restored across launches. Annoying for power users.
- Library `electron-window-state` (npm) is the canonical Electron solution. Stable, ~200 LOC.

**Scope**
- Add `electron-window-state` to `apps/desktop/package.json`.
- Wire into `apps/desktop/src/main/index.ts` window creation: `windowStateKeeper({ defaultWidth, defaultHeight })`.
- Persist position, size, maximized state across launches.
- **Exclude `VISIBLE` state** (mirror Terax pattern at `lib.rs:98-102`): app should always paint first, then `show()`, to avoid transparent-window-shadow flash on Linux/Windows when we get there.

**Likely files**
- `apps/desktop/package.json`
- `apps/desktop/src/main/index.ts`

---

### T122 — Vercel AI SDK + Ollama Support
**Priority**: Wave 1 / P3 (radar) | **Effort**: M | **Source**: Terax `src/modules/ai/lib/agent.ts:70-211` + `transport.ts:71-114`

**Why**
- Today our two direct LLM calls (`diff.ts:324-396` Smart Git Button commit msg + `scoring.ts:210-280` Tier-3 LLM-as-judge) use raw `fetch()` to `api.anthropic.com`. No cache breakpoints, no retry, no abort beyond timeout, brittle regex parse for structured output.
- Vercel AI SDK v6 gives us all of that + provider-agnostic API. Unlocks **Ollama / LM Studio / local models** via `@ai-sdk/openai-compatible` with a single abstraction.
- Not vital for our spawned-CLI core — keep on radar but value compounds if we add more in-process LLM utilities.

**Scope**
- Add deps: `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible` (for Ollama/LM Studio).
- New `apps/desktop/src/main/ai/llm.ts`:
  - `getAnthropic(db)`: pulls key from `keystore`, returns `LanguageModel`.
  - `getOllama(baseUrl)`: returns local OpenAI-compatible model.
  - `applyCacheBreakpoints(messages)`: helper porting Terax's `agent.ts:294-311` pattern.
- Refactor `diff.ts:324-396`:
  - `generateText({ model, prompt, maxOutputTokens: 120, abortSignal })` instead of fetch.
- Refactor `scoring.ts:210-280`:
  - `generateObject({ model, schema: z.object({ clarity: z.number().min(1).max(5), ... }) })` — replaces regex parse on `text.match(/\{[^}]+\}/)`.
  - Apply cache breakpoints for ~30–50 % cost reduction across Tier-3 evaluations.
- Settings UI: new "Local Models" section under API Keys for Ollama base URL + model picker.
- **Anti-pattern reminder**: do NOT add separate code branches for Ollama / LM Studio / MLX. Single OpenAI-compatible abstraction with base-URL + name + key + headers config.

**Likely files**
- `apps/desktop/package.json`
- `apps/desktop/src/main/ai/llm.ts` (new)
- `apps/desktop/src/main/ipc/procedures/diff.ts`
- `apps/desktop/src/main/agents/scoring.ts`
- `apps/desktop/src/renderer/components/settings/ApiKeysSettings.tsx` (Ollama config)

---

## Suggested Order

### Next wave (P0)
1. **T65** — Parallel Multi-Agent on Worktrees

### Stabilization & quality (P2)
2. T81 — Dependency Injection for Singletons

### Competitor-inspired backlog (P2-P3)
4. **T88** — Ralph Loops in Pipelines (evaluator step)
4. **T90** — Terminal ↔ Chat dual view
5. **T92** — Cross-repo workspaces
6. **T93** — Mobile companion app
7. **T94** — Headless daemon mode
8. **T97** — Panel Plugin SDK (v1.0 architecture — design spike first)

---

## Distribution (pending GitHub)

### T45 — CI/CD Release Pipeline
**Priority**: P3 — activate when repo goes to GitHub

### T46 — Canary Channel
**Priority**: P3

