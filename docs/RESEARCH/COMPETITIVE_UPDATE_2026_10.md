# Competitive Update — 2026-10-04

Delta since `COMPETITIVE_UPDATE_2026_08` and the learnings filed as T174, T183 and T184. Feeds
**T200**. Read-only review of 48 repos (spark tag `exegol`: `spark tag list exegol`, update with
`spark pull all --tag exegol`), clones under `_code_/_repos_2_learn/github.com/`. Two waves:
the repos we already followed (history since 2026-08-15), then the open-source entries of an
"AI orchestrators" tier list (Oct 2026). Every item below names the file it comes from; items
already in Exegol or in the backlog are marked.

Not open source (not reviewed): Conductor, Maestri, super.engineering, Agentastic, Solo, Clor's
control plane.

## What moved

- **Headless structured protocols are the norm.** monocode, pullfrog, t3code, waku, codex-host
  drive Claude through `stream-json`, Codex through `app-server` JSON-RPC, OpenCode through
  `serve` + SSE, pi through `--mode rpc`. Exegol reads PTY scrollback for pipeline steps.
- **The agent is woken by the world, not only by the user**: PR checks/reviews/conflicts
  (t3code `orchestration-v2/pullRequestWatch.ts`, agent-orchestrator `lifecycle/reactions.go`),
  rate-limit resets (agent-of-empires `acp_reconciler/rate_limit.rs`), stuck watchdogs
  (overstory `watchdog/daemon.ts`, bernstein `heartbeat_escalation.py`).
- **Per-turn undo for interactive agents** (waku `waku-core/src/checkpoint.rs` hidden refs per
  turn, traycer `undo-a-turn.mdx`, codex-host turn summary + Review). Exegol snapshots only
  pipeline steps (T129).
