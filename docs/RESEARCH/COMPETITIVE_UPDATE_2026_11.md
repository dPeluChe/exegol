# Competitive Update — 2026-11-04

Delta since [`COMPETITIVE_UPDATE_2026_10`](./COMPETITIVE_UPDATE_2026_10.md) (T200). Read-only review of the
48 repos tagged `exegol` in spark (`spark pull all --tag exegol` on 2026-11-04: 34 pulled, 13 up to
date, Ghostex skipped: dirty local clone). Clones under `_code_/_repos_2_learn/github.com/`; paths
below are relative to each repo. Read before the per-project vs app-wide screen restructure
(see the 2026-10-27 Project/Monitor audit in `TASK_COMPLETED/2611.md` once filed, and T210).

No commits since 2026-10-04: anvil, shu, waku, terragon-oss, stoneforge, clay, proliferate,
overstory, agentbox, collab-public. Nothing relevant: vercel/eve (SDK 1.0 RCs), marcus/sidecar,
herdr, mission-control, smux.

## 1. Restructure: app-wide vs per-project

The month's clearest pattern. Every busy app now has one app-wide triage screen plus a
per-project drill-down that remembers where you came from.

| Idea | Source | Exegol today |
|---|---|---|
| Overview: counts line, then Needs you / Running / Looks done (bulk mark done) / In work by project (stalled after 3 days) / Can be cleaned up (merged-PR worktrees). ADR rejects kanban columns | openchamber `packages/ui/src/components/overview/ADR.md`, `lib/overview/overviewModel.ts` | Dashboard has fleet + Watching, no triage sections |
| Single/Fleet toggle: per-project card (health, live agents, today's spend, pending approvals), drill-down keeps the fleet flag, chip search `agent:claude status:running across:all`, cache keys namespaced per view | bernstein `docs/operations/fleet.md`, `core/fleet/aggregator.py`, `cost_rollup.py` | Fleet without spend, approvals or query |
| Workspaces list: list/board, group by status/project/creator, filter chips, built-in views (All, Needs me, Working), saved views, virtualized | superset `.../v2WorkspacesFilterStore.ts`, `V2WorkspacesViewsBar.tsx` | T210 is a subset |
| Pin and archive projects, multi-project filter | t3code `useProjectGroupUpdate.ts`, `sidebarProjectGrouping.ts`; agent-orchestrator #7752 | No pinned projects |
| Sidebar: needs-input sessions first within a project, read/unread dots, hover preview of the session card | agent-orchestrator `Sidebar.tsx`, `useSessionPreviewHover.ts` | Partial (Active only, attention view) |
| Session list grouped by project, idle projects folded, filter by agent, sort remembered, Needs input tab first | tortie `src/shared/session-list.ts` | Partial |
| Running work apart from history | kandev `background-work-overview.tsx` | Tasks and History mix both |
| Focus mode: a window with one session; badges and sounds count only it | agent-of-empires #5064 | Floating panes, not scoped |
| Watched projects with unread-commit dot; per-project theme color blended on switch | gitbutler `crates/but-gpui/src/navigator.rs`; monocode ProjectAppearance | Project icon/color only |
| Lesson: grouping by guessed "needs you" heuristics pulled rows out of place; they removed it and group by known PR stage | groundcrew #425, #409 | Keep groups factual |

## 2. Usage, cost and limits (the Monitor side)

| Idea | Source | Exegol today | Value |
|---|---|---|---|
| Usage-limit stop: pause the queue, "Resume at reset" countdown, Switch Agent to another installed CLI; optional failover to another account or model | superset `UsageLimitNotice.tsx`; agent-of-empires `SystemNotices.tsx`, `SwitchAgentModal.tsx`; openchamber `limit-failover/`; synara `UsageLimitRecoveryReactor.ts` | Meter only (T200.8); park was P2 in October | P1 (4 repos ship it) |
| Refuse to spawn into an exhausted 5h/weekly window, remember the reset | opencodex `src/adapters/claude-cli/usage-admission.ts` | No check | P1 for pipelines, Parallel Runs, scheduler |
| Codex workspace credits count as headroom (else false "limit reached") | pullfrog `utils/subscriptionProbe.ts` | Unverified | P1 check |
| Usage page: filter provider/model, cache hit rate, cost per M tokens, "unpriced" and "Other" instead of 0; even-pace marks on limit bars | t3code `apps/server/src/usage/usageAggregation.ts`, `UsageLimitsPooled.tsx` | Tokens tab needs a manual scan (0 rows) | P1 for global Monitor |
| Per-call ledger: tokens, model, purpose, auth mode, outcome; 90 days of rows plus a daily rollup | reliant e358a765f, aead1e430 | `token_usage` per project | P2 |
| Chip hidden while there is room, "17% left · resets 3:00 PM" when tight; picker marks a limited provider | hermes `provider-status-chip.tsx`, `credential_pool_model_cooldowns.py` | Always-on meter | P2 |
| Prompt-cache countdown / "next message reads the cache" | codex-host `claude-prompt-cache.ts`; oh-my-pi #17496 | No | P2 |
| Stats routes: Overview/Projects/Models/Providers/Costs/Errors/Tools | oh-my-pi `packages/stats/src/client/routes/` | Monitor tabs | Layout reference |

## 3. Status without hooks

- **OSC 9;4** (Ghostty progress): Claude Code sends working/done/failed when the terminal says it
  is Ghostty. gitbutler `crates/but-tty/src/vt.rs`. **P1**.
- **OSC 7501** (pi): working, blocked (permission/question/auth), done, error, idle, sent after a
  support query. pi-mono `packages/tui/src/program-status.ts`. **P1**.
- Exegol registers only OSC 7, 52, 133 in the renderer (checked 2026-11-04) and OSC 777 from its own
  hooks in main. Both give exact status for CLIs without hooks (Antigravity, Devin, Zed...).

## 4. Other items worth filing

| Idea | Source | Value |
|---|---|---|
| Copy local files (`.env` and similar) into a new worktree before setup | paseo `packages/server/src/server/plugins/builtin/` (#8100) | P1 |
| Idle worktree shedding: drop regenerable files after 24h only if no process, HEAD/reflog unmoved, no file changed | reliant bad21f8a1 | P1 for worktree hygiene |
| "Turn ran too long" alert (off by default, user-set) | traycer #3363 | P1, first step of T200.10 |
| Needs-input vs finished notifications, separate settings | orca `src/shared/notification-source-gate.ts` | P2 |
| DevTools docked in the browser pane | orca `browser-guest-devtools-dock.ts` | P2 |
| Memory: project tag by default, worktrees share it, opt-in global facts | oh-my-pi `docs/memory.md` | P2 (Exegol memory is project-keyed; global facts are new) |
| Agents edit the Tasks list through MCP tools | synara `apps/server/src/agentGateway/todoTools.ts` | P2 |
| Reply from the inbox row; PR files "viewed" with progress | omnigent `InboxPage.tsx`, `PullRequestViewedControls.tsx` | P2 |
| Multi-select bulk actions in the sidebar | bb `core-thread-actions.ts` | P2 |
| Background agents kept out of tabs and attention | paseo a880c9619 | P2 |
| Contribution calendar of what agents shipped | monocode `contributions.rs` | P2 |
| Project-wide mailbox (`project:<slug>`) | mcp_agent_mail_rust `project_mailbox.rs` | P2 |
| Provider circuit breaker after repeated failures | kandev `circuit.go` | P2 |
| Agent-authored workflows approved in chat | openchamber `lib/workflows/` | P2 |
| Prompt Rail (one mark per user prompt along the transcript) | silo `prompt-rail.ts` | P2 |
| Scheduler missed-run policy and grace | hermes `cron/` | P2 |
| Secret requested on a private card, not in chat | t3code #30257, openchamber #5926 | P2 |
| Hidden-terminal hygiene: tabby leaks (O(n²) buffer in never-focused tabs, cursor-blink timer, PTY listeners) | tabby #11722, #11720, #11719 | P2 audit (Exegol already caps WebGL at 12 with parking) |

## Top 7

1. App-wide Overview (openchamber) + Fleet drill-down (bernstein) as the global screen of the restructure.
2. Project list with views, chips, pin and archive (superset, t3code), folding T210 into it.
3. Usage-limit recovery and a spawn-time check (superset, agent-of-empires, opencodex, pullfrog).
4. Global usage page with real breakdowns, automatic import (t3code).
5. OSC 9;4 and OSC 7501 status.
6. `.env` copy into worktrees + idle shedding (paseo, reliant), with the worktree hygiene round.
7. "Turn ran too long" alert and needs-input vs finished notifications (traycer, orca).

## Company and chat references (2026-11-05)

Cloned for the redesign (T213 phases 4 and 5), under the spark `exegol` tag: pixel-agents
(MIT), NosytLabs/agent-office (MIT), bloks (custom license, ideas only). claudecodeui was read
and dropped (AGPL, runs Claude through the SDK, not a PTY). Read for ideas only: harishkotra and
ajsahni agent-office (license forbids reuse), AionUi, agency-agents.

None of them sends chat input into a live interactive PTY: Exegol has to map the CLI menus to keys
itself; hooks still give a reliable "permission pending" signal.

- Turns from transcripts: pixel-agents `server/src/fileWatcher.ts` polls `~/.claude/projects/*.jsonl`
  every 500 ms with a byte offset and a partial-line buffer (dropped `fs.watch`, unreliable on
  macOS); `transcriptParser.ts` per line; `hookEventHandler.ts` normalizes hooks (`Stop` done,
  `Notification(idle_prompt)` waiting, `PermissionRequest` permission); `timerManager.ts` guesses a
  permission prompt when a tool stays open 7 s without hooks
- Activity labels: agent-office `claude/hook.py` `ACTIVITY` (Bash running, Read/Grep reading,
  Edit/Write typing, Web browsing, Task delegating); Codex the same in `codex/hook.py`
- Desk states: agent-office `state_model.py` (working or thinking with no event for 300 s shows
  idle, stale after 1800 s unless a prompt is pending, done fades after 120 s); `web/js/attention.js`
  `nextWaitingAgent` for the "next one that needs you" key and the count in the title
- Busy signal for free: Claude Code writes `~/.claude/sessions/<pid>.json` with `status: "busy"`;
  check the pid is alive (seen in claudecodeui `claude-cli-liveness.service.ts`)
- Input mid-turn: bloks keeps stream-json stdin open to steer a running turn (headless only);
  claudecodeui refuses and queues on the client. For a PTY, queue until the turn boundary
- Rooms: bloks `relayMentions` (an @Name in a reply wakes that member, queued if busy),
  `room-hops.ts` `MAX_AGENT_HOPS = 3` per human message with a visible held notice,
  `room-route.ts` `pickAnswerers` (cheap model picks up to 3 by role, lead on timeout)
- Interruption level per workspace (all, only what needs me, nothing) and usage per agent and engine
  with a monthly limit: bloks
