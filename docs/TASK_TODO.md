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

### Wave 2.6 — Hardening & verification (2026-07-06) — ACTIVE
> **Verificar > construir.** Source: `docs/RESEARCH/CODE_HEALTH_AUDIT_2026_07.md` (Fable audit).
> New features deferred to the next round — this wave hardens what Wave 1+2 built before
> shipping anything on top. Moat thesis re-validated against live market (Conductor $22M,
> Vibe Kanban/Terragon dead, first-party absorption): **Pipelines → Evidence → Undo → Scoring**
> still uncontested — the risk is follow-through, not direction.

**Execution plan decided 2026-08-11 (Antonio + Fable):**
- A1 checklist → **dedicated joint verification session** (Antonio drives, Fable greps/checks)
- T149 + T150 → **parallel claude-code agents in Exegol worktrees** — briefs ready:
  `docs/AGENT_PROMPTS/WT_T149_CORE_TESTS.md` + `WT_T150_T80_PARITY.md` (supervisor reviews, no agent pushes)
- Wave 3 order: **T156 ✅ (PRs #90-#92: fleet home + live peek terminal) → T157 core ✅ (PR #93, pending live verify) → T153**
- Exit criteria met → **release v0.5.0** (tag + changelog)

**P0 — before any new feature:**
1. **Manual verification backlog** — DEFERRED by Antonio 2026-08-11: Wave 3 (T156/T157)
   starts first because using the dashboard + messaging day-to-day exercises these same
   surfaces; checklists get verified opportunistically during Wave 3 sessions
2. ~~T149~~ — ✅ DONE 2026-08-11 (PR #84, `TASK_COMPLETED/2608.md`): 42 tests + REAL BUG fixed (running→running missing — multi-step pipelines stalled after step 0)
3. ~~T150~~ — ✅ DONE 2026-08-11 (PR #85): withRetry wired ×6 via `lib/anthropic.ts`, 65 parity vectors, 9 JS↔Rust divergences fixed

**P1 — after P0:**
4. ~~T151~~ — ✅ DONE 2026-08-11 (`TASK_COMPLETED/2608.md`): zero capability wildcards, keystore warn, Doctor duplicate-CLI + stale-worktree checks
5. ~~T152~~ — ✅ DONE 2026-08-11 (PR #86): workspace.ts 698→77 (slices), index.ts 607→136 (`main/bootstrap/`) — pending live smoke (boot, deep link, layout persist)
6. **T142** — Integrations Hub: GitHub API — **POSTPONED by Antonio 2026-08-11**: v0.5.0 ships without it; pick up after the Wave 3 kickoff decision

**P2 — Post-launch bets (next round):**
**Wave 3 co-headliners: T153 Awareness Engine · T156 Global Sessions Dashboard · T157
Cross-provider Inter-agent Messaging** (T156/T157 answer Claude Code's Aug absorption of
dashboard+messaging — see `RESEARCH/COMPETITIVE_UPDATE_2026_08.md`) ·
**T155 Terminal & Attention UX pack** (7 independently-shippable QoL wins — klaudio review) ·
T133 remote channel (Telegram) — *candidate to elevate: remote continuity is the most visible
gap vs Omnara / Claude web / Codex Remote* · T132 automations catalog · T134 ACP experimental ·
T135 derived status + CDC · T136 tiered merge resolver · T137 hunk assignment + absorb ·
T138 ModeTracker headless · T139 skills security scan · T144 dependency/library audit

> **Docs to review before Wave 3 design** (merged with PR #82, pending review — Antonio 2026-08-11):
> `docs/ARCHITECTURE/COUNCIL_BASE.md` (council mode / structured executions — absorbs the
> standalone council-MCP idea, backs T158/T160) + `docs/ARCHITECTURE/OWL_FLEET_WATCH.md`
> (fleet watch module — backs T156–T159). Reuse when designing T156/T157.

**Wave 2.6 exit criteria (definition of done):**
- [ ] Both manual-verification checklists below fully checked (T123 result recorded either way)
- [x] T149 merged: migration-chain, executor-transition, spawn-lifecycle and MCP-token tests green (PR #84)
- [x] T150 merged: zero unwired T80 code left; parity vectors run in both vitest and cargo test (PR #85)
- [x] T151 + T152 merged: no `"*"` capability wildcards, no file > 500 LOC in the flagged pair (PRs #83/#86)
- [ ] Cut **v0.5.0** when T156 lands + opportunistic checklist passes (T142 postponed; full checklist sweep deferred per Antonio 2026-08-11)

### Shipped waves
- **Wave 2 — Competitive Review (2026-07)**: T123-T131, T88v2, T140, T141, T143, T145-T148
  across WT-A/B/C/D. Details: `docs/TASK_COMPLETED/2607.md`.

- **Wave 1 — Stack Optimizations (Terax review, 2026-05)**: quick wins + WT1-WT5 + T120 settings window.
  Details: `docs/TASK_COMPLETED/2605.md` · `docs/CHANGELOG.md` · analysis `docs/RESEARCH/TERAX_STACK_REVIEW.md`
- Earlier waves (V1-V3, T01-T107): `docs/TASK_COMPLETED/2603.md`, `2604.md`, `docs/ARCHIVED/APPLIED/`

### Manual verification pending (post-merge) `added: 2026-05-22`
Wave 1+2 landed via 5 parallel WTs, T120 on top. Manual smoke-test recommended before broad release:
- OSC 7 cwd badge on shell panes (open shell, `cd /tmp`, verify badge updates)
- OSC 133 prompt boundaries (jump-to-previous-prompt should work)
- Parallel agent comparator (spawn 2-3 agents on same task, verify columns + promote button)
- Isolation badge states (isolated / pipeline / project-root / fallback)
- [x] Stop-reason panel — VERIFIED 2026-07-09 (codex exit: overlay with Completed badge + "New agent with same task" + "View diff")
- CSP changes (open DevTools console, verify zero CSP violations on basic flow)
- Capability allowlist (no functional regression — all routers/IPC still callable from renderer)
- **T120 settings window**: Cmd+, opens standalone; second Cmd+, focuses existing (no duplicate); Cmd+W closes settings only; main close also closes settings; minimize main keeps settings visible; theme change in settings reflects in main without reload

### Manual verification pending — Wave 2 `added: 2026-07-05`
- [x] **T123 deterministic status — VERIFIED 2026-07-09** (live session, Antonio + Fable):
  full cycle observed with real claude-code — `prompt_submit→turn_started/running`,
  `tool_use→working`, `stop→finished/waiting_input`, ~1ms event→signal latency.
  **Delivery finding**: the OSC-777→PTY path does NOT deliver (Claude Code captures hook
  stdout; `/dev/tty` doesn't reach the PTY) — verification uncovered that the hook
  **file-event channel** (`~/.exegol/events` → NotifyHandler) delivers perfectly but was
  wired to a log-only stub; fixed in PR #63 (`dispatchAgentFileEvent` → signal pipeline,
  with OSC-priority guard + terminal-status guard + 6 regression tests). File channel also
  adds `prompt_submit` = turn-START boundary the OSC hook set never had (feeds T129).
  Still pending below: attention signal (needs a permission-prompt scenario).
  Optional follow-up (P3): debug OSC delivery or drop the OSC hooks in favor of file events.
- Desktop notification on agent finished/failed + attention (with pending-question body)
- Attention Inbox: TitleBar queue, Cmd+J jump, unread badges
- Knowledge tab: opt-in setup (no files written on tab open), digest refresh, MEMORY.md sync/import
- [x] Exegol MCP — **VERIFIED 2026-08-11**: shim framing bug found+fixed; claude shows
  `exegol · connected · 3 tools`; live memory_search (empty-correct) → 3× memory_save
  (ids+categories) → retrieval ✅. Pending only: read-mode denial (spawn a read-mode agent,
  memory_save must be refused). **Agent-sourced improvements filed**: (a) add `memory_list`
  tool (recent N) — search-only is awkward for "what do you know?"; (b) multi-word recall
  too literal ("Capacitador proyecto estado stack convex" → empty while single terms hit) —
  likely no-Ollama fallback path; tune FTS OR-semantics / RRF and fold into the min-cosine
  upgrade already queued in T153. **Follow-ups filed**: (a) opencode/other CLIs never see `.mcp.json`
  (claude's convention) — extend exegol-mcp-config to inject opencode's own config
  (`opencode.json` mcp section) + audit codex path; (b) MCP HOST StdioTransport has the
  same LSP-framing bug as the shim had — external stdio servers likely can't connect
- Polish note (verify session): shell/agent exit card duplicates the scrollback tail
  visible right below it — slim the AgentStopReason card (keep actions, drop/collapse tail)
- Pipeline evidence: score badge + AI summary per step, Export Report
- Evaluator gate: template with gate step persists (zod fix), ship/retry routing works
- Oplog v2: Turn Snapshots tab lists per-step snapshots; restore refuses cross-worktree
- Race promote & clean: dirty loser prompts; live-agent loser refuses cleanup
- Onboarding wizard on fresh profile: CLIs detected (packaged build especially — PATH fix)
- Monitor → Resources: eviction actually drops RSS; budget alert fires once per period
- **🐛 FOUND 2026-08-11 (investigate): opencode TUI child dies across app quit** — the
  wrapper shell survives in the sidecar (reattach OK, prompt shows `took 18m48s`) but the
  opencode process exits, printing its `Continue: opencode -s ses_…` message; typing then
  goes to the stale shell over a dead TUI screen. claude-code survives the identical flow.
  Suspect: signal/EOF sensitivity difference in the TUI child when the app disconnects.
  Recovery path exists by design: resume_command is captured (T101) → session browser
  (T155.5) offers the resume. Mitigations shipped in verify session: Refresh Terminal
  (repaint) + Open Terminal (dead panes).

### P3 — Strategic bets / larger scope (post Wave 2)
- **SSH Remote Development** (T73)
- **CI/CD release pipeline** (T45) — activate when repo goes public
- **Canary channel** (T46)
- **Cross-repo workspaces** (T92) — front + back in one workspace (T146 project groups is the cheap precursor)
- **Mobile companion app** (T93) — natural successor of T133 Telegram channel
- **Headless daemon mode** (T94) — prerequisite for T93
- **Panel Plugin SDK** (T97) — extensible panel system, v1.0 architecture (design spike first)
- **Ephemeral validation containers** (T154) — run tests/evaluator checks in disposable Apple `container` VMs (NOT agent isolation)
- **xterm renderer pool** (T114) — re-scoped inside T143: measure after disposal fixes, build only if needed
- **Vercel AI SDK + Ollama** (T122) — value compounds with T130/T147 in-process LLM calls
- **Issue tracker expansion** (T71) — Linear/Jira; plugs into T142 integrations registry
- **T60 project hooks** — ⚠️ mostly superseded by shipped T91 (`.exegol/lifecycle.yaml`); pending delta only: `archive` hook on worktree archival + env vars — review & fold or drop

---

## Active Backlog

### T153 — Project Awareness Engine `added: 2026-07-07`
**Priority**: P2 — **Wave 3 headline candidate** (do NOT start before Wave 2.6 exit criteria) | **Effort**: L (phased) | **Source**: original idea (Antonio) + design analysis 2026-07-07 + **reference implementation studies: `RESEARCH/CODEBASE_MEMORY_MCP_2026_07.md` + `RESEARCH/COCOINDEX_2026_08.md`** (adopt: two-tier mtime/hash freshness, logic fingerprint per collector, model-id in cache keys, ownership-based reconcile, macOS watcher-recreation loop, AST-derived FTS terms, source views for context packs; verdict: patterns yes, crate no) (adopt: index_coverage honesty table, FILE_CHANGES_WITH co-change drift, detect_changes hop-risk, source_hash caching, min-cosine multi-keyword recall; design spike must evaluate shelling out to the tool's CLI vs building file-level indexing in-house)

**Why**
- A lightweight per-project local worker that maintains living code memory, detects small
  health signals, and prepares context for big agents. Directly deepens the uncontested
  moat: **cross-provider shared brain** — Claude/Codex/Gemini/Aider all consume one
  project memory no first-party vendor can replicate. Local-first (code never leaves the
  machine for the awareness layer) = privacy + zero-subscription pitch.
- ~65% of the plumbing already shipped: knowledge node (T140), memory store + salience v2
  (T126), Exegol MCP server (T145), scheduler engine, resource monitor (T143),
  NotificationBus/Attention Inbox (T124/T141). Build as **evolution of
  `.exegol/knowledge/`**, never a parallel `.project-ai/` system.

**Scope — phased (trust is one-shot: 2-3 false positives kill the Health Inbox)**
- **Phase 1 — deterministic signals, NO LLM** (absorbs T132 automations catalog):
  git/fs watcher → stale TODOs (grep + git blame), branches without PR (git + gh), outdated
  deps (manifest parse), doc-mention vs manifest mismatch (e.g. README says Prisma, deps
  have Drizzle), **git co-change coupling** (codebase-memory-mcp formula: 6-month `git log
  --name-only`, skip commits >20 files, ≥3 co-changes, `score = co_count / min(a,b)`,
  threshold 0.3 → "you changed A; B co-changes 78% and wasn't touched"). Watcher = cheap
  adaptive git poll (`rev-parse HEAD` + `status --porcelain`, 5s + 1s/500 files, cap 60s)
  plus our OSC/afterCommit hooks for intra-session reaction. Deliver via NotificationBus →
  **Project Health Inbox** (severity + confidence + mandatory evidence: file/line/fragment).
  Near-100% precision before any model opines.
- **Phase 2 — embedded local model**: per-file memory (purpose, exports, internal deps)
  for changed files only, 1-3 files per cycle → file_index → **context pack** injected at
  agent spawn. Schema (proven by codebase-memory-mcp): `qualified_name` stable key,
  `file_hashes(sha256, mtime_ns, size)` staleness ledger, **`index_coverage` honesty table**
  (rows for partially-indexed files — the pack never pretends completeness), **`source_hash`
  caching** for AI summaries (regenerate only on input-hash mismatch). Micro-task queue with
  budget; pause on high CPU/RAM/battery (resource monitor gates). Modes: Off / Light
  (deterministic only) / Balanced (1.7B) / Deep (4B+). Memory recall side-upgrade:
  **min-cosine multi-keyword** in `memory/store.ts` (all query terms must match, not average).
- **Phase 3 — semantic doc↔code drift** (README says 7-day expiry, sessionConfig uses 30):
  high confidence threshold, always "suggestion" until track record accumulates,
  `needs_human_review` flag.

**MCP integration (key differentiator — extends T145 Exegol MCP server)**
- New tools on the existing token-authenticated socket: `project_context_get` (context
  pack: purpose, modules, key files, open observations, recent changes),
  `health_inbox_list` (open signals), `project_activity_recent` (bridge to `activities`/
  oplog: what agents did recently in this repo)
- Observations feed the memory store (salience/supersession applies); knowledge DIGEST.md
  refresh consumes the file_index
- External agents (any of the 11 CLIs) get the shared brain mid-session, not just at spawn

**Execution architecture (decided 2026-07-07)**
- **Runtime**: llama.cpp `llama-server` binary as an **inference sidecar** (same pattern
  as the PTY sidecar: pid file, health check, on-demand spawn, idle shutdown 5-10 min
  frees RAM). NOT in-process node-llama-cpp (1-2GB weights inside Electron main + another
  napi rebuild dep). Binary ships signed in the .app (~5-10MB/arch).
- **Client**: single OpenAI-compatible abstraction, base-URL configurable — same code path
  for embedded llama-server and optional Ollama upgrade (T122's one-abstraction rule;
  `@ai-sdk/openai-compatible` if T122 lands first)
- **Structured output**: `response_format: json_schema` (GBNF grammar at decode time) —
  small model physically cannot emit invalid JSON; zod-validate on receipt anyway
- **Models** (shortlist verified 2026-07): default **Qwen3 1.7B dense Q4** (~1.2GB,
  Apache 2.0 — bundling-safe license), Deep mode **Qwen3 4B** (~2.5GB); alternates
  Phi-4-mini 3.8B (MIT), Llama 3.2. Optional via Ollama: Qwen3-Coder-Next (80B-A3B).
  Tiny embeddings model (~300MB) for file_index search.
- **Weights install**: app ships WITHOUT weights → opt-in first-activation download
  (versioned manifest, pinned SHA256, resumable, `~/.exegol/models/`) → validate via
  checksum + inference smoke test (schema-valid JSON) → Doctor (T148) check. Engine
  states: `disabled → downloading → validating → ready`; Phase 1 works with no model.

**Hard rules (from the original proposal — keep)**
- Never analyzes the whole repo at once; never modifies code; all output JSON-validated;
  every observation carries evidence; low confidence → suggestion, not alert; budgeted
  execution; per-project off switch.

**Likely files**
- New: `apps/desktop/src/main/awareness/` (watcher, task-queue, micro-tasks, inference
  sidecar client), `resources/bin/llama-server`
- Extend: `mcp/exegol-tools.ts` (+3 tools), `knowledge/*` (file_index consumer),
  `agents/spawn-context.ts` (context pack), `notifications/bus.ts` (health signals),
  `system/doctor.ts` (model check), migrations set (file_index, observations, task queue)

---

### T154 — Ephemeral Validation Containers `added: 2026-07-09`
**Priority**: P3 — strategic bet (post Wave 3) | **Effort**: M-L | **Source**: idea (Antonio) + Apple `container` 1.0.0 (2026-06-09, 30k+ ⭐, WWDC26 "Container machine")

**Why**
- **Scope guard first**: this is NOT Sculptor-style agent-in-container isolation — the
  competitive review explicitly rejected that (worktrees + accessModes cover 90% with 10%
  of the friction; Docker-as-requirement kills onboarding). This is narrower and different:
  **disposable validation sandboxes** — run tests, builds, and evaluator-gate checks away
  from the main machine, in a throwaway environment.
- The timing turned: Apple's native `container` hit 1.0.0 (June 2026) — VM-per-container
  with sub-second boot, OCI images, zero Docker Desktop dependency, Swift/Apple Silicon
  native. The "Container machine" feature (WWDC26) is exactly this use case: build/test a
  project on Linux from macOS with directory mirroring.
- **Killer internal use case**: parallel agents / race mode candidates running test suites
  collide on ports, DBs, and dev servers. A disposable container per validation run removes
  the whole conflict class — and makes evaluator gates (T88v2) stronger: "tests pass in a
  clean room" is better evidence than "tests pass on the dev's hot machine".

**Scope (design spike first)**
- Runtime abstraction: Apple `container` CLI first (macOS 26 + Apple Silicon); detect-and-
  degrade — feature hidden when unavailable; optional adapters later (colima/docker if present)
- Per-project validation profile in `.exegol/lifecycle.yaml` (extends T91): image, setup
  cmds, test cmd, resource caps
- Integration points: evaluator gate step type "run validation container" (T88v2), Smart Git
  Button pre-push check, race-mode comparator column (tests green per candidate), Health
  Inbox signal on red
- Worktree → container mount (readonly bind of the agent's worktree; results out via exit
  code + captured output, stored as pipeline evidence T130)
- Budget/cleanup: hard timeout per run, auto-remove on exit, cap concurrent containers via
  resource monitor (T143)

**Likely files**
- New: `apps/desktop/src/main/validation/` (runtime adapter, profile loader, run manager)
- `main/pipeline/evaluator-step-handler.ts` (gate integration), `lifecycle/loader.ts`
  (profile), `GitPane/SmartGitAction.tsx` (pre-push check), `system/resources.ts` (caps)

---

### T155 — Terminal & Attention UX Pack `added: 2026-07-09`
**Priority**: P2 (post Wave 2.6 — daily-use polish, great filler between waves) | **Effort**: S-M per item, independently shippable | **Source**: `RESEARCH/KLAUDIO_PANELS_2026_07.md` (willywg/klaudio-panels review — its CHANGELOG.md + PRPs/ are ready-made specs with failure modes documented)

**Why**
- klaudio-panels (indie, Claude-only shell) is far behind Exegol on power but ahead on
  daily-use interaction polish. Seven cheap, high-frequency QoL wins, each independently
  shippable — ideal parallel-agent or between-waves work.

**Scope (ranked by value/effort — details + file refs in the research doc)**
1. [x] ~~Drag file → terminal as `@path` mention~~ — **SHIPPED PR #68** (FileExplorer + GitPane
   rows → any PTY; Finder-external drops deferred — needs preload `webUtils.getPathForFile`)
2. [x] ~~Cmd+click file paths + bare URLs~~ — **SHIPPED PR #68** (file → IDE at line via
   `openInIde --goto`; bare URL plain click → external browser, Cmd+click → browser pane;
   + "Open in default browser" button in the browser address bar)
3. [x] ~~Attention → exact-pane routing~~ — **SHIPPED PR #70** (OS-notification click →
   exact pane via jumpToAttentionItem, clear-on-activation on pane mousedown, amber tab
   pulse beats activity dot; + worktree-aware file-link resolution fix for #68)
4. [x] ~~Terminal input QoL~~ — **SHIPPED PR #68** (Shift+Enter newline, Cmd+←/→ home/end,
   Cmd+↓ + amber "new output below" pulse; image paste was already solved better via
   clipboard-to-file; single-SIGWINCH guard deferred — measure first, current resize path
   already coalesces via rAF)
5. [x] ~~Session browser + resume~~ — **SHIPPED PR #72**, upgraded per Antonio: cross-provider
   from our own DB (`agents.listResumable` over T101 resume handles), mixed by date in the
   empty pane, responsive 1/3/5 rows, collapsed by default. Follow-up idea: also import
   Claude sessions born outside Exegol (`~/.claude/projects/*.jsonl`)
6. [x] ~~`exegol .` CLI + deep link~~ — **SHIPPED PR #73** (worktree agent, diff-reviewed):
   protocol + single-instance + delivery queue, deepest-ancestor project match, menu
   install/uninstall. Pending live smoke: real `open` delivery + menu dialogs
7. [x] ~~Notification hygiene~~ — **SHIPPED PR #73**: toast hover-pause (timers moved to
   component), dismiss≠read audited (already correct), per-channel kill switches in the
   bell popover enforced renderer- AND main-side

**T155 COMPLETE (7/7) — 2026-07-10, PRs #68/#70/#72/#73. Archive to TASK_COMPLETED on next sweep.**

**Cross-cutting rules to adopt while in there**
- Focus discipline (their PRP 017): only explicit user action or per-project restore sets
  focus — visibility flips never do
- Per-project panel persistence (width/tab/height keyed by project) + non-destructive
  auto-hide on narrow windows

**Likely files**
- `renderer/components/terminal/{TerminalInstance,TerminalPanel,terminal-setup}.ts*`,
  `renderer/components/workspace/{FileExplorer,GitPane,WorkspaceTabBar}.tsx`,
  `renderer/components/layout/TitleBar.tsx` (bell), `main/notifications/*`,
  `main/index.ts` (deep link), new `resources/bin/exegol` CLI script

---

### T156 — Global Sessions Dashboard `added: 2026-08-11`
**Priority**: P2 — **Wave 3 co-headliner** (with T153/T157; after Wave 2.6 exit criteria) | **Effort**: M | **Source**: idea (Antonio) + `RESEARCH/COMPETITIVE_UPDATE_2026_08.md` (Claude Code "agent view" is the UX benchmark — ours is cross-provider)

**Why**
- One place showing ALL active sessions across ALL projects, project badge per row, even
  across different paths. Claude Code just shipped exactly this (`claude agents` + supervisor
  daemon) — validating the need — but Claude-only. Exegol already has the primitives: the
  agents store accumulates cross-project, `jumpToAttentionItem` does cross-project jump
  (T141), and the attention pending-question tail is already extracted (T124).

**Scope**
- New Monitor sub-tab "Sessions" (or promoted top-level view): every non-terminal agent
  across all projects — project badge (name + group color T146), provider icon, status +
  activity dot, current step, uptime, cost (T147 data), attention state
- **Group-by toggle**: by state (Needs input / Working / Ready-review / Completed-recent)
  vs by project — mirror agent view's Ctrl+S
- **Peek-and-reply** (the killer interaction, copied from agent view): expand a
  needs-input row → show the pending question (attention tail already computed) → inline
  one-line reply sent to the agent's PTY without leaving the dashboard
- Row click → `jumpToAttentionItem` (exact pane, existing)
- Needs: `agents.listActive` query (all projects, join project name/color) — the store
  alone may miss projects never opened this session

**Likely files**
- New: `renderer/components/workspace/sections/SessionsSection.tsx`
- `main/ipc/procedures/agents.ts` (listActive), `WorkspaceTabs` (sub-tab), reuse
  StatusDot/AgentIcon/attention tail

---

### T157 — Cross-provider Inter-agent Messaging `added: 2026-08-11`
**Priority**: P2 — **Wave 3 co-headliner** | **Effort**: M-L | **Source**: idea (Antonio: "hablar entre sesiones DURANTE el chat, no como flujo") + `RESEARCH/COMPETITIVE_UPDATE_2026_08.md` (Claude trust model; herdr gap) + **`RESEARCH/TRINITY_2026_08.md`** (typed human-gate items park-and-end-turn + expiry-as-denial; completion-event wake with triple loop-safety; zero-default agent_permissions checked at MCP layer, parent→child auto-grant)

**Why**
- The inter-agent-comms race is Anthropic (Claude-only, best trust design) vs herdr
  (cross-provider-ish but ZERO identity/trust — receiver can't tell agent from human).
  **Nobody has cross-provider messaging with a real trust model.** Exegol is uniquely
  positioned: MCP server with per-agent tokens (T145) = identity for free; deterministic
  turn boundaries (T123) = safe delivery timing; messages table (T25, orphaned) = storage
  already migrated.

**Scope**
- **MCP tools on the T145 server**: `agents_list` (visible agents + states, scoped by
  accessMode), `agent_send(target, message)` — identity from the caller's token, NEVER
  client-claimed (existing pattern)
- **Delivery at turn boundaries** (Claude's rule, our T123 signals): queue per target;
  inject into the PTY as a formatted prompt when the target hits `waiting_input`/turn end —
  never mid-generation. Idle target → deliver immediately
- **Trust model (copy Anthropic, fix herdr's gap)**: sender attribution in the injected
  text ("[message from agent X — it cannot approve actions]"); inbound policy per agent
  `accept/hold/refuse` with default HOLD for messages from YOLO/bypass agents (human
  approves in Attention Inbox); loop throttling (dedup window + queue cap)
- Persist via T25 `messages` table (types text/request/result already exist) — audit trail
  in the oplog; conversation visible to the human in the agent pane toolbar
- Optional ergonomic (herdr's good idea): `agent_send` with `wait_for: "turn_end"` —
  send-and-wait as one call for scripted coordination
- Human side: "Send to" (existing) grows into a small message composer with target picker

**Likely files**
- `main/mcp/exegol-tools.ts` (+2 tools), `main/agents/agent-session-callbacks.ts` (delivery
  hook on turn boundary), new `main/agents/agent-messaging.ts` (queue + policy + throttle),
  `ipc/procedures/messages.ts` (de-orphan), Attention Inbox (hold approvals)

---

### T160 — Session Alias `added: 2026-08-11`
**Priority**: P2 (prereq-lite for T157 addressing) | **Effort**: S | **Source**: idea (Antonio, verify round 3)

- User-editable alias per agent session ("ClaudeTester") — new nullable `alias` column,
  shown as an editable chip in the terminal toolbar (next to isolation/branch/Chat),
  used in sidebar/attention/session-browser labels, and later as the **addressing name
  for T157 inter-agent messaging** (mirrors Claude cross-session `/rename` and agent-teams
  naming). Sessions get identity, not just windows.

---

### T161 — Resume Picker at Launch `added: 2026-08-11`
**Priority**: P2 | **Effort**: S | **Source**: idea (Antonio, verify round 3)

- When launching a provider from the grid/quick-bar, offer that path's resumable sessions
  (same `agents.listResumable` data as T155.5) inline — "new session" vs "resume one of
  these N" — instead of only surfacing them in the empty pane. Pairs with T160 aliases.

---

### T159 — Provider Registry Round 2 (pi, cursor-agent, copilot) `added: 2026-08-11`
**Priority**: P2 | **Effort**: S | **Source**: engram's 12-provider registry (`RESEARCH/ENGRAM_2026_08.md`) + verified installed on Antonio's machine (`which -a`: pi via homebrew, cursor-agent + copilot via superset)

- Add built-in providers like the agy/devin round (PR #65): inspect each CLI's `--help`
  for prompt-arg/resume flags first, extend `AGENT_CLI_TYPES` + registry entries
- Candidates NOT installed (skip until requested): qwen-code, windsurf
- Pi bonus: `badlogic/pi-mono` is already studied in `_repos_2_learn` (Wave 2 review)

---

### T162 — Agent Links & Rooms `added: 2026-08-12`
**Priority**: P1 (Wave 3 — next after T157 live verify) | **Effort**: M (phased) | **Source**: idea (Antonio 2026-08-12) + `ARCHITECTURE/COUNCIL_BASE.md` (exchange bus) + trinity human-gate patterns + **`RESEARCH/HERDR_2026_08.md` design requirements (2026-08-12): send-and-wait atomic (event cursor captured pre-write), `delivery_not_observed` error distinct from reply timeout, replies KEYED to message id + receiver-session pinning (never satisfied by a state transition or a successor session), reads never clear the human's seen-bit**

**Why**
- "Cuando termines avisale a revisor-api" works today only if the agent remembers to call
  agent_send. A LINK makes Exegol enforce it: deterministic signals (T123) fire the notify
  at the turn boundary even when the model forgets. Rooms generalize it to multi-agent
  feedback (A builds, B+C review) — the council preset from COUNCIL_BASE.md.

**Scope (phased — each useful alone)**
1. ✅ **Directed link — SHIPPED 2026-08-12 (PR #101)**: `agent_link` MCP tool + agent_links
   table (w3_002), fired from the broadcastAgentStatus choke point, one-shot default,
   dies with either endpoint. Roles notify/reviewer/feedback with framing + expects_reply.
   Also shipped: cross-project origin in attribution headers + Settings > MCP Server panel.
   Pending: dashboard link UI (link icon on cards), `once:false` recurring links live-verify.
2. ✅ **Roles** — shipped with phase 1 (framing per role).
3. **Rooms**: N-agent membership; message to room fans out (still one per boundary per
   member); human sees the thread. Build on T25 messages + a room_id column. This is the
   COUNCIL_BASE exchange-bus MVP — do not build the headless council executions yet.

**Likely files**
- `main/agents/agent-messaging.ts` (links + fanout), `mcp/exegol-{protocol,tools}.ts`
  (+agent_link), migration set wave3, dashboard card link UI, Attention/messages UI

---

### T163 — MCP Config Injection: all providers `added: 2026-08-12`
**Priority**: P1 | **Effort**: S-M | **STATUS: core SHIPPED 2026-08-12** (PR #96 stale-shim proxy + PR #97 codex/opencode/gemini injection) — pending live verify + remaining CLIs (aider/goose/amp/kiro/crush/agy/devin per docs)

- Today only claude-code gets `.mcp.json` → only claude agents can use agents_list /
  agent_send / memory tools. Extend `mcp/exegol-mcp-config.ts` per provider:
  codex (`~/.codex/config.toml` mcp_servers, or project `.codex/config.toml` — verify),
  opencode (`opencode.json` mcp section), gemini (`.gemini/settings.json` mcpServers),
  others per docs — each with the same shim command + per-agent token env, written at
  spawn into the agent cwd, removed/revoked on exit. Doctor check: which providers have
  MCP wiring available.
- **agy (Antigravity) MCP = via PLUGINS (discovered 2026-08-12)**: the CLI has `/mcp` in
  the TUI but config only via its plugin system — `agy plugin install <target>` with a
  plugin dir containing `plugin.json` + `mcp_config.json` (standard mcpServers shape;
  binary strings confirm). Plan: ship an "exegol" plugin scaffold (generated under
  ~/.exegol/agy-plugin/) + idempotent `agy plugin install` at spawn; token via
  mcp_config env if agy forwards it (validate live — codex-style sanitization possible,
  shim cwd fallback as plan B). Until then agy is receive-only (PTY injection works).
- **Stale-shim gap (live incident 2026-08-12)**: long-lived CLI sessions keep the shim
  binary spawned at THEIR start — new tools (agent_send) are invisible until the session
  restarts (juanito/paco couldn't message). Fix candidates: shim forwards a server-pushed
  `notifications/tools/list_changed` (needs persistent socket + stdout notification), or
  shim re-fetches tool defs from the server per tools/list instead of its bundled copy
  (cheapest — defs already live server-side). Until then: new MCP tools require agent
  session restart.

---

### T164 — Memory Anchors: memories addressed by the code index `added: 2026-08-12`
**Priority**: P1-P2 (Wave 3 — pairs with T153 Phase 2; anchor table can land before the full engine) | **Effort**: M | **Source**: idea (Antonio: "las memorias serían alrededor del index") + **`RESEARCH/COCOINDEX_2026_08.md`** (full design in § "Hipótesis")

**Why**
- Antonio's hypothesis, validated with inverted framing: the index is the COORDINATE SYSTEM
  memories are addressed in, not where they live. Memories get an address → staleness becomes
  mechanical (drift ≠ supersede) → recall becomes location-aware (file/symbol/call-graph/
  co-change before global RRF) — the concrete way MCP memories "get better".

**Scope (from the research doc — see it for the schema)**
1. `memory_anchor` table (anchor_kind file|symbol|range, symbol_qname, source_hash +
   snippet_fp, confidence explicit|inferred, state fresh|drifted|orphaned|relocated)
2. MCP `memory_save` accepts optional anchor (path + symbol/range resolved server-side
   against extracted declarations — NEVER trust an LLM-freehand qname); infer from
   turn-touched files when absent
3. Anchor verifier runs in the SAME sweep as index updates (two-tier mtime/hash check;
   symbol-level snippet_fp = "someone edited another function → still fresh")
4. `drifted` = recall penalty + context-pack flag; `orphaned` = suppressed, never deleted
5. Location-aware recall in context packs: anchored-to-file → referenced symbols →
   co-change neighbors → global RRF fallback

**Likely files**
- migration set wave3 (memory_anchor), `memory/store.ts` (+anchor-aware recall),
  `mcp/exegol-tools.ts` (memory_save anchor param), T153 worker (verifier), Rust core
  (declaration extractor — see cocoindex `code_ast` as reference impl)

---

### T165 — Messaging stack hardening (simplify follow-ups) `added: 2026-08-12`
**Priority**: P2 | **Effort**: M | **Source**: 4-agent /simplify over T157–T162 (2026-08-12) — correctness landed in PR #102; these are the larger/architectural residuals

- **Lifecycle event emitter**: `broadcastAgentStatus` (a transport fn) still owns delivery + link firing + `getDb()`, forcing the documented import-cycle workaround. Extract an in-main `agent:turn-ended {agentId, reason}` emitter (notifications/bus pattern) that agent-messaging subscribes to once at bootstrap; spawn-env goes back to broadcast+tray.
- **Collapse the 4 per-provider MCP config writers** (exegol-mcp-config.ts) into one descriptor table (path, section, envKey, entry); token-read chain + removeAgentMcpConfig ride the same table. ~120→~50 LOC.
- **Derive the MCP wiring panel from the registry** (procedures/mcp.ts EXEGOL_MCP_PROVIDER_WIRING duplicates flavorForCli + registry names) — `mcpConfigFlavor` on AgentProviderCapabilities; covers custom providers.
- ~~**codex cwd→token 1:1 hardening**~~ — DONE 2026-08-13: a token now binds N agents and identity is resolved per CONNECTION (process tree first, pinned for the socket's life); an unresolvable share returns -32003 instead of guessing. Per-agent token record written for every provider, so reattach re-arms each session with its own credential.
- **SessionAlias window-listener → store**: `renamingAgentId` field in the workspace/agents store instead of N window listeners.
- **mapLinkRow → zod** (agentLinkRowSchema) to match every other table's validated mapping.

---

### T174 — Learnings from Orca (stablyai) `added: 2026-08-13`
**Priority**: P2 | **Effort**: varies | **Source**: 2-agent code read of stablyai/orca, 2026-08-13
(clone at `~/_repos_2_learn/github.com/stablyai/orca`)

Orca is a mature Electron orchestrator (~311k LOC, ~1:1 test ratio). Read for how it solves what
we solve. **It does not use MCP at all** — its agent-facing API is the `orca` CLI, invoked via
Bash. Confirms MCP-vs-CLI is a genuine fork, not a right/wrong; we stay on MCP (schema-validated,
no Bash permission needed), accepting that a provider without MCP can't participate.

Already adopted 2026-08-13: pointer-not-body delivery for long messages, submit on a separate
write, closing the paste on the failure path, boundary-signals-beat-quiescence.

Still worth taking, roughly by value:
- **Fair-share diff truncation** (`src/shared/commit-message-prompt.ts:36-130`): split a diff per
  file, water-fill the byte budget so slack from small files goes to big ones, clip on line
  boundaries with an explicit marker. ~90 lines of pure function; one generated lockfile can no
  longer starve the human-authored changes. Applies to our Haiku commit messages and the T88v2
  judges. **Cheapest high-value item in the list.**
- **Per-provider composer-ready spec** (`src/shared/draft-paste-ready-scanner.ts:26-70`): each TUI
  declares a marker + anchor (codex `›`, opencode `ESC[?25h`, grok `❯` anchored to alt-screen and
  REVOKED on exit because starship uses the same glyph). We took the provider-agnostic half
  (`ESC[?2004h`); the per-provider table is the precise version.
- **One-outstanding-delivery-per-run enforced in DDL** + replay-until-ack — the durable form of
  [[T170]] item 1.
- **Preamble that bans the agent's native ask-user UI**: a worker opening its own TUI prompt hangs
  the coordinator invisibly. Exactly the failure we hit with codex demanding authorization.
- **Never collapse "can't tell" into "dead"** (`src/main/daemon/AGENTS.md`): only a positive signal
  proves occupancy; a timeout proves nothing. Our crash-recovery alive/dead classification is that
  bug class.
- **Symlinked shared directories across worktrees** (one `node_modules` serves all) and background
  worktree deletion — removing a `node_modules` tree synchronously blocked their IPC 8-35s.

---

### T170 — Messaging durability + generalized idempotency `added: 2026-08-13`
**Priority**: P2 | **Effort**: M | **Source**: 4-agent /simplify over the T165/T168 round (2026-08-13)

Three follow-ups the review flagged as right-but-bigger than that commit:

1. **Delivery state belongs in the DB, not a Map.** `messageState`/`idempotency` are
   in-memory, so after an app restart `message_status` answers `unknown` for everything and
   a retry with the same `message_id` re-delivers — precisely when a sender most needs the
   answer. Add `delivered_at` / `state` / `client_key` (+ unique index on
   `(from_agent_id, client_key)`) via a wave migration-set; `getMessageDeliveryState` then
   reads the row, idempotency becomes a unique-constraint lookup, and a startup sweep marks
   still-queued messages undeliverable (correct: the in-memory queue died with the process).
   Reviewers called this the highest value-per-line item.
2. **Generalize idempotency to the RPC layer.** Today only `agent_send` is safely
   retryable, and the retry is performed by the MODEL following prose. The shim already has
   a per-call id — make it stable across reconnects and have the server replay the recorded
   response for a repeated id. Then every tool is retryable and the shim can retry itself.
   Build it when the SECOND tool needs it, not with another bespoke key.
3. **Finish the tokenless-config move.** `EXEGOL_MCP_TOKEN_FILE` + shim env-preference
   already makes per-session identity win wherever the CLI forwards its env. Verify
   empirically per CLI (two opencode sessions in one repo, ~30 min); for every CLI that
   forwards, the file token can be dropped entirely and the multi-binding registry, the
   `ps` walk and the `-32003` ambiguity path all get deleted rather than optimized.

---

### T171 — Human authorization over the agent bus `added: 2026-08-13`
**Priority**: P2 | **Effort**: M | **Source**: live 3-agent session + Juanito's field report (2026-08-13)

[[T168]] fixed the common case (collaboration is pre-authorized, so no permission is needed
to share analysis). This is the remaining half: when a step GENUINELY needs the user, the bus
has no way to carry an authorization the receiver can verify. draco was right to refuse
Juanito's word for it — and stayed blocked until Antonio went to its terminal by hand.

Wanted: an agent can escalate through the channel; the user approves once from Exegol
(NotificationBus + Attention Inbox already exist); the receiver gets an authorization
**signed by Exegol**, never relayed by the requesting agent. Pairs with T169's ownership
question — who may act on which files while several agents coordinate.

---

### T166 — MCP shim architecture (deferred from the 2026-08-12 shim review) `added: 2026-08-12`
**Priority**: P2 | **Effort**: M-L | **Source**: 4-agent shim /simplify — security + correctness landed same day; these are the architectural residuals

- **`hello` handshake on connect** (shim version, agentId, token source, pid): today the
  server logs `shim #7` and cannot tell a returning shim from a stranger, nor a stale one
  from a current one. With it: "3 agents on an outdated shim — restart those sessions"
  becomes a surfaced, actionable state instead of an invisible failure. Also lets the shim
  `report` its own state (outbox depth, outage duration, token source) into the activity
  ring — today the shim is observability-dark (stderr is swallowed by the CLI).
- **Shim as a thin pipe**: forward raw MCP messages (`mcp_message {token, msg}`) so
  initialize/ping/tools-list/tools-call/result-encoding all run in the RUNNING app. What
  stays frozen in a shim then is irreducible: framing, token resolve, reconnect (~60 LOC
  vs ~270). Every future drift stops needing a per-method proxy.
- **Descriptor table for the 4 per-provider config writers + token read chain**
  (~174 → ~55 LOC; adding provider #6 is currently a 4-site hand-synced edit).
- **Drop `EXEGOL_ACCESS_MODE`**: display-only, stale by construction (never rewritten when
  the user changes mode), never delivered to codex; enforcement is 100% server-side.
- **codex cwd→token 1:1**: two codex agents in one cwd still share a token file at runtime
  (the restore/revoke guards close the restart paths, not the live one). Force a unique cwd
  for on-disk-token flavors or refuse the second; persist cwd on the agent row while at it
  (reattach + exit cleanup + pipeline agents all re-derive it today).
- **Socket squat probe**: `connect()` succeeding is treated as "another Exegol owns it" —
  verify `lstat` isSocket + uid, and handshake before trusting; surface "refused to start"
  in the MCP panel instead of one log line.
- **Caps**: NDJSON buffer per connection (a newline-less flood OOMs the main process),
  `memory_save.fact` / `memory_search.query` sizes (agent_send is capped, these aren't).
- **`.gitignore` upsert for written configs** (mirror `ensureDigestGitignored`) — they hold
  a live token and `opencode.json` is a file users legitimately commit.
- Extract `provisionAgentMcp`/`deprovision` out of `buildPtyInvocation` (a command builder
  that writes files, mutates the token registry and starts a socket server).

---

### T172 — Orchestration primitives (from a real coordinated round) `added: 2026-08-13`
**Priority**: P1 | **Effort**: L (split before starting) | **Source**: Juanito's round-2 report,
2026-08-13 — one claude coordinating a codex + an opencode across 3 tasks / 9 files / 0 collisions

Validated first, so we don't undo it: stable identity, `message_id`/`in_reply_to`, and the
pre-authorization clause all held for a full assign → work → report → review → feedback cycle.
The gaps below are what the coordinator had to cover BY HAND.

1. ~~**File reservation**~~ — DONE 2026-08-13: `claim_paths` / `release_paths` / `list_claims`
   over a `path_claims` table. All-or-nothing (a partial grant reads as success and sends the
   agent into the collision it asked us to prevent), directory claims cover their tree, paths
   stored absolute so separate worktrees never conflict, claims released on agent exit, and the
   protocol is in the managed AGENTS.md block so agents know to claim before editing. NOT globs
   — see the module header for why. Ownership across worktrees stays with [[T169]].
2. **Reports are claims, not evidence.** Both agents reported "lint clean, tsc exit 0" and both
   were telling the truth — but the coordinator could only know by re-running everything. The
   bus carries prose only. Note Exegol ALREADY observes the diff (T130 evidence, oplog, scoring):
   the right altitude is Exegol ATTACHING what it verified (files touched, diff hash, exit codes)
   to a message, not a self-reported `artifacts` field the agent fills in.
3. **`status` is too coarse.** `running`/`waiting_input` doesn't say whether an agent is on MY
   task, finished and idle, or off doing something else. Needs task-level state: who assigned
   what, and where it is.
4. **No broadcast / shared session context.** The same isolation rules were written twice, by
   hand, worded differently — a divergence source at 2 agents and a guarantee of it at 6.
   Overlaps [[T162]] phases 2-3 (rooms).
5. ~~**`delivered` is transport, not comprehension**~~ — DONE: `message_status` now reports
   `consumed` once the target closes a turn after the injection.
6. ~~**4000-char cap**~~ — DONE: raised to 12 000.
7. ~~**No retract**~~ — DONE: `message_cancel` withdraws a message still in our queue; it
   refuses honestly once the text has reached the terminal.

**Provider behaviour differs and the orchestrator can't know in advance**: codex demanded explicit
human authorization before sharing repo findings; opencode asked nothing. Document expected
behaviour per provider (registry capability), or a coordinator stalls for no visible reason.

**Remaining**: 2 (attach the diff Exegol already captures — highest value of what's left),
3 (task-level state) and 4 (broadcast / shared session context, overlaps [[T162]]).

---

### T173 — MCP token must not sit in a repo file `added: 2026-08-13`
**Priority**: P1 (security hygiene) | **Effort**: S | **Source**: Juanito, 2026-08-13

`opencode.json` (repo root) carries `EXEGOL_MCP_TOKEN_FILE`; `.mcp.json`, `.gemini/settings.json`,
`.devin/`, `.agents/` are the same shape. The credential is bounded — per session, revoked on
exit, and the server rejects tokens whose agent isn't live — but it should not be committable at
all. Exegol must NOT gitignore these itself: they are legitimate project config a team may want
versioned, and we only insert the `exegol` key. Shipped for now: a warning at spawn when the
file isn't ignored.

Real fix, and it deletes code rather than adding it ([[T170]] item 3): wherever the CLI forwards
its env to MCP servers, the per-session token already arrives via the PTY and the file needs no
secret at all. Verify per provider with TWO sessions of the same provider in one cwd — the
single-session case looks identical either way and proves nothing.

---

### T169 — Worktree coordination model (coordinator + workers) `added: 2026-08-13`
**Priority**: P2 | **Effort**: M | **Source**: Antonio's working pattern, 2026-08-13

Two shapes, both real, and messaging should serve each:
- **One repo, one folder**: the coordinator (e.g. Juanito) holds the main checkout; helpers
  get their own temporary worktrees so parallel edits don't collide, and hand work back as
  commits/PRs the coordinator reviews. Needs: spawn-with-worktree from a link/room, and the
  coordinator being told the branch/PR to review.
- **Front + back (separate folders)**: no worktree needed — the folders already isolate.
  The coordinator's value is sequencing and review, not conflict avoidance. This is the
  cross-project case, so the origin line in the message header matters.

Depends on the T162 link roles (reviewer/feedback) and pairs with T166's per-agent MCP
identity, which is what makes several agents in one cwd viable at all.

---

### T158 — Memory Habit Protocol `added: 2026-08-11`
**Priority**: P1-P2 (small, high-leverage — natural follow-up to the verified MCP loop) | **Effort**: S-M | **Source**: Antonio's question ("que el agente recuerde usar la memoria solo") + `RESEARCH/ENGRAM_2026_08.md` (5-layer habit stack) + `RESEARCH/TRINITY_2026_08.md` (platform_prompt_service: composed runtime-aware protocol-teacher block per spawn — production reference)

**Why**
- The MCP memory loop works (verified 2026-08-11) but agents only use it when told.
  engram proves the fix is environmental: saturate the session with triggers, nudges and
  contracts — no auto-capture, the model does every save, but it never forgets to.

**Scope (adapted to Exegol's architecture — main-process logic, no bash hooks)**
1. **MCP server instructions**: add the PROACTIVE SAVE RULE + search-first triggers to our
   server's instruction surface (shim initialize response / tool descriptions)
2. **Spawn-context protocol block**: trigger list ("user confirms/rejects an approach →
   memory_save"), self-check line, "memory_list at task start", session-summary-before-done
   — appended to the existing memory injection in `buildSpawnContext`
3. **Declarative per-provider instruction registry** (engram agents.go model): canonical
   protocol + per-CLI native rules-file target written as a managed block (reuse T140
   writer) — covers hook-less CLIs (gemini/agy/opencode/devin)
4. **Turn-boundary save nudge**: main process tracks last memory_save per agent; if session
   >5min and no save >15min, inject a one-line reminder at the next Stop signal (T123),
   15-min cooldown debounce
5. Memory store upgrades (can split): `topic_key` upsert slots + save-time conflict
   surfacing with agent-as-judge (`judgment_required` → `memory_judge`, ask-user threshold)

**Likely files**
- `main/mcp/{exegol-protocol,exegol-tools,exegol-mcp-shim-bin}.ts`, `main/agents/spawn-context.ts`,
  `main/agents/agent-session-callbacks.ts` (nudge on Stop), `main/knowledge/managed-block.ts`,
  `main/memory/store.ts` (+migration for topic_key/relations)

---

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


---


### T142 — Integrations Hub: GitHub API first `added: 2026-07-04`
**Priority**: P1 | **Effort**: M | **Source**: original idea (Antonio) + emdash (11 tracker integrations validate demand); extends T71 · **reference implementation study: `RESEARCH/TERRAGON_OSS_2026_07.md`** (github_pr snapshot schema, pure derivation helpers, dirty-check→push refresh, review-comment→fix-agent prompt recipe, one-agent-per-PR debounce, one-line "Fix CI", PR idempotency — plus what NOT to copy: webhooks/App auth; poll with `gh` token + ETag/GraphQL instead)

**Why**
- Today PR state comes from `gh` CLI (Smart Git Button). A token-based GitHub API integration (Integrations section, not GitHub-exclusive) removes the gh dependency and unlocks the real prize: **closing the review loop** — PR review comments flow back into Exegol and can spawn a fix agent.
- Relating PRs ↔ projects ↔ agent runs gives us data no competitor surfaces: which agent's PRs get merged fastest, which get the most review pushback (feeds scoring).

**Scope** (patterns integrated from the terragon-oss study — file refs in the research doc)
- Settings → Integrations section: GitHub token (keystore/safeStorage), scopes documented; `gh` CLI stays as fallback. **Single identity = the user's `gh auth` login** (PR author is the human → CODEOWNERS works); NO GitHub App/webhooks (needs public endpoint)
- PR sync per project: poll + on-focus refresh **with ETag conditional requests or one GraphQL query for PR+reviews+checks** (uncached REST hits the 5k/hr limit on active repos)
- **`github_prs` table** (terragon schema near-verbatim): `repo_full_name + number UNIQUE`, status, base_ref, mergeable_state, checks_status, `agent_id` nullable (creator link never overwritten on upsert), updated_at
- **Pure derivation helpers** ported from terragon `github-api/helpers.ts`: PR status (merged/closed/draft/open), mergeable passthrough, checks aggregation (any pending→pending, any failure→failure, all success/neutral/skipped→success)
- **Dirty-check → push refresh**: fetch → compare 4 fields vs DB → write + `broadcastPRStatus` only on change (sibling of `broadcastAgentStatus`)
- **Review-comment → task → fix agent** (terragon recipe): synthetic ```diff block built from payload only (path, diff_hunk, line/side, "originally at line N"), reply-chain walk to thread root, prompt closes delegating to `gh` CLI; spawn on `pr.head.ref` in a worktree; store `source_metadata {repo, prNumber, commentId}`
- **One-agent-per-PR debounce**: batch key `{repo}:{pr}` with 60s window — N comments feed ONE agent as queued follow-ups, never N agents; reuse existing agent (unarchived first, newest)
- **"Fix CI" one-liner** wired to Smart Git Button failing-checks state: *'Fix the failing GitHub checks. Use `gh pr checks` to get the failures.'* — no CI log plumbing
- **PR idempotency + AI body maintenance**: `pulls.list({state:open, head})` exact head.ref match before create; AI `shouldUpdate` gate; always re-inject task deep-link + issue ref (reuse the Haiku key: `generatePRContent`/`updatePRContent`)
- Optional polish: model override in comment syntax (`@exegol [sonnet] fix this`)
- Architecture: `main/integrations/{registry,github/*}.ts` — registry pattern so Linear/Jira (T71) plug in later

**Likely files**
- New: `apps/desktop/src/main/integrations/*`, migration (pr_links table)
- `apps/desktop/src/main/ipc/procedures/github.ts`, `GitPane.tsx`, `SmartGitAction.tsx`, settings UI

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

## Wave 3 candidate — Owl / Fleet Watch `added: 2026-07-28`

> **Definition**: `docs/ARCHITECTURE/OWL_FLEET_WATCH.md` (agreed 2026-07-28). Owl is a
> NATIVE Exegol feature: background fleet-watch over registered repos, surfacing what
> Antonio has NOT seen/reviewed (attention tracking), consumed by the UI and by external
> Claude sessions via the existing MCP layer. Deferred until Wave 2.6 (hardening) closes.
> Salvage source: `_code_/_archive_/labs-cli-proman`.

### T156 — Owl Phase 1: Collectors + store + raw digest `P2`
**Why**: kills the manual "¿qué no he visto?" scan across active repos; useful with zero LLM.
**Scope**: port cli-proman collector commands (`status`, `git-status`, `wip`, `blocked`,
`review`, `next`...) as deterministic per-repo collectors → facts JSON; scheduler
(interval/on-wake) over registered repos (start: henri ×2, walter ×2, skysset,
dpeluche.dev); store in SQLite with per-item seen/unseen marks; raw digest view in UI.
Owl is read-only toward repos — writes only to its own store.

### T157 — Owl Phase 2: Small-model synthesis via InferenceProvider `P2` (depends: T156, T122)
**Why**: turn facts into notable-or-noise + priority + 1-2 line summaries; seen items go
quiet, unseen insist.
**Scope**: generative small model (start Qwen3 4B; SmolLM3-3B/Gemma 3 4B interchangeable)
through the T122 abstraction with Ollama backend — the LLM only ever sees structured facts,
never raw diffs. Every digest line carries verifiable facts (SHA, PR#, timestamp). Model
bake-off happens here. Note: `nomic-embed-text` stays embeddings-only; this is a second,
generative model on the same runtime.

### T158 — Owl Phase 3: MCP exposure + digest actions `P2` (depends: T157)
**Scope**: `fleet_digest` / `repo_status` / `mark_seen` tools on `main/mcp/registry.ts`;
digest actions: create task, open session, launch review agent (only Exegol can close this
loop). External consumer #1: kickoff resume mode reading the digest instead of re-scanning.
**Runtime requirement**: the MCP server ships in the build and runs as a **headless daemon**
(`exegol watch`, launchd) — shared with T160's council/bus tools. The Electron window is a
view, not the runtime. Definition: `docs/ARCHITECTURE/COUNCIL_BASE.md`.

### T160 — Council base: structured executions + exchange bus `P2` (depends: T158)
**Definition**: `docs/ARCHITECTURE/COUNCIL_BASE.md`. Absorbs the standalone "council MCP"
project — one server, not two. NOT branded "rubber duck": cross-family review is one preset.
**Why**: (a) relay-by-hand between session agents was friction #1 of the jul-2026
conversation audit (henri front↔backend, walter client↔cloud); (b) "define prompt +
structure, get result" executions are what live sessions don't cover.
**Scope**:
- Structured executions: spawn CLIs non-interactively (`claude -p`, `codex exec`, gemini)
  with a prepared prompt/structure, run headless to completion, deliver result to the
  project store. Preset #1: cross-family review of a just-built change (return discrepancies).
- Bus tools on the same MCP server: `thread_create` / `message_post` / `message_list`
  (since-last-read) / `status_update` / `handoff_get`, project-scoped. Content comes from
  agents; the server is only the wire.
- Per-project activity view in UI: new threads · council results · owl updates, with the
  same seen/unseen marks as Owl (one feed, three producers).

### T159 — Embedded inference backend `P3` (depends: T157 proven)
**Why**: Ollama = shared server (contention) + keep_alive unload → multi-second reload each
watcher cycle. Embedded = resident, always warm, app-managed resources.
**Scope**: second `InferenceProvider` backend in-process (node-llama-cpp, or llama.cpp via
existing Rust/napi); GGUF download management; single-flight queue with priorities
(interactive UI > background digest); ~2.5–3 GB RAM budget for 4B Q4. Backend swap must be
config, not rewrite (TERAX rule: ONE abstraction, not 4 cases).

---

## Distribution (pending GitHub)

### T45 — CI/CD Release Pipeline `added: 2026-04-15`
**Priority**: P3 — activate when repo goes to GitHub

### T46 — Canary Channel `added: 2026-04-15`
**Priority**: P3

