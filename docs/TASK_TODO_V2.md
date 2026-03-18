# Exegol — Task Board V2 (Agent-Ready)

> 18 tasks across 5 agent clusters. Each agent works in isolation (worktree).
> Each task includes **which repo to study** and **which files to read** before implementing.
>
> **GHQ root**: `/Users/peluche/dPeluCheData/PROJECTS/dPeluChe/_code_/_repos_2_learn`
>
> **Quality gate before PR**:
> - `npx @biomejs/biome check --fix apps/ packages/shared/src/ packages/ui/src/`
> - `npx tsc --noEmit -p apps/desktop/tsconfig.node.json && npx tsc --noEmit -p apps/desktop/tsconfig.web.json`
> - Max 400-500 LOC per file
> - Log work in `docs/tasks_completed/2026_03.md`
>
> **Agent workflow**: Study repo → Read specific files → Implement in Exegol → Document in `docs/applied/`

---

## Inspiration Registry

| Repo | ghq path | Key Patterns |
|------|----------|-------------|
| **Pi** | `github.com/badlogic/pi-mono` | 3-tier arch, RPC, extensions, session tree branching |
| **Stoneforge** | `github.com/stoneforge-ai/stoneforge` | Worktree isolation, dependency dispatch, merge steward, handoff |
| **ComposioHQ** | `github.com/ComposioHQ/agent-orchestrator` | 8-slot plugin arch, CI auto-fix, multi-agent adapters |
| **Overstory** | `github.com/jayminwest/overstory` | SQLite typed mail, 4-tier merge queue, watchdog |
| **GitButler** | `github.com/gitbutlerapp/gitbutler` | Rust git crates, virtual branches, oplog/undo |
| **Tabby** | `github.com/Eugeny/tabby` | Recovery tokens, SerializeAddon, plugin system, split tree |
| **QMD** | `github.com/tobi/qmd` | FTS5 + sqlite-vec, MCP server, dynamic instructions |
| **TunaCode** | `github.com/alchemiststudiosDOTai/tunacode` | Hash editing, compaction prompts, ToolRetryError |
| **Mission Control** | `github.com/builderz-labs/mission-control` | 26 panels, SSE, useSmartPoll, task board, token costs |
| **DeerFlow** | `github.com/bytedance/deer-flow` | Middleware chain, sub-agent delegation, skills, memory |
| **memU** | `github.com/NevaMind-AI/memU` | 3-layer memory hierarchy, dual retrieval, workflow pipelines |
| **ClawWork** | `github.com/HKUDS/ClawWork` | Economic accountability, quality scoring, multi-model arena |
| **Nanobot** | `github.com/HKUDS/nanobot` | ProviderSpec registry, message bus, tool registry, memory |
| **Uptime Kuma** | `github.com/louislam/uptime-kuma` | Push metrics, notification providers, monitoring dashboard |
| **Huly** | `github.com/hcengineering/platform` | Plugin triple, kanban as package, event-driven decoupling |
| **Zed** | `github.com/zed-industries/zed` | Agent-as-pane, MCP extension, tool permissions, terminal links |
| **IronClaw** | `github.com/nearai/ironclaw` | Rust WASM sandbox, pgvector search |
| **TinyClaw** | `github.com/warengonzaga/tinyclaw` | 4-layer compaction, episodic memory, plugin system |

---

## Agent 1 — Real-Time & Dashboards

> **Domain**: Push events, resource metrics, token costs, activity feed
> **Touches**: `main/system/`, `main/ipc/`, `renderer/.../ResourcesSection.tsx`, `renderer/.../TokensSection.tsx`, new ActivitySection
> **No conflicts with**: Agents 2, 3, 4, 5

### T17 — Push-First Agent Status Updates
**Complexity**: Medium
**Study before implementing**:
- Uptime Kuma: `server/server.js` → WebSocket push pattern (Socket.io emit on status change)
- Mission Control: `src/lib/use-server-events.ts` (190 lines) → SSE + Zustand integration
- Mission Control: `src/lib/use-smart-poll.ts` (145 lines) → visibility-aware polling

