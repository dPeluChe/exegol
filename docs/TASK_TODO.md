# Exegol — Task Board

> Audience: current contributors planning the next implementation wave after the initial MVP.
> This board is the active backlog for product differentiation, operational confidence, and release readiness.
> **Pending tasks only** — completed work lives in [`TASK_COMPLETED/`](./TASK_COMPLETED/) (monthly files) and `CHANGELOG.md` (per release).

> **Quality gate before PR**
> - `npx @biomejs/biome check --fix apps/ packages/shared/src/ packages/ui/src/`
> - `npx tsc --noEmit -p apps/desktop/tsconfig.node.json && npx tsc --noEmit -p apps/desktop/tsconfig.web.json`
> - Max 400-500 LOC per file unless a refactor task explicitly says otherwise

---

## Priority Order

### Wave 2 — Competitive Review (2026-07) — ACTIVE
Strategic context: the "worktree wrapper" niche commoditized (Bloop dead, Crystal deprecated, Roo archived).
Exegol's moat = orchestration layer: **Pipelines → Evidence → Undo → Scoring** on top of sidecar resilience.
Full analysis: `docs/RESEARCH/COMPETITIVE_REVIEW_2026_07.md`.

**P0 — Pre-launch (table stakes + quick wins):**
1. **T123** — Agent status via hooks + OSC 777 (replaces scraping as primary signal) ← unblocks T124, T129, T141
2. **T124** — NotificationBus + desktop notifications (depends on T123)
3. **T125** — Hybrid search RRF (FTS5 + Ollama + qmd formula)
4. **T126** — Memory salience v2 (half-life decay + reinforcement + supersession)
5. **T127** — Progressive disclosure skills (metadata-only injection)
6. **T128** — terminal-url-detector → browser pane
7. **T141** — Attention Inbox (unread/needs-attention UX, depends on T123)
8. **T143** — Resource & Memory Hardening (ring-buffer budget, xterm disposal audit, re-scopes T114)
9. **T148** — First-run Onboarding Wizard (CLI detection + keys + doctor — cold users must win in <2 min)

