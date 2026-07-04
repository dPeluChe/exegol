# Exegol — Task Board

> Audience: current contributors planning the next implementation wave after the initial MVP.
> This board is the active backlog for product differentiation, operational confidence, and release readiness.

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

**P1 additions:**
- **T142** — Integrations Hub: GitHub API (PR sync + review-comment → fix-agent loop)

**P1 — Launch differentiators:**
8. **T129** — Oplog v2: git-tree snapshots per agent turn (GitButler model)
9. **T130** — Pipeline Evidence (Artifacts-style, multi-provider)
10. **T88v2** — Evaluator gate: two-pass judge + score distribution + ship/hold/retry
11. **T131** — Race mode polish (loser cleanup + defer)
12. **T140** — Project Knowledge Node (digest + brief per project)

**P2 — Post-launch bets:**
T132 automations catalog · T133 remote channel (Telegram) · T134 ACP experimental ·
T135 derived status + CDC · T136 tiered merge resolver · T137 hunk assignment + absorb ·
T138 ModeTracker headless · T139 skills security scan · T144 dependency/library audit

### Wave 1 — Stack Optimizations (Terax Review, 2026-05) — ✅ SHIPPED
Strategic context: we stay on **Electron + spawned-CLI agents** (our core differentiator).
Terax (Tauri-based terminal) is more focused than us — adopted their tighter patterns inside our stack. Full analysis: `docs/RESEARCH/TERAX_STACK_REVIEW.md`.

**Shipped (see `docs/tasks_completed/2026_05.md` for details):**
- Quick wins (T108 build opts · T110 streamdown + diff cache · T111 tokenlens · T121 electron-window-state · T103 release config)
- WT1 — Terminal Foundations (T112 OSC 7+133 · T113 PTY flusher hardening · T115 DormantRing) + TerminalInstance split
- WT2 — Security Hardening (T117 path-guard + command-guard · T118 CSP tightening · T119 capability allowlist)
- WT3 — Rust Search Backend (T116 ignore + grep-* + globset + fsSearchRouter)
- WT4 — Parallel Multi-Agent + Agent UX (T65 completion/broadcast · T107 comparator · T105 isolation badge · T106 stop-reason panel) + manager.ts + TerminalPanel splits
- WT5 — Codebase Hygiene Splits (6 monolith files >500 LOC split, pure motion)

**Wave 1.5 (post-merge follow-ups):**
- ✅ **Settings as separate window** (T120, M) — shipped 2026-05-22, see `docs/tasks_completed/2026_05.md`

**Wave 1 deferred to wave 3:**
- **xterm renderer pool** (T114, L) — 5-slot LRU pool with snapshot+replay, blocks N-WebGL-context lag at high tab counts
- **Vercel AI SDK + Ollama** (T122, M, P3) — replace 2 fetch calls in `diff.ts` + `scoring.ts`, unlock Ollama via `@ai-sdk/openai-compatible`

### Manual verification pending (post-merge)
Wave 1+2 landed via 5 parallel WTs, T120 on top. Manual smoke-test recommended before broad release:
- OSC 7 cwd badge on shell panes (open shell, `cd /tmp`, verify badge updates)
- OSC 133 prompt boundaries (jump-to-previous-prompt should work)
- Parallel agent comparator (spawn 2-3 agents on same task, verify columns + promote button)
- Isolation badge states (isolated / pipeline / project-root / fallback)
- Stop-reason panel (let an agent finish/fail, verify overlay with resume/new-task/diff actions)
- CSP changes (open DevTools console, verify zero CSP violations on basic flow)
- Capability allowlist (no functional regression — all routers/IPC still callable from renderer)
- **T120 settings window**: Cmd+, opens standalone; second Cmd+, focuses existing (no duplicate); Cmd+W closes settings only; main close also closes settings; minimize main keeps settings visible; theme change in settings reflects in main without reload

### P0 — Must land before broad release push
- _(empty — all P0 items shipped in wave 1+2)_