**What to implement**: Replace tRPC polling for agent status with IPC event push. Main process emits `agent:status-changed`; renderer subscribes via Zustand.
**Files**: `main/agents/manager.ts`, `main/index.ts`, `preload/index.ts`, `renderer/stores/agents.ts`, `renderer/contexts/ProjectContext.tsx`
**Acceptance**:
- [ ] AgentManager emits IPC event on status change (spawning→running→completed/stopped)
- [ ] Renderer subscribes via `window.api.onAgentStatus(callback)`
- [ ] Remove polling interval for agent list refresh
- [ ] Fallback: tRPC query on mount for initial hydration
- [ ] Document: `docs/applied/T17_push_status.md`

### T18 — Resources Dashboard (Real Metrics UI)
**Complexity**: Medium
**Study before implementing**:
- Uptime Kuma: `src/pages/DashboardHome.vue` → dashboard layout, status indicators, charts
- Mission Control: `src/components/panels/agent-squad-panel-phase3.tsx` → per-agent metrics grid
- Mission Control: `src/store/index.ts` → Zustand store with `subscribeWithSelector`

**What to implement**: Replace placeholder ResourcesSection with real dashboard: CPU/RAM/disk charts, per-agent process metrics, threshold alerts.
**Files**: `renderer/.../ResourcesSection.tsx` (rewrite), `main/system/resources.ts`, `ipc/procedures/resources.ts`
**Acceptance**:
- [ ] System overview: CPU %, RAM used/total, disk used/total with progress bars
- [ ] Per-agent process table: PID, CPU %, RAM MB, uptime
- [ ] Mini sparkline chart (last 30 data points) for CPU and RAM
- [ ] Threshold indicators: yellow >70%, red >90%
- [ ] Push metrics via IPC event (reuse T17 pattern)
- [ ] Document: `docs/applied/T18_resources_dashboard.md`

### T19 — Token Usage Dashboard (Cost Tracking)
**Complexity**: Medium
**Study before implementing**:
- Mission Control: `src/components/panels/token-dashboard-panel.tsx` → per-model breakdown, cost trends
- ClawWork: `src/components/dashboard/` → economic metrics, quality scores, balance charts
- ClawWork: `src/api/` → token cost calculation logic

**What to implement**: Replace placeholder TokensSection with cost dashboard: per-model breakdown, per-agent costs, trends.
**Files**: `renderer/.../TokensSection.tsx` (rewrite), `ipc/procedures/token-usage.ts`, `main/db/queries/token-usage.ts`
**Acceptance**:
- [ ] Per-model token breakdown (input/output/cache) with costs
- [ ] Per-agent cost table (total tokens, total cost, avg cost per session)
- [ ] 30-day trend chart (lightweight — consider recharts or inline SVG sparklines)
- [ ] Dynamic model catalog with pricing (DB-backed, not hardcoded)
- [ ] Session cost visible in sidebar agent cards
- [ ] Document: `docs/applied/T19_token_dashboard.md`

### T20 — Activity Feed
**Complexity**: Medium
**Study before implementing**:
- Mission Control: `src/components/panels/activity-feed-panel.tsx` → timeline with type icons
- Mission Control: `src/lib/use-server-events.ts` → SSE event dispatch to Zustand
- Uptime Kuma: heartbeat/notification patterns

**What to implement**: Timeline of system events. New workspace tab "Activity".
**Files**: New `renderer/.../ActivitySection.tsx`, new `main/db/queries/activities.ts`, new DB migration, new `ipc/procedures/activities.ts`
**Acceptance**:
- [ ] Activities table: (id, type, entity_type, entity_id, description, created_at)
- [ ] Log events: agent_spawned, agent_stopped, agent_completed, agent_failed, scheduler_fired, port_detected
- [ ] UI: scrollable timeline with type icons and relative timestamps
- [ ] Filter by event type
- [ ] New workspace tab: "Activity"
- [ ] Document: `docs/applied/T20_activity_feed.md`

---

## Agent 2 — Terminal, Session & Search

> **Domain**: Terminal persistence, tab recovery, full-text search
> **Touches**: `renderer/components/terminal/`, `renderer/stores/workspace.ts`, new search system
> **No conflicts with**: Agents 1, 3, 4, 5

### T21 — Terminal SerializeAddon for Buffer Persistence
**Complexity**: Low
**Study before implementing**:
- Tabby: `tabby-terminal/src/frontends/xtermFrontend.ts` → SerializeAddon usage for state capture
- Tabby: `tabby-core/src/services/tabRecovery.service.ts` → recovery token pattern