- **A message queue with steer** is standard (waku, bb 0.44, traycer `message-queue.mdx`,
  omnigent `QUEUE_STEER_DESIGN.md`; codex-host's steer = interrupt, wait idle, deliver).
- **Answering the agent away from its terminal**: tortie reads the `PermissionRequest` hook body
  (question + numbered options) and presses an option from the phone (`activity/question.ts`,
  `reply/gate.ts`); kandev has `ask_user_question_kandev` and a clarification inbox.
- **Plan usage windows** (5h / weekly + reset) shown in the app: jean `claude_cli/commands.rs`,
  monocode `rate_limits.rs` (Anthropic OAuth usage, keychain token, read-only), t3code and
  monocode for Codex `account/rateLimits/read`.

## P1 — do next

| # | Learning | Evidence | Change in Exegol | Effort |
|---|---|---|---|---|
| 1 | Pre-trust the folder before spawning | orca `src/main/claude/claude-folder-trust-file.ts`, `agent-workspace-trust-spawn.ts` (never breaks a held lock) | A new worktree or pipeline dir can stop on the CLI's trust prompt; grant it in `agent-spawn-flow.ts` before the spawn (Claude, Codex) | S-M |
| 2 | Strip the launching session's markers from the child env | klaudio-panels `agent.rs:277` (CLAUDECODE, CLAUDE_CODE_CHILD_SESSION, CLAUDE_CODE_ENTRYPOINT); herdr drops an inherited `CODEX_THREAD_ID` | `inheritedEnv()` strips only `EXEGOL_*`; an inherited child-session marker silently stops Claude's transcript (history, resume) | S |
| 3 | Per-pane error boundary | superset #7983 | One `ErrorBoundary` in `renderer/main.tsx`; wrap each `WorkspacePane` | S |
| 4 | Follow-up queue + steer | waku CHANGELOG, bb 0.44, traycer, omnigent, codex-host `external-thread-steering.md` | Per-agent queue in the toolbar and Dashboard card, flushed on the Stop turn boundary; Steer = Esc, wait idle (20s cap), type; "send later" | S-M |
| 5 | Per-turn snapshot, "changes this turn", Undo turn | waku `checkpoint.rs`, traycer `undo-a-turn.mdx`, codex-host turn folding, hermes checkpoint ledger | `prepareStepSnapshot` on UserPromptSubmit/Stop for every agent; toolbar chip "N files, Review"; Undo turn / all in the GitPane oplog (extends T129) | M |
| 6 | Answer agent questions from the Dashboard or a notification | tortie `activity/question.ts`, `reply/gate.ts`, `press-shapes.ts`; kandev `clarification/` | `PermissionRequest` hook in the per-agent hooks file keeps question + options on the signal; buttons write the option key; an `ask_user` MCP tool for structured questions | M |
| 7 | React to PR checks, reviews and conflicts | t3code `pullRequestWatch.ts` (wake cap 10, new head SHA resets), agent-orchestrator `reactions.go` (dedup on content, max 3, held during a permission prompt), bernstein `ci_fix.py` | A `gh` poller in main; deliver at the turn boundary like `agent_send`; MCP `pr_watch` (next to T142) | M |
| 8 | Plan usage meter | jean `commands.rs:45-62,1130-1160`, monocode `rate_limits.rs:413-476`, t3code `claudeUsageLimits.ts`, `codexUsageLimits.ts` | Toolbar / Monitor chip: 5h and weekly use with reset time; stale cache on 429; never refresh the CLI's token | M |
| 9 | Hooks for Codex and other CLIs; session id from the hook | herdr `targets.rs:189`, `config_edit.rs:775` (`[features] hooks = true`), `agent_resume.rs` (cwd is part of the identity) | T123 hooks are Claude-only; Codex gets deterministic turn boundaries and a stored session id, ending the "continue last in this folder" fallback (T191 `emitsTurnBoundaries`) | M |
| 10 | Stuck-agent watchdog ladder | overstory `daemon.ts:1110-1160` (warn, nudge, AI triage retry/terminate/extend, kill), bernstein `idle_detection.py` (no log growth + no worktree change), mission-control requeue | No hook event, no output and no worktree change for N min: attention, then nudge, then Haiku triage, then stop | M |
| 11 | Bundled orchestration skills | paseo `skills/paseo-committee`, `paseo-handoff`, `paseo-advisor` | Default skills that teach agents our existing `agent_send` / `agent_link` / `messages_check` tools (committee = two contrasting agents converge on a plan) | S |
| 12 | Agent-driven UI over MCP | sidecar `internal/cli/registry.go:597` (`open file:line\|--diff`, `notify --target`) | MCP `pane_open {file:line \| diff \| url}` and `notify {title, target}` through NotificationBus with a jump target | S-M |
| 13 | Send diff review comments to the agent | emdash `diff-comments-mention.ts`, `draft-comments-context.ts` | "Send unresolved comments to agent" in the diff view through the agent input path | S |

## P2

| Learning | Evidence | Change in Exegol |
|---|---|---|
| Headless structured runs for pipeline steps and the evaluator | monocode `claudeProtocol.ts:254-292`, `codex.ts:520-678`; pullfrog `agents/claude.ts:1232`, `codex.ts:962`, `opencode.ts:477`; pi `docs/rpc.md` | Non-interactive steps use the JSON path, not scrollback (partial T134, T183.11). L |
| Rate-limit park and auto-resume | agent-of-empires `rate_limit.rs:12-28` (reset + 15s, max 5), stoneforge `dispatch-daemon.ts:111` (fast exit with no output = limit, fall back to the next CLI) | Park until the reset; the queue resumes or falls back |
| Fault taxonomy and credential verdicts | pullfrog `providerErrors.ts`, `credentialPool.ts:160-223` (`exhausted{resetAt}`), proliferate `seat_trial.rs` (probe with a real call) | "crashed" gets a cause; Doctor ranks subscription over API key (extends T184.6, T192) |
| Real cost from CLI events, unknown not 0 | pullfrog `codex.ts:555-580`, claude `total_cost_usd`, pi models.dev tiers | `token_usage` stores cost and marks it unknown |
| Hard spend cap per run or agent | bernstein `cost/ticket_cap.py:358`, mission-control `task-dispatch.ts:196` | Budgets only warn today; a cap holds the run |
| Snapshot required before a step; refuse cross-worktree branch moves | gitbutler `but-oplog` (06be597726), `oplog.rs:1023` | `prepareStepSnapshot` continues on failure (`oplog-snapshots.ts:22`) |
| Warm retry through the CLI's resume | bernstein `checkpoint_retry.py:77`, stoneforge resume cap | A failed step resumes the same session with the evaluator feedback before a fresh start (T192) |
| Resume guard | pullfrog refuses `codex --last` (`codex.ts:962`), monocode resumes only with the same cwd and account (`claude.ts:445`) | Resume only by stored id |
| Remove worktrees after their PR merges, proving the work landed | openchamber `useMergedWorktreeCleanup.ts`, traycer `concepts/sweep.mdx` | Opt-in sweep from the PR state the GitPane polls |
| V8 compile cache | t3code `apps/desktop/src/compileCache.ts` | `module.enableCompileCache()` in main and the sidecar; measure with `[Startup]` |
| Readiness census, capability bench, served-model check | orca `runtime/readiness-census-*`, omnigent `harness_capabilities.py` + bench, harnessrouter `samemodel.py` | Recorded transcripts pin status detection; after a CLI update probe first turn / resume / model honored (T191) |
| Links across wrapped lines, dirs and dotfiles | klaudio `xterm-logical-line.ts`, 4c9df50 | `terminal-links.ts` reads one row and needs an extension |
| Renderer-acked, per-session flow control | terax `pty/output.rs`, `PtyOutputReceiver.ts`; klaudio 10d1e70 | `OutputGate` pauses every PTY when one socket backs up |
| Bell as attention | tabby ea801300, 34531b1d | `onBell` raises attention for hookless CLIs and shells |
| Paced, lazy auto-resume | herdr 46a50918 (stagger, wait for host colors), klaudio 84d3ec9 (only the active tab) | `use-resume-agent.ts` resumes all back to back |
| Browser annotations into the agent's input; browser pane as MCP tools | ghostex `docs_annotation_feedback.rs`, synara `browserSessionPolicy.ts` | Element pick pasted into the focused agent without Enter; MCP navigate/snapshot/click/console scoped to the agent's pane |
| Fuzzy search over every prompt, Enter resumes | ghostex `find_prompts_modal_lifecycle.rs` | FTS over the T181 readers in the Command Palette |
| Undo close for 30s | bb 0.44 | Cmd+W delays stop + archive behind an Undo toast |
| Advisor on live agents | oh-my-pi `docs/advisor-watchdog.md` | Opt-in Haiku judge per turn (reuse T88v2); concern to attention, blocker via `agent_send` |
| Named launch profiles (account, proxy, model) | silo RFC 0033, opencodex `src/cli/claude.ts` | Several env variants per provider (`CLAUDE_CONFIG_DIR`, `ANTHROPIC_BASE_URL`); absorbs T191 `configDir` |
| Agent-assisted conflict resolution | oh-my-pi `conflict://` | Ours/theirs/base per hunk + "Resolve with agent" instead of the disabled Resolve |
| Plan artifact gate with revisions and file-mirrored comments | kandev plan tools, traycer `.comments/<thread>.md` | Pipeline "plan" step writes `.exegol/plans/<run>.md` and pauses; `{{plan}}` for the next |
| Board columns driven by agent events | kandev `workflow-tips.md`, YAML export | start → In Progress, Stop → Review, merged → Done (T172.3) |
| Skill curator and `/learn` | hermes `agent/curator.py`, `tools/skill_usage.py`, `learn_prompt.py` | Usage counts, stale after 14 days, archived after 30, pinned exempt |

## P3

Quota-aware dispatch (groundcrew `eligibility.ts:140-226`); per-CLI status rules as data
(agent-of-empires `detect/manifests/*.toml`, T191); reset mouse/paste modes when a CLI exits in a
shell pane (tabby `xtermFrontend.ts:610`); spawn at the measured pane size (herdr 5da0a01e);
Ctrl+Tab in MRU order (tabby cdb107af); approval-detection conformance suite (eve
`channel-conformance/contract.ts`); pi as a provider with layered MCP config (pi `docs/rpc.md`,
`docs/mcp.md`); Laptop Mode layout (silo decision 0033); dev-only automation RPC for E2E (silo
`docs/automation.md`); one skills source symlinked into every CLI (ghostex `agent-sync`); diff
filter by glob (bb); ticket DAG executor (traycer `traycer-execute`); workflow scenario tests with
mocked steps (reliant `workflows/testing.mdx`); "Working" fold on the Dashboard (t3code
`threadInbox.ts`); "why this terminal shrank" banner (superset `TerminalNarrowedBanner.tsx`);
compaction boundary for history (omnigent `session-compaction.md`).

## Already in Exegol or the backlog (not refiled)

Remote/mobile access (T93, T94, T133; tortie's credential-less phone door is the model to copy),
multi-machine dispatch (T73), merge queue and read-set admission (T136), fan-out cap (T183.13),
ACP harness (T134), automations catalog (T132), Ghostty engine (rejected), diagnostics bundle
(T196), status from hooks (T123), Agent Hub (Dashboard), session import (T181).