### P1 — Differentiators for first users
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

## Wave 2 Backlog — Competitive Review 2026-07

> Source analysis: `docs/RESEARCH/COMPETITIVE_REVIEW_2026_07.md`. Repos studied live in
> `~/dPeluCheData/PROJECTS/dPeluChe/_code_/_repos_2_learn/github.com/`.

### T123 — Agent Status via Hooks + OSC 777
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

### T124 — NotificationBus + Desktop Notifications
**Priority**: P0 | **Effort**: S-M | **Source**: openclaw clones (`nanoclaw/src/delivery.ts`, `nanobot/channels/base.py`) — irreducible pattern: bus + 1-method channel adapters

**Why**
- Table-stakes gap: Warp, Codex app, Orca all notify "agent finished / needs input". Indispensable at 5+ agents.
- Minimal channel interface keeps Telegram/mobile (T133) cheap later.

**Scope**
- `main/notifications/bus.ts`: receives `agent:attention`, `agent:finished`, `pipeline:paused`, `run:failed` (fed by T123)
- Channel interface: `deliver(event, content)` — v1 channel: Electron Notification API + dock badge + optional sound
- Settings: per-event toggles, quiet mode
- Suppress-empty pattern (openclaw `shouldSkipHeartbeatOnlyDelivery`)

**Likely files**
- New: `apps/desktop/src/main/notifications/{bus,channels/desktop}.ts`
- `apps/desktop/src/main/ipc/procedures/settings.ts`, renderer settings UI

---

### T125 — Hybrid Search RRF (FTS5 + Vectors)
**Priority**: P0 | **Effort**: S | **Source**: qmd `src/store.ts` (RRF line 3982, hybridQuery 4731, blend 4957)

**Why**
- `memory/store.ts` uses LIKE while FTS5 sits unused in the schema; Ollama embeddings exist (T100). Connect existing pieces.

**Scope**
- FTS5 query path with column weights `bm25(fts, 1.5, 4.0, 1.0)` (path, title, body)
- RRF fusion: `score += weight / (60 + rank + 1)`; original-query lists ×2.0; top-rank bonus +0.05/+0.02
- Strong-BM25-signal probe → skip expensive vector path when keyword match is decisive
- Apply to memory recall + global search section

**Likely files**
- `apps/desktop/src/main/memory/store.ts`, `apps/desktop/src/main/db/queries/search.ts`

---

### T126 — Memory Salience v2 (Decay + Reinforcement + Supersession)
**Priority**: P0 | **Effort**: S | **Source**: memU `src/memu/vector.py` (salience 25-62), schema `reinforcement_count`

**Why**
- Current 3-factor relevance never decays; stale facts (old build commands) rank forever.