**What to implement**: Replace raw scrollback file persistence with xterm SerializeAddon.
**Files**: `renderer/components/terminal/TerminalInstance.tsx`, `renderer/components/terminal/TerminalPanel.tsx`, `main/agents/manager.ts`
**Acceptance**:
- [ ] Add `@xterm/addon-serialize` to TerminalInstance
- [ ] Store serialized state (not raw text) in scrollback files
- [ ] Stopped agents restore full terminal state (colors, formatting intact)
- [ ] Fallback: raw text if serialize fails
- [ ] Document: `docs/applied/T21_serialize_addon.md`

### T22 — Tab Recovery Tokens
**Complexity**: Medium
**Study before implementing**:
- Tabby: `tabby-core/src/api/baseTabComponent.ts` → `getRecoveryToken()` interface
- Tabby: `tabby-core/src/services/tabRecovery.service.ts` → `TabRecoveryProvider` pattern
- Tabby: `tabby-terminal/src/recoveryProvider.ts` → concrete recovery for terminal tabs

**What to implement**: Each pane emits a recovery token; on restart, tokens reconstruct workspace.
**Files**: `renderer/stores/workspace.ts`, `renderer/components/workspace/WorkspacePane.tsx`, `renderer/components/workspace/WorkspaceLayout.tsx`
**Acceptance**:
- [ ] Each pane type implements `getRecoveryToken(): RecoveryToken`
- [ ] RecoveryToken: { type, agentId?, filePath?, url?, metadata? }
- [ ] On startup: workspace store reconstructs panes from tokens
- [ ] Graceful handling: deleted agents, missing files, unreachable URLs → show empty pane with message
- [ ] Document: `docs/applied/T22_recovery_tokens.md`

### T23 — Project-Wide Full-Text Search
**Complexity**: High
**Study before implementing**:
- QMD: `src/db.ts` → FTS5 virtual table creation, BM25 scoring, porter stemmer
- QMD: `src/search/lexical.ts` → full-text search queries with ranking
- QMD: `src/chunking/` → smart content chunking for indexing
- memU: `memu/storage/` → dual retrieval patterns (fast keyword + deep semantic)

**What to implement**: FTS5 index in libSQL for agent transcripts, prompts, task descriptions.
**Files**: New `main/db/queries/search.ts`, new DB migration (FTS5 virtual table), new `ipc/procedures/search.ts`, new `renderer/.../SearchSection.tsx`
**Acceptance**:
- [ ] FTS5 virtual table indexing: agent scrollback, prompts, task descriptions, scheduler results
- [ ] Index updated on agent completion (scrollback → FTS5)
- [ ] Search UI: query input, results with highlighted matches, click to navigate
- [ ] New workspace tab: "Search"
- [ ] Snippet extraction with context (20 chars before/after match)
- [ ] Document: `docs/applied/T23_fulltext_search.md`

---

## Agent 3 — Orchestration & Communication

> **Domain**: Provider registry, inter-agent messaging, scheduler upgrades, handoff
> **Touches**: `main/agents/`, `main/scheduler/`, new messaging system
> **No conflicts with**: Agents 1, 2, 4, 5

### T24 — Agent Provider Registry
**Complexity**: Medium
**Study before implementing**:
- Nanobot: `nanobot/providers/registry.py` → ProviderSpec dataclass, single source of truth
- ComposioHQ: look for plugin/adapter architecture → 8-slot plugin system
- Nanobot: `nanobot/config/schema.py` → Pydantic-driven config for 20+ providers

**What to implement**: Replace hardcoded CLI_NAMES with dynamic provider registry.
**Files**: New `main/agents/registry.ts`, `main/agents/manager.ts` (refactor spawn), `renderer/components/agents/AgentLauncher.tsx`, `shared/src/types/agent.ts`
**Acceptance**:
- [ ] `AgentProvider` type: { id, name, command, argsTemplate, icon, color, capabilities }
- [ ] Capabilities: { supportsWorktree, supportsResume, supportsRPC, supportsVision }
- [ ] Default providers: claude, codex, aider, gemini, goose
- [ ] Custom providers via Settings (CLI path + args pattern)
- [ ] AgentLauncher reads from registry (not hardcoded list)
- [ ] Document: `docs/applied/T24_provider_registry.md`

### T25 — Inter-Agent Messaging (SQLite Mail)
**Complexity**: High
**Study before implementing**:
- Overstory: look for `mail` or `message` system → SQLite mail with 8 typed message protocols
- Stoneforge: look for `channels/` or `messaging/` → persistent channels with threading
- Mission Control: `src/components/panels/chat-panel.tsx` → agent chat UI
- Mission Control: `src/app/api/chat/` → chat API routes + message types