**P1 — Launch differentiators:**
10. **T129** — Oplog v2: git-tree snapshots per agent turn (GitButler model)
11. **T130** — Pipeline Evidence (Artifacts-style, multi-provider)
12. **T88v2** — Evaluator gate: two-pass judge + score distribution + ship/hold/retry
13. **T140** — Project Knowledge Node (digest + brief per project)
14. **T145** — Exegol MCP Server + CLI shim (agents query/update memory/knowledge/tasks mid-session)
15. **T142** — Integrations Hub: GitHub API (PR sync + review-comment → fix-agent loop)
16. **T147** — Cost Dashboard + Budgets (pain point #2; alerts via NotificationBus)
17. **T131** — Race mode polish (loser cleanup + defer)
18. **T146** — Project Groups (sidebar folders: color, icon, collapse — visual only)

> Pain-point coverage map: `docs/RESEARCH/DEV_PAIN_POINTS_2026.md` (top-10 complaints vs backlog)

**P2 — Post-launch bets:**
T132 automations catalog · T133 remote channel (Telegram) · T134 ACP experimental ·
T135 derived status + CDC · T136 tiered merge resolver · T137 hunk assignment + absorb ·
T138 ModeTracker headless · T139 skills security scan · T144 dependency/library audit

### Shipped waves
- **Wave 1 — Stack Optimizations (Terax review, 2026-05)**: quick wins + WT1-WT5 + T120 settings window.
  Details: `docs/TASK_COMPLETED/2605.md` · `docs/CHANGELOG.md` · analysis `docs/RESEARCH/TERAX_STACK_REVIEW.md`
- Earlier waves (V1-V3, T01-T107): `docs/TASK_COMPLETED/2603.md`, `2604.md`, `docs/applied/`

### Manual verification pending (post-merge) `added: 2026-05-22`
Wave 1+2 landed via 5 parallel WTs, T120 on top. Manual smoke-test recommended before broad release:
- OSC 7 cwd badge on shell panes (open shell, `cd /tmp`, verify badge updates)
- OSC 133 prompt boundaries (jump-to-previous-prompt should work)
- Parallel agent comparator (spawn 2-3 agents on same task, verify columns + promote button)
- Isolation badge states (isolated / pipeline / project-root / fallback)
- Stop-reason panel (let an agent finish/fail, verify overlay with resume/new-task/diff actions)
- CSP changes (open DevTools console, verify zero CSP violations on basic flow)
- Capability allowlist (no functional regression — all routers/IPC still callable from renderer)
- **T120 settings window**: Cmd+, opens standalone; second Cmd+, focuses existing (no duplicate); Cmd+W closes settings only; main close also closes settings; minimize main keeps settings visible; theme change in settings reflects in main without reload

### P3 — Strategic bets / larger scope (post Wave 2)
- **SSH Remote Development** (T73)
- **CI/CD release pipeline** (T45) — activate when repo goes public
- **Canary channel** (T46)
- **Cross-repo workspaces** (T92) — front + back in one workspace (T146 project groups is the cheap precursor)
- **Mobile companion app** (T93) — natural successor of T133 Telegram channel
- **Headless daemon mode** (T94) — prerequisite for T93
- **Panel Plugin SDK** (T97) — extensible panel system, v1.0 architecture (design spike first)
- **xterm renderer pool** (T114) — re-scoped inside T143: measure after disposal fixes, build only if needed
- **Vercel AI SDK + Ollama** (T122) — value compounds with T130/T147 in-process LLM calls
- **Issue tracker expansion** (T71) — Linear/Jira; plugs into T142 integrations registry
- **T60 project hooks** — ⚠️ mostly superseded by shipped T91 (`.exegol/lifecycle.yaml`); pending delta only: `archive` hook on worktree archival + env vars — review & fold or drop

---

## Active Backlog

### T58 — Runtime Permission Modes (remaining delta) `added: 2026-04-01`
**Priority**: P2 | **Effort**: S | **Source**: Anvil

Core shipped in v0.4.3 (types, spawn injection, modal selector, badge, pipeline propagation — archived in `TASK_COMPLETED/2604.md`). Remaining:
- Runtime mode switching (change mode while agent is running)
- Scheduler task `accessMode` propagation
- New consumer: T145 MCP tool-set gating reads this mode

**Likely files**
- `apps/desktop/src/main/agents/*`
- `apps/desktop/src/main/pipeline/*`
- `apps/desktop/src/renderer/components/agents/SpawnAgentModal.tsx`
- `apps/desktop/src/renderer/components/terminal/*`

---

### T60 — Project Hook Scripts (remaining delta) `added: 2026-04-01`
**Priority**: P3 | **Effort**: S | **Source**: Orca + Emdash

⚠️ **Mostly superseded by shipped T91** (`.exegol/lifecycle.yaml`: `setup`, `beforeAgent`, `afterCommit`, `teardown`). Remaining delta only:
- `archive` hook fired on worktree archival (T91 has no archival-specific hook)
- Env vars in hooks: `EXEGOL_ROOT_PATH`, `EXEGOL_WORKTREE_PATH`, `EXEGOL_BRANCH`, `EXEGOL_AGENT_ID`
- Decision: fold into `lifecycle/loader.ts` or drop

**Likely files**
- `apps/desktop/src/main/lifecycle/loader.ts`

---

### T71 — Issue Tracker Expansion (Linear / Jira) `added: 2026-04-15`
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

### T73 — SSH Remote Development `added: 2026-04-15`
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

## Post-launch Backlog — Inspired by Competitors

### T88 — Ralph Loops in Pipelines `added: 2026-04-15`
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

**v2 upgrade (2026-07 review — agent-eval + theloop patterns):**
- **Two-pass judge**: pass 1 describes what the diff actually does (adversarial),
  pass 2 issues the verdict — reduces judge rationalization
- **Score distribution, not binary**: N judge calls (default 3) → distribution;
  gate policy `ship / hold / retry` with thresholds instead of single PASS/RETRY
- **Cost tracking** per loop iteration surfaced in run view (feeds T130 evidence)

**Likely files**
- `packages/shared/src/types/pipeline.ts` (new step type)
- `apps/desktop/src/main/pipeline/executor.ts` (evaluator routing)
- `apps/desktop/src/main/pipeline/context.ts` (retryFeedback variable)
- `apps/desktop/src/renderer/components/workspace/sections/pipeline/PipelineEditor.tsx`

---

### T92 — Cross-repo Workspaces `added: 2026-04-15`
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

### T93 — Mobile Companion App `added: 2026-04-15`
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

### T94 — Headless Daemon Mode `added: 2026-04-15`
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

### T97 — Panel Plugin SDK `added: 2026-04-15`
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

## Wave 2 Backlog — Competitive Review 2026-07

> Source analysis: `docs/RESEARCH/COMPETITIVE_REVIEW_2026_07.md`. Repos studied live in
> `~/dPeluCheData/PROJECTS/dPeluChe/_code_/_repos_2_learn/github.com/`.

### T123 — Agent Status via Hooks + OSC 777 `added: 2026-07-04`
**Priority**: P0 | **Effort**: M | **Source**: terax `src-tauri/src/modules/pty/agent_detect.rs` + superset `terminal-agents/store.ts` + emdash `hook-server.ts`

**Why**
- Current `status_parser.rs` guesses state from ANSI output — fragile, imprecise `waiting_input`.
- Three competitors converged independently on deterministic signal: CLI hooks emit `OSC 777 notify;Exegol;<agentId>;<event>` into the PTY; a byte-level FSM in the stream detects Started/Working/Attention/Finished.
- Unblocks: T124 notifications, T129 per-turn snapshots, T141 attention inbox, precise pipeline transitions.

**Scope**
- Spawn-time hook injection per provider: Claude Code native hooks (`Stop`, `Notification`, `PreToolUse` → settings JSON in spawn env), wrapper/shell-init for others
- OSC 777 FSM in Rust `AgentOutputStream` (extend `processing/status_parser.rs`) — existing parser becomes fallback for hook-less CLIs
- New push event fields: `turnStarted/turnEnded/needsAttention` timestamps
- Emit turn boundaries on the agent event bus (consumed by T124/T129)

**Likely files**
- `packages/core-rust/src/processing/status_parser.rs`
- `apps/desktop/src/main/agents/spawn-env.ts`, `spawn-context.ts`, `manager.ts`
- `apps/desktop/src/main/agents/status-parser.ts` (JS fallback)

---

### T124 — NotificationBus + Desktop Notifications `added: 2026-07-04`
**Priority**: P0 | **Effort**: S-M | **Source**: openclaw clones (`nanoclaw/src/delivery.ts`, `nanobot/channels/base.py`) — irreducible pattern: bus + 1-method channel adapters

**Why**
- Table-stakes gap: Warp, Codex app, Orca all notify "agent finished / needs input". Indispensable at 5+ agents.
- Minimal channel interface keeps Telegram/mobile (T133) cheap later.

**Scope**
- `main/notifications/bus.ts`: receives `agent:attention`, `agent:finished`, `pipeline:paused`, `run:failed` (fed by T123)
- Channel interface: `deliver(event, content)` — v1 channel: Electron Notification API + dock badge + optional sound
- **Include the agent's pending question** in the attention notification when available (scrollback tail parse) — "waiting for input" alone forces a context switch to find out why (pain point #4)
- Settings: per-event toggles, quiet mode
- Suppress-empty pattern (openclaw `shouldSkipHeartbeatOnlyDelivery`)

**Likely files**
- New: `apps/desktop/src/main/notifications/{bus,channels/desktop}.ts`
- `apps/desktop/src/main/ipc/procedures/settings.ts`, renderer settings UI

---

### T126 — Memory Salience v2 (Decay + Reinforcement + Supersession) `added: 2026-07-04`
**Priority**: P0 | **Effort**: S | **Source**: memU `src/memu/vector.py` (salience 25-62), schema `reinforcement_count`

**Why**
- Current 3-factor relevance never decays; stale facts (old build commands) rank forever.

**Scope**
- `salience = similarity × log(reinforcement_count + 1) × exp(-0.693 × days_ago / 30)` (30-day half-life)
- Migration: add `reinforcement_count`, `last_reinforced_at`, `superseded_by` to memories
- Re-observed fact → reinforce instead of duplicate; contradicting fact → new row + mark old `superseded_by` (never overwrite)
- Extractor prompt: anti-ephemeral rules; consider adding `tool`/`behavior` categories (memU's 6)
- Memories remain **project-scoped in DB** (worktree-agnostic; see T140 storage model) — `MEMORY.md` synthesis export lives in T140

**Likely files**
- `apps/desktop/src/main/memory/{store,extractor}.ts`, `apps/desktop/src/main/db/migrations`

---

### T128 — Terminal URL Detector → Browser Pane `added: 2026-07-04`
**Priority**: P0 | **Effort**: S | **Source**: emdash `terminal-url-detector`

**Scope**
- Detect `https?://localhost:PORT` (and 127.0.0.1) in PTY output stream
- Toolbar chip "Open preview" → opens URL in a browser pane in the same tab
- Dedup per session; ignore URLs inside scrollback replay

**Likely files**
- `apps/desktop/src/main/terminal/*` or sidecar notification path, `TerminalPanel.tsx`, workspace store

---

### T129 — Oplog v2: Git-Tree Snapshots per Agent Turn `added: 2026-07-04`
**Priority**: P1 | **Effort**: M-L | **Source**: GitButler `crates/gitbutler-oplog/` (oplog.rs, reflog.rs, entry.rs) + `but-oplog` unmaterialized pattern + t3code `CheckpointStore.ts`

**Why**
- Strongest differentiator identified. Agents edit faster than git commits; current oplog only covers git operations. GitButler's model gives per-turn granular undo with zero new infra (no CAS, no daemon, no file watcher) — pure git2, which we already ship.

**Scope**
- Snapshot = commit whose tree captures `worktree/ + index/ + app state`; chained parent-child log per project
- Anti-GC: hidden ref (`refs/exegol/oplog`) with forged reflog (GitButler `reflog.rs` trick) — reachable but invisible in `git log --all`
- Metadata as git trailers: `operation: AgentTurn|PipelineStep|Promote|...`, `agentId`, `provider`
- Trigger: turn boundaries from T123 (`prepare_snapshot` on turn start → `commit_snapshot` on success; unmaterialized discard on failure)
- Undo UI: timeline in GitPane oplog tab with per-turn restore + agent attribution

**Likely files**
- `packages/core-rust/src/git/oplog.rs` (major extension), `apps/desktop/src/main/ipc/procedures/git.ts`, GitPane oplog UI

---

### T131 — Race Mode Polish (T65 follow-up) `added: 2026-07-04`
**Priority**: P1 | **Effort**: S | **Source**: runoff (race semantics)

**Scope**
- Auto-cleanup loser worktrees + branches on promote (unless dirty → prompt)
- Defer mode: nothing lands on the main branch until explicit winner selection
- Comparator: "promote & clean" single action

---

### T140 — Project Knowledge Node (digest + brief) `added: 2026-07-04`
**Priority**: P1 | **Effort**: M | **Source**: original idea (Antonio) + memU `memory_fs/synthesizer.py` (incremental synthesis) + stoneforge (git-tracked state) + Kilo Code "Memory Bank" (closest prior art — validate against it)

**Why**
- No orchestrator offers a per-project living knowledge layer, provider-agnostic. Two complementary halves:
  1. **DIGEST** — structural understanding of the codebase (what exists), auto-refreshed
  2. **BRIEF** — intent (what it does, what it should do, where it's going, decisions)
- The IDE becomes a knowledge node that feeds any agent it spawns — memory is per-fact, this is per-project narrative + structure.

**Scope**
**Storage model (decided 2026-07 — two tiers + bridge):**
- **Facts stay in DB** (memories table, project-scoped): worktree-agnostic — learned in any worktree, instantly available to all agents; nothing lost on worktree deletion; high-churn data never pollutes PRs. Salience/decay/supersession (T126) require DB anyway.
- **`.exegol/knowledge/` in the repo** (git-tracked, travels with branches):
  - `PROJECT.md` — user-editable brief, **committed** → agent/user updates show up as reviewable diffs in PRs. Section-structured to minimize merge conflicts. Agents propose, never silently overwrite.
  - `DIGEST.md` — generated via `trs digest` (detect binary; fallback internal summarizer), **gitignored by default** (derivable, high-churn); staleness refresh on Smart Git commit/push/merge or N commits behind. Opt-in commit.
  - `MEMORY.md` — **the bridge (memU synthesizer pattern)**: periodic/manual distillation of top-salience DB facts, **committed** → team members seed their Exegol from it on clone; agents outside Exegol benefit too; facts become PR-reviewable.
- **Managed block in AGENTS.md / CLAUDE.md**: delimited markers (`<!-- exegol:knowledge:begin/end -->`) with a ~40-token pointer to `.exegol/knowledge/` — Exegol only writes inside markers. Even CLIs launched outside Exegol pick up the knowledge (their native context file reads it). Progressive disclosure: pointer always, files read on demand.
- Injection via spawn-context with progressive disclosure (same mechanism as T127)
- Pipelines: `{{knowledge}}` template variable
- UI: "Knowledge" sub-tab under Project (edit brief, digest freshness, force refresh, "Sync MEMORY.md" action, import MEMORY.md as seed on project add)

**Likely files**
- New: `apps/desktop/src/main/knowledge/{digest,brief,staleness}.ts`
- `apps/desktop/src/main/agents/spawn-context.ts`, `apps/desktop/src/main/pipeline/context.ts`
- New renderer section `sections/KnowledgeSection.tsx`

---

### T141 — Attention Inbox (unread / needs-attention UX) `added: 2026-07-04`
**Priority**: P0 | **Effort**: S-M | **Source**: Orca (Gmail-like unread/star on worktrees) + superset (ringtone/badge bindings)

**Why**
- With 5+ agents the question is "who needs me now?". We have StatusDot/activity pulse but no unread semantics — attention state is lost when you look away.

**Head start (found in 2026-07 dead-code sweep)**: `stores/agents.ts` already ships a persisted attention inbox from T57 — `attentionItems` (level/reason/read/pinned), `addAttentionItem`, `markAttentionRead`, `dismissAttention`, `toggleAttentionPin`, `unreadAttentionCount`, auto-read-on-focus. Push events already feed it. **Extend this store; the missing part is UI** (badges, TitleBar queue, jump hotkey) + wiring T123's richer signals.

**Scope**
- Unread state per agent/tab: set on `finished`/`needsAttention` (from T123), cleared on focus
- Sidebar + tab badges with counts; global "needs attention" queue in TitleBar (click = jump to pane)
- Keyboard: hotkey jumps to next agent needing attention

**Likely files**
- `apps/desktop/src/renderer/stores/agents.ts`, `WorkspaceTabBar.tsx`, `Sidebar.tsx`, `TitleBar.tsx`

---

### T142 — Integrations Hub: GitHub API first `added: 2026-07-04`
**Priority**: P1 | **Effort**: M | **Source**: original idea (Antonio) + emdash (11 tracker integrations validate demand); extends T71

**Why**
- Today PR state comes from `gh` CLI (Smart Git Button). A token-based GitHub API integration (Integrations section, not GitHub-exclusive) removes the gh dependency and unlocks the real prize: **closing the review loop** — PR review comments flow back into Exegol and can spawn a fix agent.
- Relating PRs ↔ projects ↔ agent runs gives us data no competitor surfaces: which agent's PRs get merged fastest, which get the most review pushback (feeds scoring).

**Scope**
- Settings → Integrations section: GitHub token (keystore/safeStorage), scopes documented; `gh` CLI stays as fallback
- PR sync per project: open PRs, review states, CI checks, review comments (poll + on-focus refresh)
- GitPane: PR panel enriched from API (checks, reviewers, comments count) — replaces gh-based lookups when token present
- **Review-comment → task → fix agent**: one click turns unresolved review threads into a task with `{{prComments}}` context, optionally auto-spawns a fix agent on the PR branch
- Link PR ↔ agent run ↔ pipeline run in DB (provenance: "this PR came from run X")
- Architecture: `main/integrations/{registry,github/*}.ts` — registry pattern so Linear/Jira (T71) plug in later

**Likely files**
- New: `apps/desktop/src/main/integrations/*`, migration (pr_links table)
- `apps/desktop/src/main/ipc/procedures/github.ts`, `GitPane.tsx`, `SmartGitAction.tsx`, settings UI

---

### T143 — Resource & Memory Hardening `added: 2026-07-04`
**Priority**: P0 | **Effort**: M | **Source**: internal audit + emdash (pidusage per agent) + terax renderer pool (re-scopes T114)

**Why**
- Launch quality: a demo with 10 agents must not lag or leak. Known risk surface: 8MB ring buffer × N sessions, 1 WebGL context per terminal pane (T114 deferred), xterm/addon disposal on pane close, scrollback serialize size, 6.8MB bundled fonts in initial load path.

**Scope**
- **Budget & metrics**: per-agent RSS (pidusage-style) + ring buffer memory + PTY count surfaced in Monitor → Resources; warning threshold with notification (via T124)
- **Disposal audit**: verify xterm + WebGL addon + Serialize addon are fully disposed on pane close/tab close/float detach; fix leaks
- **Ring buffer policy**: global cap (e.g. 256MB) with LRU eviction to disk for idle sessions; shells keep small buffers
- **T114 re-scope**: renderer pool only if >5 visible terminals proves laggy after disposal fixes — measure first, then decide (BENCHMARKS.md entry)
- Scrollback serialize cap on reattach snapshot

**Likely files**
- `apps/desktop/src/main/system/resources.ts`, sidecar ring buffer, `TerminalInstance.tsx`, `stores/terminals.ts`, Monitor sections

---

### T144 — Dependency & Library Audit `added: 2026-07-04`
**Priority**: P2 | **Effort**: S-M | **Source**: internal

**Scope**
- Upgrade pass: Electron 41 → current stable, React 18 → 19 (evaluate: emdash ships 19), xterm/addons, node-pty rebuild chain, Biome, TS
- `spark audit` + `bun pm ls` review: prune unused deps, dedupe, license check pre-open-source
- **knip config** (`knip.json` with electron-vite entries: main/index, preload, renderer, pty-sidecar-entry, workspaces): raw run 2026-07 flagged 42 exports + deps but produced false positives on `export *` barrels (e.g. `listProjects` flagged while used) — needs tuned config before pruning; then delete verified-dead exports
- Bundle budget: initial chunk ≤ 1MB enforced in CI (fonts already lazy — verify), track in BENCHMARKS.md
- Rust: `cargo update` + clippy pedantic re-run; napi + memchr versions
- Baseline 2026-07 (pre-wave sweep): 0 files >450 LOC, 0 TODOs/FIXMEs, clippy clean; dead code removed (-1,981 LOC: 5 disconnected sections, paneLayouts subsystem, dead store actions/query fns)
- **Orphaned tRPC procedures inventory** (defined in routers, renderer never calls — review with product before deleting; some are planned-feature stubs): `projects.open`, `agents.getStatus/updateStatus/getParallelRun/cancelParallelRun/preflight`, `settings.updateModelCatalog`, `resources.portConflicts`, `apikeys.test`, `scheduler.get`, `scrollback.exists`, `skills.getEnabledForSpawn`, `mcp.callTool`, `memory.updateRelevance/getContext/extract`, `messages.conversation/markAllRead/unreadCount`, `queue.get/updateStatus`, `qa-tests.get`, `fs-search.fuzzyFind/grep`, `indexer.projectStats/startIndexing/search`
- ~~Recovery half-wiring~~ resolved 2026-07: `invalidatePane`/`getRecoveryToken`/`RecoveryToken` removed (`invalidReason` stays — set via `updatePane`, rendered in WorkspacePane); unused deps removed (`@radix-ui/react-dialog` in desktop+ui, `react-dropdown-menu` + `lucide-react` in ui)

---

### T145 — Exegol MCP Server + CLI Shim (agent ↔ Exegol runtime API) `added: 2026-07-04`
**Priority**: P1 | **Effort**: M | **Depends**: T125, T126, T140 | **Source**: design discussion 2026-07

**Why**
- Facts live in the DB (T140 storage model) — spawn-time injection is static. Agents (Claude Code, Codex, Gemini all speak MCP) need to **query and update** memory/knowledge mid-session. We don't control the agent loop, but we can hand it tools.
- One door for everything: memory today; oplog queries, task updates, notification requests later.

**Scope**
- **Built-in MCP server `exegol`** (stdio shim → Unix socket → main process), auto-added to spawn MCP config:
  - `memory_search(query, category?)` → hybrid RRF search (T125), returns top-salience facts
  - `memory_save(fact, category)` → T126 semantics: reinforce if known, supersede if contradicting — the store decides, the agent can't corrupt
  - `knowledge_get(section?)` → PROJECT.md brief / digest summary
  - **v1.1 — project awareness & management**: `task_list/task_update` (tasks from DB), `history_search` (past runs/handoffs/scrollback summaries), `score_get` (own past performance on this project) — the agent can *know* the project's state and improve it, not just read facts
- **CLI shim fallback**: `exegol-ctl mem search|add`, `knowledge get` — same socket; covers CLIs without MCP. Documented in the managed AGENTS.md block (T140)
- **Guards**: `EXEGOL_AGENT_ID` env signs every write (attribution); access modes (T58) gate writes — `read`/`plan` agents get search-only tool set
- Shells skip the server entirely (existing shell-skip pattern)

**Likely files**
- New: `apps/desktop/src/main/mcp/exegol-server.ts` (socket endpoint + tool handlers), `packages/mcp-shim/` or bundled script for stdio↔socket proxy + `exegol-ctl`
- `apps/desktop/src/main/agents/spawn-context.ts` (auto-register server, mode-based tool set)
- `apps/desktop/src/main/memory/store.ts` (reuse search/save paths)

---

### T147 — Cost Dashboard + Budgets `added: 2026-07-04`
**Priority**: P1 | **Effort**: M | **Source**: dev pain point #2 (`docs/RESEARCH/DEV_PAIN_POINTS_2026.md`) — surprise costs / rate limits is the #2 complaint industry-wide

**Why**
- We already collect `token_usage` + tokenlens; nobody surfaces "what did this run cost me" across providers. Post-repricing (Cursor 2025) devs are burned and cost-anxious — visibility is a trust feature.

**Scope**
- Monitor → Tokens upgraded: cost per agent, per run, per pipeline, per day/week; provider price table (editable, ships with defaults)
- Budgets: per-project daily/weekly token or $ budget → warning at 80%, alert at 100% via NotificationBus (T124); optional hard-stop option for scheduled/automation runs
- Pipeline run view + T130 evidence: cost per step surfaced inline
- Rate-limit awareness: detect provider rate-limit messages (hook/OSC or scrollback pattern) → status + suggest switching provider (ties to comparator A/B story)

**Likely files**
- `apps/desktop/src/main/db/queries/token-usage.ts`, Monitor sections, `main/notifications/*`, pipeline run UI

---

### T148 — First-run Onboarding Wizard `added: 2026-07-04`
**Priority**: P0 | **Effort**: S-M | **Source**: dev pain point #7 (setup complexity) — critical for public launch

**Why**
- Public launch means cold users. Complaint #7: "every repo demands complex setup just to start". Our pitch is "one place for all your CLIs" — the first run must prove it in under 2 minutes.

**Scope**
- First-run flow: detect installed CLIs (which of the 11 providers exist on PATH + versions), show found/missing with install links
- API key setup: only for what they use; keystore storage; skip-able
- "Add your first project" + optional guided spawn (safe: read-only mode suggestion)
- Health check summary reusable later as Settings → Doctor (gh present? git version? node-pty ok? Ollama running?)

**Likely files**
- New: `apps/desktop/src/renderer/components/onboarding/*`, `main/system/doctor.ts`
- `apps/desktop/src/main/agents/registry.ts` (CLI detection reuse)

---

### T146 — Project Groups (sidebar folders) `added: 2026-07-04`
**Priority**: P1 | **Effort**: S-M | **Source**: original idea (Antonio)

**Why**
- Devs with many repos (front + back + infra of one product, client work, experiments) get a flat sidebar today. Visual grouping unifies a product's repos regardless of workspace state — purely presentational, **paths and project identity unchanged**.
- Cheap sibling of T92 (cross-repo workspaces): groups give the mental model now; T92 can later bind a workspace to a whole group.

**Scope**
- New `project_groups` table: `id, name, color, icon, background?, sortOrder, collapsed`; `projects.groupId` nullable (ungrouped = root level) + `projects.sortOrder`
- Sidebar: collapsible group headers with color dot / icon / optional subtle background tint on the section; drag & drop projects between groups; divider between groups
- Group context menu: rename, color/icon picker (reuse AgentIcon-style picker), collapse/expand, disband (projects fall back to root)
- Optional: collapse-all / expand-all; group-level quick action "open all repos' status"

**Likely files**
- `apps/desktop/src/main/db/migrations` (+ queries/projects), `apps/desktop/src/main/ipc/procedures/projects.ts`
- `apps/desktop/src/renderer/components/layout/{Sidebar,ProjectsSection}.tsx`, `stores/app.ts`
- `packages/shared/src/schemas/project.ts`

---

### T132 — Automations Catalog `added: 2026-07-04`
**Priority**: P2 | **Effort**: S-M | **Source**: emdash `builtin-catalog.ts` + openclaw heartbeat/cron delivery

**Scope**
- Template catalog over existing `scheduler/engine`: "daily summary", "scan vulns", "add test coverage", "triage TODOs"
- Each run delivers result via NotificationBus (T124); suppress empty results
- One-click enable from a catalog UI in Project → Tasks

### T133 — Remote Notification Channel (Telegram first) `added: 2026-07-04`
**Priority**: P2 | **Effort**: M | **Depends**: T124
- Telegram bot channel implementing the same `deliver()` interface; allowlist of chat ids; optional reply→prompt injection later. Validated demand: Orca mobile app, AgentsRoom.

### T134 — ACP Boundary (experimental) `added: 2026-07-04`
**Priority**: P2 | **Effort**: L | **Source**: emdash `packages/core/src/acp/`, t3code `effect-acp`, Zed ACP
- Agent Client Protocol (JSON-RPC/stdio) for one provider (Claude Code or Gemini) in an experimental pane; structured events instead of PTY scraping; PTY remains default. Evaluate before committing to boundary refactor.

### T135 — Derived Status + CDC change_log `added: 2026-07-04`
**Priority**: P2 | **Effort**: M | **Source**: ComposioHQ/agent-orchestrator (OBSERVE→UPDATE→DERIVE)
- Persist only durable facts (`activity_state`, `is_terminated`); derive display status read-time by precedence. `change_log` table (SQLite triggers) with seq watermark → renderer reconnects without gaps. Kills stale-status bug class.

### T136 — Tiered Merge Resolver `added: 2026-07-04`
**Priority**: P2 | **Effort**: M | **Source**: overstory merge queue + clash (worktree conflict detection)
- For parallel runs/pipelines: (1) clean merge → (2) keep-incoming → (3) AI-resolve → (4) reimplement-from-spec. Auto-commit runtime state files (`.claude/`, etc.) so they never block merges.
- **Proactive overlap detection**: warn when 2+ active worktrees touch the same files *before* merge time (cheap: compare `git status` paths across worktrees on a timer / on turn end).

### T137 — Hunk Assignment + Absorb (GitPane) `added: 2026-07-04`
**Priority**: P2 | **Effort**: M-L | **Source**: GitButler `but-hunk-assignment` + `absorb.rs`
- Stable hunk UUIDs surviving edits → attribute uncommitted hunks to agents/branches; "absorb" redistributes agent fixups to the right commits.

### T138 — ModeTracker Headless `added: 2026-07-04`
**Priority**: P2 | **Effort**: S | **Source**: superset `terminal-mode-tracker.ts` (VSCode XtermSerializer lineage)
- Per-session headless xterm (scrollback 1) tracking VT modes (kitty keyboard, bracketed paste); reconstruct preamble on reattach — fixes Shift+Enter/paste after reload.

### T139 — Skills Security Scan (pre-import) `added: 2026-07-04`
**Priority**: P2 | **Effort**: S-M | **Source**: mission-control Skills Hub scanner
- Pattern gate before installing external skills/MCP configs: prompt-injection, credential exfil, dangerous shell, obfuscation. Blocks write-to-disk on match; user override with warning.

---

## Wave 2 Work Groups — 4 parallel worktrees from main

> Execution model: one worktree + one agent per group, branched from `main`.
> Each group works its tasks **in the internal order listed** (dependencies flow that way),
> runs the quality gate, and opens **one PR per task** (small, reviewable) against `main`.
> Rebase from main after every merged PR from another group.

### WT-A — Signal & Attention `branch: feat/wta-signal`
**Tasks in order**: T123 → T124 → T141 → T128
**Theme**: deterministic agent status + everything that consumes it in the UI.
**Write set**: `packages/core-rust/src/processing/*` · `main/agents/{spawn-env,status-parser,manager}.ts` · new `main/notifications/*` · `renderer/stores/agents.ts` · `WorkspaceTabBar/Sidebar/TitleBar` · terminal toolbar (URL chip)
**Contract it publishes** (other groups build against this): event names `agent:attention` / `agent:finished` / `pipeline:paused` / `run:failed`, turn timestamps `turnStarted/turnEnded`, `NotificationBus.emit(event, payload)` interface.

### WT-B — Memory, Knowledge & Skills `branch: feat/wtb-knowledge`
**Tasks in order**: ~~T125~~ → ~~T126~~ → ~~T127~~ → T140 → T145 (T125/T126/T127 shipped 2026-07-05, see `TASK_COMPLETED/2607.md`)
**Theme**: everything an agent knows — search, salience, skills disclosure, knowledge node, MCP access.
**Write set**: `main/memory/*` · new `main/knowledge/*` · `main/skills/*` · new `main/mcp/exegol-server.ts` · `db/queries/search.ts` · migrations **36-39** · `sections/KnowledgeSection.tsx`
**Owns** the injection block in `spawn-context.ts` (WT-A only touches `spawn-env.ts` — keep functions separate).

### WT-C — Git, Pipelines & Evidence `branch: feat/wtc-pipelines`
**Tasks in order**: T129 → T130 → T88v2 → T131
**Theme**: the launch headline — per-turn undo, verifiable evidence, statistical evaluator, race semantics.
**Write set**: `packages/core-rust/src/git/*` · `main/pipeline/*` · `main/ipc/procedures/{git,diff}.ts` · GitPane oplog UI · `sections/pipeline/*` · `packages/shared/src/types/pipeline.ts`
**Stub note**: T129 uses turn boundaries from T123 — start with process-exit boundaries, wire real turns after WT-A's T123 PR merges.

### WT-D — Product Surface & Health `branch: feat/wtd-surface`
**Tasks in order**: T148 → T143 → T147 → T146
**Theme**: what a new user touches — onboarding, stability, cost visibility, project organization.
**Write set**: new `renderer/components/onboarding/*` · new `main/system/doctor.ts` · `main/system/resources.ts` · Monitor sections · `db/queries/token-usage.ts` · `TerminalInstance.tsx` (disposal) · `Sidebar/ProjectsSection` · migrations **40-42**
**Stub note**: T143/T147 alerts emit through the `NotificationBus` interface from WT-A's contract — mock the emitter until WT-A merges.

### Base already in main (do NOT recreate — extend)
- **Signal/notification contract**: `packages/shared/src/types/agent-signals.ts` — `AgentSignalEvent`, `TurnBoundary`, `NotificationEvent(+Type)`. Extend here, never fork shapes locally.
- **NotificationBus skeleton**: `apps/desktop/src/main/notifications/bus.ts` — `getNotificationBus().emit(event)` is a safe no-op until WT-A registers channels. WT-C/D emit through it from day 1.
- **Per-group migration sets**: `apps/desktop/src/main/db/migration-sets/{wave2-signal,wave2-knowledge,wave2-surface}.ts` — append ONLY to your own file with your id prefix (`w2a_`/`w2b_`/`w2d_`). `migrations.ts` already spreads them; never touch another group's set.

### Code rules — every WT PR is reviewed against these
1. **Max 400-500 LOC per file.** If a task grows a file past ~400 lines, split it BEFORE opening the PR (domain modules, extracted helpers, sub-components) — same pattern as the WT5 hygiene splits. New files start focused; don't create future monoliths.
2. **Reuse before creating.** Before writing any UI, grep `packages/ui/src/primitives/` (Button, Input, Badge, Tooltip, ScrollArea, Separator) and `renderer/components/common/` (AgentIcon, ConfirmDialog, EmptyState, StatusDot, IssueBubble, LoadingSpinner, ToastStack) — extend an existing component over duplicating one. Same for hooks (`renderer/hooks/`) and main helpers (`main/lib/`): search first, create second.
3. **No new dependencies** without flagging it in the PR description — every dep must survive T144's audit.
4. **React rules** (CLAUDE.md): derive state, TanStack Query for fetching, handlers over effects, `key` resets.
5. **Follow the shared contract** (`agent-signals.ts`) and your migration-set file — never fork shapes or touch another group's set.

### Coordination rules
1. **Merge order**: WT-A's T123+T124 PRs first (they implement the contract); everything else merges in any order after rebasing.
2. **Migrations**: each group appends only to its own `migration-sets/` file (see base above) — zero conflicts by construction.
3. **Shared-file discipline**: `spawn-context.ts` → WT-B only · `spawn-env.ts` → WT-A only · GitPane → WT-C only (T142's PR panel comes later, it's P1-late) · `stores/agents.ts` → WT-A only.
4. **PR hygiene**: one task = one PR, titled `feat(T123): ...`; quality gate (top of file) before each PR; archive the task to `TASK_COMPLETED/2607.md` in the same PR that completes it.
5. **Not in any group** (deliberately deferred, assign after these merge): T142 (GitPane conflicts with WT-C), T144 (dep upgrades last), P2 batch T132-T139.


## Terax Review — Stack Optimizations (Wave 1)

> Source: `docs/RESEARCH/TERAX_STACK_REVIEW.md` (Terax-AI vs Exegol comparison, 2026-05-21).
> All tasks below cite specific Terax files when copying patterns.
> Strategic stance: keep AI-spawned CLI as our core; adopt Terax's tighter implementation patterns.

### T114 — xterm Renderer Pool `added: 2026-04-15`
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

### T122 — Vercel AI SDK + Ollama Support `added: 2026-04-15`
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


---

## Distribution (pending GitHub)

### T45 — CI/CD Release Pipeline `added: 2026-04-15`
**Priority**: P3 — activate when repo goes to GitHub

### T46 — Canary Channel `added: 2026-04-15`
**Priority**: P3