**Scope**
- `salience = similarity × log(reinforcement_count + 1) × exp(-0.693 × days_ago / 30)` (30-day half-life)
- Migration: add `reinforcement_count`, `last_reinforced_at`, `superseded_by` to memories
- Re-observed fact → reinforce instead of duplicate; contradicting fact → new row + mark old `superseded_by` (never overwrite)
- Extractor prompt: anti-ephemeral rules; consider adding `tool`/`behavior` categories (memU's 6)

**Likely files**
- `apps/desktop/src/main/memory/{store,extractor}.ts`, `apps/desktop/src/main/db/migrations`

---

### T127 — Progressive Disclosure Skills
**Priority**: P0 | **Effort**: S-M | **Source**: openclaw `skill-contract.ts` + `local-loader.ts`; nullclaw `skills.zig` (flag `always`)

**Why**
- Today full skill content is injected into agent prompts; grows linearly with skill count.
- openclaw proves the fix works without controlling the agent loop: inject only `<name>+<description>` XML + instruction "use your read tool to load the skill file when the task matches".

**Scope**
- Skills as folders with `SKILL.md` + frontmatter (`name`, `description`, optional `requires.bins`)
- Spawn context injects metadata block only (~100 tokens/skill); full body read on demand by the CLI itself
- Per-skill `always: bool` escape hatch for tiny critical skills

**Likely files**
- `apps/desktop/src/main/skills/{loader,discovery,defaults}.ts`, `apps/desktop/src/main/agents/spawn-context.ts`

---

### T128 — Terminal URL Detector → Browser Pane
**Priority**: P0 | **Effort**: S | **Source**: emdash `terminal-url-detector`

**Scope**
- Detect `https?://localhost:PORT` (and 127.0.0.1) in PTY output stream
- Toolbar chip "Open preview" → opens URL in a browser pane in the same tab
- Dedup per session; ignore URLs inside scrollback replay

**Likely files**
- `apps/desktop/src/main/terminal/*` or sidecar notification path, `TerminalPanel.tsx`, workspace store

---

### T129 — Oplog v2: Git-Tree Snapshots per Agent Turn
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

### T130 — Pipeline Evidence (Verifiable Artifacts per Step)
**Priority**: P1 | **Effort**: M | **Source**: Google Antigravity "Artifacts" (gap: Gemini-only; ours is multi-provider)

**Why**
- No competitor offers verifiable evidence (diff, logs, screenshots) agnostic of the CLI. We already capture diff + scrollback per pipeline step — surface it as a first-class review artifact.

**Scope**
- Per step persist: diff, scrollback tail, score, optional browser-pane screenshot, evaluator verdict
- Evidence panel in pipeline run view: step timeline → click = evidence bundle
- Export run report (markdown) for PR descriptions

**Likely files**
- `apps/desktop/src/main/pipeline/executor.ts`, new `evidence.ts`, `sections/pipeline/*`

---

### T131 — Race Mode Polish (T65 follow-up)
**Priority**: P1 | **Effort**: S | **Source**: runoff (race semantics)

**Scope**
- Auto-cleanup loser worktrees + branches on promote (unless dirty → prompt)
- Defer mode: nothing lands on the main branch until explicit winner selection
- Comparator: "promote & clean" single action

---

### T140 — Project Knowledge Node (digest + brief)
**Priority**: P1 | **Effort**: M | **Source**: original idea (Antonio) + memU `memory_fs/synthesizer.py` (incremental synthesis) + stoneforge (git-tracked state) + Kilo Code "Memory Bank" (closest prior art — validate against it)

**Why**
- No orchestrator offers a per-project living knowledge layer, provider-agnostic. Two complementary halves:
  1. **DIGEST** — structural understanding of the codebase (what exists), auto-refreshed
  2. **BRIEF** — intent (what it does, what it should do, where it's going, decisions)
- The IDE becomes a knowledge node that feeds any agent it spawns — memory is per-fact, this is per-project narrative + structure.

**Scope**
- `.exegol/knowledge/` in each project repo (versionable, travels with the repo):
  - `DIGEST.md` — generated via `trs digest` (external tool, detect binary; fallback: internal summarizer). Staleness tracking: refresh on Smart Git Button commit/push/PR-merge or N commits behind
  - `PROJECT.md` — user-editable brief; agents may propose updates (supersession style, never silent overwrite)
- Injection via spawn-context with progressive disclosure (one metadata line + read-on-demand, same mechanism as T127)
- Pipelines: `{{knowledge}}` template variable
- UI: "Knowledge" sub-tab under Project (edit brief, view digest freshness, force refresh)

**Likely files**
- New: `apps/desktop/src/main/knowledge/{digest,brief,staleness}.ts`
- `apps/desktop/src/main/agents/spawn-context.ts`, `apps/desktop/src/main/pipeline/context.ts`
- New renderer section `sections/KnowledgeSection.tsx`

---

### T141 — Attention Inbox (unread / needs-attention UX)
**Priority**: P0 | **Effort**: S-M | **Source**: Orca (Gmail-like unread/star on worktrees) + superset (ringtone/badge bindings)

**Why**
- With 5+ agents the question is "who needs me now?". We have StatusDot/activity pulse but no unread semantics — attention state is lost when you look away.

**Scope**
- Unread state per agent/tab: set on `finished`/`needsAttention` (from T123), cleared on focus
- Sidebar + tab badges with counts; global "needs attention" queue in TitleBar (click = jump to pane)
- Keyboard: hotkey jumps to next agent needing attention

**Likely files**
- `apps/desktop/src/renderer/stores/agents.ts`, `WorkspaceTabBar.tsx`, `Sidebar.tsx`, `TitleBar.tsx`

---

### T142 — Integrations Hub: GitHub API first
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

### T143 — Resource & Memory Hardening
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

### T144 — Dependency & Library Audit
**Priority**: P2 | **Effort**: S-M | **Source**: internal

**Scope**
- Upgrade pass: Electron 41 → current stable, React 18 → 19 (evaluate: emdash ships 19), xterm/addons, node-pty rebuild chain, Biome, TS
- `spark audit` + `bun pm ls` review: prune unused deps, dedupe, license check pre-open-source
- Bundle budget: initial chunk ≤ 1MB enforced in CI (fonts already lazy — verify), track in BENCHMARKS.md
- Rust: `cargo update` + clippy pedantic re-run; napi + memchr versions

---

### T132 — Automations Catalog
**Priority**: P2 | **Effort**: S-M | **Source**: emdash `builtin-catalog.ts` + openclaw heartbeat/cron delivery

**Scope**
- Template catalog over existing `scheduler/engine`: "daily summary", "scan vulns", "add test coverage", "triage TODOs"
- Each run delivers result via NotificationBus (T124); suppress empty results
- One-click enable from a catalog UI in Project → Tasks

### T133 — Remote Notification Channel (Telegram first)
**Priority**: P2 | **Effort**: M | **Depends**: T124
- Telegram bot channel implementing the same `deliver()` interface; allowlist of chat ids; optional reply→prompt injection later. Validated demand: Orca mobile app, AgentsRoom.

### T134 — ACP Boundary (experimental)
**Priority**: P2 | **Effort**: L | **Source**: emdash `packages/core/src/acp/`, t3code `effect-acp`, Zed ACP
- Agent Client Protocol (JSON-RPC/stdio) for one provider (Claude Code or Gemini) in an experimental pane; structured events instead of PTY scraping; PTY remains default. Evaluate before committing to boundary refactor.

### T135 — Derived Status + CDC change_log
**Priority**: P2 | **Effort**: M | **Source**: ComposioHQ/agent-orchestrator (OBSERVE→UPDATE→DERIVE)
- Persist only durable facts (`activity_state`, `is_terminated`); derive display status read-time by precedence. `change_log` table (SQLite triggers) with seq watermark → renderer reconnects without gaps. Kills stale-status bug class.

### T136 — Tiered Merge Resolver
**Priority**: P2 | **Effort**: M | **Source**: overstory merge queue
- For parallel runs/pipelines: (1) clean merge → (2) keep-incoming → (3) AI-resolve → (4) reimplement-from-spec. Auto-commit runtime state files (`.claude/`, etc.) so they never block merges.

### T137 — Hunk Assignment + Absorb (GitPane)
**Priority**: P2 | **Effort**: M-L | **Source**: GitButler `but-hunk-assignment` + `absorb.rs`
- Stable hunk UUIDs surviving edits → attribute uncommitted hunks to agents/branches; "absorb" redistributes agent fixups to the right commits.

### T138 — ModeTracker Headless
**Priority**: P2 | **Effort**: S | **Source**: superset `terminal-mode-tracker.ts` (VSCode XtermSerializer lineage)
- Per-session headless xterm (scrollback 1) tracking VT modes (kitty keyboard, bracketed paste); reconstruct preamble on reattach — fixes Shift+Enter/paste after reload.

### T139 — Skills Security Scan (pre-import)
**Priority**: P2 | **Effort**: S-M | **Source**: mission-control Skills Hub scanner
- Pattern gate before installing external skills/MCP configs: prompt-injection, credential exfil, dangerous shell, obfuscation. Blocks write-to-disk on match; user override with warning.

---

## Execution Lanes for Parallel Work

Use these lanes only if multiple agents are working concurrently. The goal is disjoint write sets.

### Wave 2 lanes (recommended split for parallel agents)

| Lane | Tasks | Owned write set | Notes |
|---|---|---|---|
| **W2-A Signal Core** | T123 | `packages/core-rust/src/processing/*`, `main/agents/{spawn-env,spawn-context,status-parser,manager}.ts` | Land FIRST or in parallel with contract agreed: event names `agent:attention/finished`, turn timestamps |
| **W2-B Notifications + Inbox** | T124, T141 | new `main/notifications/*`, `renderer/stores/agents.ts`, `WorkspaceTabBar/Sidebar/TitleBar` | Consumes W2-A events; can build against a mock emitter |
| **W2-C Knowledge & Memory** | T125, T126, T140 | `main/memory/*`, new `main/knowledge/*`, `db/queries/search.ts`, migrations, `KnowledgeSection.tsx` | Self-contained; migration numbering coordinate with W2-D |
| **W2-D Skills** | T127, T139 | `main/skills/*` | Touches `spawn-context.ts` — coordinate one-line injection point with W2-A |
| **W2-E Git/Oplog** | T129, T131 | `packages/core-rust/src/git/*`, `main/ipc/procedures/git.ts`, GitPane oplog UI | Consumes turn boundaries from W2-A (can stub) |
| **W2-F Pipelines** | T88v2, T130 | `main/pipeline/*`, `sections/pipeline/*`, `packages/shared/src/types/pipeline.ts` | Independent of the rest |
| **W2-G UX quick wins** | T128 | terminal toolbar, sidecar URL scan | Small, safe anywhere |
| **W2-H Integrations** | T142 | new `main/integrations/*`, `procedures/github.ts`, GitPane PR panel | Coordinate GitPane touches with W2-E |
| **W2-I Resources** | T143, T144 | `system/resources.ts`, `TerminalInstance.tsx`, sidecar ring buffer, package.json | Dep upgrades (T144) LAST — after other lanes merge, to avoid rebase pain |

Merge order suggestion: W2-A → (W2-B, W2-E) → rest in any order. W2-C/D/F/G/H can merge anytime; W2-I's T144 goes last.

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

## Terax Review — Stack Optimizations (Wave 1)

> Source: `docs/RESEARCH/TERAX_STACK_REVIEW.md` (Terax-AI vs Exegol comparison, 2026-05-21).
> All tasks below cite specific Terax files when copying patterns.
> Strategic stance: keep AI-spawned CLI as our core; adopt Terax's tighter implementation patterns.

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

### Next wave — Wave 2 P0 (pre-launch)
1. **T123** — Hooks + OSC status (unblocks the wave)
2. **T124** + **T141** — NotificationBus + Attention Inbox
3. **T125** + **T126** — Hybrid search RRF + salience v2
4. **T127** — Progressive disclosure skills
5. **T128** — URL detector

### Wave 2 P1 (launch headline)
6. **T129** — Oplog v2 (per-turn snapshots)
7. **T130** + **T88v2** — Pipeline Evidence + statistical evaluator gate
8. **T131** — Race polish · **T140** — Project Knowledge Node

### Stabilization & quality (P2)
- T81 — Dependency Injection for Singletons
- Wave 2 P2: T132-T139 (see Priority Order)

### Strategic backlog (P3)
- **T90** — Terminal ↔ Chat dual view
- **T92** — Cross-repo workspaces
- **T93** — Mobile companion app (validated: Orca shipped one — real demand)
- **T94** — Headless daemon mode
- **T97** — Panel Plugin SDK (v1.0 architecture — design spike first)

---

## Distribution (pending GitHub)

### T45 — CI/CD Release Pipeline
**Priority**: P3 — activate when repo goes to GitHub

### T46 — Canary Channel
**Priority**: P3