**What to implement**: Typed messages between agents via SQLite. Enables coordination.
**Files**: New `main/db/queries/messages.ts`, new DB migration, new `ipc/procedures/messages.ts`, new `renderer/.../MessagesSection.tsx`
**Acceptance**:
- [ ] Messages table: (id, from_agent_id, to_agent_id, type, content, created_at, read_at)
- [ ] Types: text, handoff, status, request, result
- [ ] tRPC: sendMessage, getMessages, markRead
- [ ] UI: message panel per agent in workspace
- [ ] Handoff message: agent A completes → context summary sent to agent B
- [ ] Document: `docs/applied/T25_agent_messaging.md`

### T26 — Dependency-Aware Scheduler
**Complexity**: High
**Study before implementing**:
- Stoneforge: look for `dispatch/` or `daemon/` → 7-phase dispatch loop, dependency graph walking
- DeerFlow: `backend/src/subagents/executor.py` → concurrency limits, parallel execution
- Stoneforge: look for task dependency schema + resolution logic

**What to implement**: Tasks declare dependencies. Dispatcher resolves graph before spawning.
**Files**: `main/scheduler/engine.ts` (refactor), `main/db/queries/scheduler.ts`, new DB migration, `renderer/.../SchedulerSection.tsx`
**Acceptance**:
- [ ] Scheduled tasks have optional `depends_on` (array of task IDs)
- [ ] Dispatcher resolves dependency graph before spawning
- [ ] Blocked tasks show "waiting on: [task names]" in UI
- [ ] Concurrency limit: max N agents per project (configurable)
- [ ] Cycle detection prevents circular dependencies
- [ ] Document: `docs/applied/T26_dependency_scheduler.md`

### T27 — Context Handoff on Token Limit
**Complexity**: Medium
**Study before implementing**:
- Stoneforge: look for `handoff` or `context-window` → commit + handoff notes pattern
- DeerFlow: `backend/src/agents/lead_agent/middlewares/summarization.py` → context compaction
- TunaCode: `src/tunacode/compaction/` → structured summaries (Goal, Progress, Files, Next Steps)

**What to implement**: Detect token limits, generate handoff summary, offer successor spawn.
**Files**: `main/agents/manager.ts`, `main/agents/status-parser.ts`, new `main/agents/handoff.ts`, `renderer/components/terminal/TerminalPanel.tsx`
**Acceptance**:
- [ ] Detect token limit warnings in stdout (Claude: "context window", Aider: "token limit")
- [ ] Generate handoff: current task, progress, files modified, next steps
- [ ] Store handoff in DB (linked to agent)
- [ ] UI: "Continue with new agent" button → spawns successor with handoff injected
- [ ] Handoff visible in agent detail view
- [ ] Document: `docs/applied/T27_context_handoff.md`

---

## Agent 4 — Git Ops (Rust) & Quality

> **Domain**: Rust-native git operations, oplog/undo, agent quality scoring
> **Touches**: `packages/core-rust/`, `main/ipc/procedures/diff.ts`, new oplog, agent scoring
> **No conflicts with**: Agents 1, 2, 3, 5

### T28 — Rust-Native Diff Generation
**Complexity**: Medium
**Study before implementing**:
- GitButler: `crates/but-status/` → change tracking/diff in Rust
- GitButler: `crates/gitbutler-diff/` → diff computation patterns
- GitButler: `crates/but-workspace/` → workspace state management via git2

**What to implement**: Replace `execFileAsync('git', ['diff'])` with Rust git2 diff.
**Files**: `packages/core-rust/src/git/mod.rs` (new diff fns), `main/ipc/procedures/diff.ts` (call Rust)
**Acceptance**:
- [ ] Rust fn: `get_diff(repo_path, staged: bool) -> Vec<FileDiff>`
- [ ] FileDiff: { path, hunks: Vec<Hunk>, binary: bool, status: Added/Modified/Deleted }
- [ ] Hunk: { old_start, old_lines, new_start, new_lines, lines: Vec<DiffLine> }
- [ ] tRPC procedures call Rust (napi-rs) instead of `git diff`
- [ ] Performance: <50ms for typical project diffs
- [ ] Document: `docs/applied/T28_rust_diff.md`

### T29 — Oplog / Undo Timeline
**Complexity**: High
**Study before implementing**:
- GitButler: `crates/but-oplog/` → operations log, snapshot management
- GitButler: `crates/gitbutler-oplog/` → undo/redo via ref tracking
- Pi: session tree with id/parentId → branching navigation pattern

**What to implement**: Track all agent git operations. Enable undo of any action.
**Files**: New `packages/core-rust/src/git/oplog.rs`, new DB migration, new `ipc/procedures/oplog.ts`, new `renderer/.../OplogSection.tsx`
**Acceptance**:
- [ ] Oplog table: (id, agent_id, operation, ref_before, ref_after, timestamp)
- [ ] Operations: commit, branch_create, worktree_create, file_write
- [ ] Undo: reverts to ref_before (creates new commit, never force-push)
- [ ] UI: timeline of agent git actions with undo buttons
- [ ] New workspace tab or section in Diff Viewer
- [ ] Document: `docs/applied/T29_oplog_undo.md`

### T33 — Quality Scoring for Agent Output
**Complexity**: Medium
**Study before implementing**:
- ClawWork: `src/api/` → quality scoring logic (GPT-evaluated)
- ClawWork: `src/components/dashboard/` → performance metrics display
- Mission Control: `src/components/panels/` → quality review gates pattern

**What to implement**: Score agent outcomes. Track performance over time.
**Files**: New `main/agents/scoring.ts`, `main/agents/manager.ts`, new DB migration (score columns), `renderer/.../TokensSection.tsx` or new panel
**Acceptance**:
- [ ] Score dimensions: files_changed, compiles, tests_pass, task_completed (all bool)
- [ ] Auto-detect: parse stdout for compile errors, test results, completion signals
- [ ] Store score per agent session in DB
- [ ] Performance dashboard: success rate by CLI type, by project, over time
- [ ] Feed scores into future memory system (T32)
- [ ] Document: `docs/applied/T33_quality_scoring.md`

---

## Agent 5 — MCP, Skills & Memory

> **Domain**: MCP host, skill system with sharing, agent memory
> **Touches**: new `main/mcp/`, new `main/skills/`, new `main/memory/`
> **No conflicts with**: Agents 1, 2, 3, 4

### T30 — MCP Host (Tool Proxy)
**Complexity**: High
**Study before implementing**:
- QMD: `src/mcp/` → MCP server implementation (stdio + HTTP transports)
- QMD: `src/mcp/instructions.ts` → dynamic instructions from index state
- Zed: search for MCP-related code → MCP as extension point pattern
- Nanobot: look for `mcp` directory → MCP tool discovery at startup

**What to implement**: Exegol connects to MCP servers, discovers tools, proxies to agents.
**Files**: New `main/mcp/host.ts`, new `main/mcp/registry.ts`, `main/agents/manager.ts` (inject MCP context), settings UI
**Acceptance**:
- [ ] MCP client: connect to stdio and HTTP MCP servers
- [ ] Tool discovery: list available tools from connected servers
- [ ] Tool proxy: route agent MCP requests to correct server
- [ ] Settings: add/remove MCP servers (name, transport, command/url)
- [ ] Dynamic instructions: build context string from available tools for agent prompt
- [ ] Document: `docs/applied/T30_mcp_host.md`

### T31 — Skills System (Markdown-Based, with Sharing)
**Complexity**: Medium
**Study before implementing**:
- Pi: `packages/coding-agent/src/core/resource-loader.ts` → skill discovery (SKILL.md, dual-tier: project + user global)
- Pi: `packages/coding-agent/src/core/skills.ts` → skill loading, name validation, collision handling
- DeerFlow: `backend/src/skills/` → public/custom dirs, enabled/disabled toggle, SKILL.md with YAML frontmatter
- Nanobot: `nanobot/skills/` → requirement checking (requires.bins, requires.env), always-load flag
- Mission Control: look for skill install/registry → federated registry pattern, security scanning

**What to implement**: Reusable workflow definitions. Dual-tier (project + global). Shared across projects via global dir.
**Files**: New `main/skills/loader.ts`, new `main/skills/discovery.ts`, `main/agents/manager.ts`, new settings, new `renderer/.../SkillsSection.tsx`
**Acceptance**:
- [ ] Format: markdown with YAML frontmatter (name, description, category, requires)
- [ ] Discovery: project-local (`.exegol/skills/`) + global (`~/.exegol/skills/`)
- [ ] Sharing: global skills available to ALL projects; project skills override global by name
- [ ] Enable/disable toggle per project (stored in DB)
- [ ] Requirement checking: skip skills with unmet CLIs or env vars
- [ ] Spawn dialog: select skills to inject into agent context
- [ ] Skills browser: list, preview, toggle, requirement status
- [ ] New workspace tab: "Skills"
- [ ] Document: `docs/applied/T31_skills_system.md`

### T32 — Agent Memory System
**Complexity**: High
**Study before implementing**:
- memU: `memu/core/memory.py` → 3-layer hierarchy (resource → item → category)
- memU: `memu/core/retrieval.py` → dual retrieval (RAG fast + LLM deep)
- DeerFlow: `backend/src/agents/memory/` → async extraction + system prompt injection
- Nanobot: `nanobot/agent/memory.py` → two-layer memory (MEMORY.md + HISTORY.md)
- TinyClaw: look for memory system → episodic memory with temporal decay

**What to implement**: Extract knowledge from agent sessions. Inject into future spawns.
**Files**: New `main/memory/extractor.ts`, new `main/memory/store.ts`, new DB migration, `main/agents/manager.ts`
**Acceptance**:
- [ ] Memory table: (id, project_id, category, content, source_agent_id, created_at, relevance_score)
- [ ] Categories: preference, pattern, error, solution, dependency, convention
- [ ] Extraction: on agent completion, parse scrollback for extractable knowledge
- [ ] Injection: on spawn, retrieve top-N relevant memories → inject into prompt
- [ ] UI: memory browser in workspace (list, search, delete)
- [ ] New workspace tab: "Memory"
- [ ] Document: `docs/applied/T32_agent_memory.md`

---

## Cluster Summary

| Agent | Tasks | Repos to Study | Quick Wins | Heavy Lifts |
|-------|-------|----------------|------------|-------------|
| **1 — Dashboards** | T17, T18, T19, T20 | Mission Control, Uptime Kuma, ClawWork | T17 | T20 |
| **2 — Terminal & Search** | T21, T22, T23 | Tabby, QMD, memU | T21 | T23 |
| **3 — Orchestration** | T24, T25, T26, T27 | Nanobot, Overstory, Stoneforge, DeerFlow, TunaCode | T24 | T25, T26 |
| **4 — Git & Quality** | T28, T29, T33 | GitButler, ClawWork, Mission Control, Pi | T33 | T29 |
| **5 — MCP/Skills/Memory** | T30, T31, T32 | QMD, Zed, Pi, DeerFlow, Nanobot, memU, TinyClaw | T31 | T30, T32 |

**All 5 agents run in parallel. Zero file conflicts between clusters.**

---

## Priority Order (Recommended Execution)

### Phase 1 — Foundation (unblocks everything else)
1. **T17** — Push-first status (Agent 1)
2. **T24** — Provider registry (Agent 3)
3. **T21** — SerializeAddon (Agent 2)

### Phase 2 — Dashboards & Persistence
4. **T18** — Resources dashboard (Agent 1)
5. **T19** — Token dashboard (Agent 1)
6. **T22** — Tab recovery (Agent 2)
7. **T33** — Quality scoring (Agent 4)

### Phase 3 — Orchestration & Intelligence
8. **T20** — Activity feed (Agent 1)
9. **T25** — Agent messaging (Agent 3)
10. **T27** — Context handoff (Agent 3)
11. **T31** — Skills system (Agent 5)
12. **T28** — Rust diff (Agent 4)

### Phase 4 — Advanced Features
13. **T26** — Dependency scheduler (Agent 3)
14. **T30** — MCP host (Agent 5)
15. **T32** — Agent memory (Agent 5)
16. **T23** — Full-text search (Agent 2)
17. **T29** — Oplog/undo (Agent 4)

---

## Documentation Template

Each agent must create `docs/applied/T{XX}_{name}.md` with this format:

```markdown
# T{XX} — {Task Name}

## Inspiration Source
- **Repo**: {name} ({ghq path})
- **Files studied**: {list of files read}
- **Pattern applied**: {what pattern was borrowed}

## What Changed
- {list of files created/modified}

## Architecture Decisions
- {why this approach was chosen}
- {trade-offs considered}

## How to Test
- {manual testing steps}
```
