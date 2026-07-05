# WT4 — Parallel Multi-Agent + Agent UX

> **Worktree mission:** complete and polish the P0 "parallel multi-agent" feature (3 agents race the same task, user picks winner), plus ship the P1 agent-visibility primitives (isolation badge + stop-reason panel) that build user trust. This brief is your **canonical scope**. Do NOT pick tasks from `docs/TASK_TODO.md` outside this brief.

## Tasks bundled in this WT

- **T65** — Parallel Multi-Agent on Worktrees (P0). **Mostly already implemented** — see "Existing implementation audit" below. Your job is the missing pieces.
- **T107** — Agent Comparator UI (P1). **Brand new** — the side-by-side review surface that makes T65 useful.
- **T105** — Worktree Isolation Status Badge (P1). Small UI addition.
- **T106** — Agent Stop Reason Panel (P1). Small UI addition.
- **Refactor splits** — `renderer/components/terminal/TerminalPanel.tsx` (598 LOC) and `main/agents/manager.ts` (485 LOC). Both sit above the 500 LOC soft limit and you'll be adding to them — split them now, before adding new code. See "Split plan" below.

## Why these matter (do not skip)

The "3 agents attack one problem in parallel, then pick the best result" workflow is **the killer feature** that distinguishes Exegol from every other CLI agent runner. Today the backend works (spawn 3 agents, isolated worktrees, track them as a group), but:

- There's **no comparison UI** — the user has to manually open each worktree's diff, eyeball them, then click a "promote" button somewhere. That's not a feature; that's plumbing.
- The user has **no signal that isolation is real**. When a worktree creation fails silently and the agent runs in project root, the user thinks they have isolation but don't.
- When an agent stops/crashes, the terminal just goes silent. "Why?" is the most common question, and the answer (exit code, last lines, resume availability) is in the DB but not surfaced.

This WT closes those three gaps and turns parallel multi-agent from a backend feature into a polished product surface.

## Existing implementation audit (read this before touching T65)

T65 is **not** a fresh implementation. Before writing any code, grep and read:

- `apps/desktop/src/main/db/queries/parallel-runs.ts` — DB queries already exist: `createParallelRun`, `getParallelRun`, `listParallelRuns`, `promoteParallelRunAgent`, `updateParallelRunStatus`.
- `apps/desktop/src/main/ipc/procedures/agents.ts` (around lines 355–460) — IPC already exposes `spawnParallel`, `promoteParallelAgent`, `cancelParallelRun`.
- `apps/desktop/src/renderer/components/agents/ParallelSpawnModal.tsx` — the spawn UI is already wired and calls `agents.spawnParallel`.
- `packages/shared/src/types/agent.ts` — types `ParallelRun`, `ParallelRunStatus`, and the `parallel_run_id` field on `Agent` already exist.
- `apps/desktop/src/main/db/migrations.ts` — the `parallel_runs` table and `agents.parallel_run_id` column are already added.

**What's likely missing or incomplete for T65:**

- **Completion detection**: when all agents in a `ParallelRun` finish (completed/failed/crashed/stopped), the run's status should transition from `running` → `completed`. Verify this happens — look for the `onAgentComplete` / similar callback in `main/agents/manager.ts` or wherever lifecycle events are emitted. If it doesn't, add it.
- **Promotion side effects**: when `promoteParallelAgent(runId, agentId)` is called, the OTHER agents' worktrees should be cleaned up (or marked discarded) and the promoted worktree should be the one git-ish merged back. Audit `promoteParallelRunAgent` in `parallel-runs.ts` to see how far it goes today.
- **Status propagation**: when one agent in a parallel run fails, do we mark the run as `partial` or keep it as `running`? Decide and document.
- **Tests**: there may or may not be unit tests for parallel logic. Add or backfill where missing.

**Do not rewrite what already works.** Read first, identify gaps, fill them. If you find a design bug, document it in the PR but only fix it if it blocks the comparator (T107).

## Reference reading (read FIRST, before any code)

1. `docs/RESEARCH/TERAX_STACK_REVIEW.md` — context on agent UX patterns we're inspired by (not a direct reference for this WT — parallel agents is our own innovation).
2. `CLAUDE.md` at repo root — Exegol architecture summary, especially **Agent lifecycle**, **Multi-agent pipelines**, **Push-first** sections.
3. `docs/TASK_TODO.md` — the original T65/T105/T106/T107 task descriptions (your scope is the brief; the TASK_TODO is the original sketch).
4. All files listed in "Existing implementation audit" above — read them end-to-end.
5. `apps/desktop/src/renderer/components/terminal/TerminalPanel.tsx` (598 LOC) — the file you'll split and extend.
6. `apps/desktop/src/main/agents/manager.ts` (485 LOC) — the file you'll split and extend.

## Implementation plan

### T65 — Finish Parallel Multi-Agent

**Step 1: Audit completion detection.** Find the agent lifecycle exit point (likely in `main/agents/manager.ts` or its split children — `agent-session-callbacks.ts`, `reattach-sidecar-agents.ts`). When an agent terminates, if it has a `parallel_run_id`, check whether all sibling agents are also terminal. If yes, update the run status:
- All `completed` → run status `completed`
- Any `failed`/`crashed`/`stopped` while others still running → leave as `running` until all settle, then mark `completed` with a `hasFailures: true` flag (or use `partial` status; see what `ParallelRunStatus` already supports).
- All terminated, no `completed` → run status `failed`.

**Step 2: Verify promotion semantics.** Read `promoteParallelRunAgent`. When promoting agent X:
- Mark the run as `promoted` with `promoted_agent_id = X`.
- The sibling worktrees: leave them (don't auto-delete — user may want to inspect). Mark them as "discarded" in metadata if a field exists, or just leave their `parallel_run_id` linked.
- Do NOT auto-merge the promoted branch — that's a user action via the existing git UI.

**Step 3: Broadcast completion.** When a parallel run completes, emit a push notification (`broadcastParallelRunComplete(runId)`) so the renderer can refresh and offer the comparator view. Hook into the existing push event infrastructure (look for `broadcastAgentStatus` and mirror its shape).

**Step 4: Tests.** Add unit tests for:
- `createParallelRun` + linking 3 agents → all visible via `listParallelRuns`.
- Completion detection: simulate 3 agents finishing, verify run status transitions.
- Promotion: verify `promoteParallelRunAgent` updates state correctly.
- Cancel: verify all running agents get stopped (check existing logic).

### T107 — Agent Comparator UI

**Goal:** when a parallel run completes (or while it's in progress), the user opens a dedicated comparison view: N columns side-by-side, one per agent, showing diff summary + score + cost + duration + test status + a "Promote" button.

**Step 1: New IPC procedure (if not already there).** In `agents.ts` IPC, add:

```typescript
getParallelRunDetails: publicProcedure
  .input(z.object({ runId: z.string() }))
  .query(({ ctx, input }) => {
    const run = getParallelRun(ctx.db, input.runId);
    if (!run) throw new TRPCError({ code: "NOT_FOUND" });
    // Return: run + array of {agent, diffSummary, score, cost, duration, lastSnippet}
    return enrichParallelRunForComparison(ctx.db, run);
  }),
```

`enrichParallelRunForComparison` (new helper in `db/queries/parallel-runs.ts` or a new module):
- For each agent in the run: fetch `Agent`, recent `AgentMessage` cost data, `AgentScore` (if exists), basic diff summary (use Rust `coreRust.getWorktreeDiff` + count adds/deletes from the structured output, or `git diff --shortstat` if Rust unavailable), and the last ~10 lines of scrollback.
- Return as a single object: `{ run, columns: Array<{ agent, diffStat, score, cost, duration, lastLines }> }`.

**Step 2: New renderer component.** Create `apps/desktop/src/renderer/components/workspace/sections/ParallelRunComparator.tsx`:

- Use TanStack Query: `useQuery({ queryKey: ["parallelRun", runId], queryFn: () => trpcInvoke("agents.getParallelRunDetails", { runId }) })`. Refetch on push event for the runId.
- Layout: responsive grid, 2 columns ≤900px, 3 columns ≤1400px, N columns otherwise.
- Per column card:
  - Header: agent CLI icon + name + status pill (uses existing `StatusDot` / `AgentIcon`).
  - Body: diff stat (`+42 / -18 in 7 files`), score badge (if scored), cost (formatted via `formatCost`), duration (e.g. `1m 24s`), last-lines block (mono font, truncated).
  - Footer: two buttons — `Promote` (calls `agents.promoteParallelAgent`) and `Open worktree` (opens the agent's pane in the workspace).
- Empty state when run is still in progress and no completions yet: friendly loading state with per-agent live status.
- Refresh: subscribe to push events for parallel-run completion (or refetch every 10s while `run.status === "running"`).

**Step 3: Surface entrypoint.** Where does the user open this view? Two reasonable options:
- A new tab in the workspace that opens when a parallel run is created (preferred — automatic).
- A list of parallel runs in the Project tab → Tasks subtab, click to open comparator.

Pick ONE and ship it. Document the alternative in the PR for future iteration. The simplest path: add the comparator as a new `WorkspaceSection` type and have `ParallelSpawnModal` navigate to it on successful spawn.

**Step 4: Tests.** Component test for the comparator (mock TanStack Query, render the layout, verify columns + buttons). The IPC enrich helper deserves a unit test too.

### T105 — Worktree Isolation Status Badge

**Goal:** a small badge in the terminal toolbar (next to the existing access-mode badge) shows the agent's isolation state. Click to see worktree path/branch.

**Step 1: Derive isolation mode.** Add a helper (in `packages/shared/src/types/agent.ts` or `apps/desktop/src/renderer/lib/agent-helpers.ts`):

```typescript
export type IsolationMode = "isolated" | "pipeline" | "project-root" | "fallback";

export function deriveIsolationMode(agent: Agent): IsolationMode {
  if (agent.pipelineRunId) return "pipeline";
  if (agent.worktreeId) return "isolated";
  // ... see worktree-creation-failed flag if it exists; otherwise "project-root"
  return "project-root";
}
```

If `Agent` doesn't yet have a `worktreeId` field, audit — it likely does (T61 worked on this). If a worktree creation can fail and fall back silently, look for that signal (a log entry, a flag in `Agent`, etc.). If the signal doesn't exist, add a minimal one and document.

**Step 2: Badge component.** Reuse the existing access-mode badge styling pattern from `TerminalPanel.tsx` / wherever the access mode badge lives. The new badge should:
- Show a tiny icon + 1-word label (e.g. `Isolated`, `Pipeline`, `Root`, `Fallback`).
- Color-coded: green for `isolated` and `pipeline`, yellow for `project-root` (visible but not alarming), red for `fallback` (silent failure — bad).
- Tooltip: full text + worktree path (if any) + branch name.

**Step 3: Wire into the terminal toolbar.** Place it adjacent to the access-mode badge. Both belong to the same conceptual row. Make sure it doesn't push other UI around.

**Step 4: Tests.** Unit test the `deriveIsolationMode` function (it's pure). Component test the badge for each of the 4 states.

### T106 — Agent Stop Reason Panel

**Goal:** when an agent stops/fails/crashes, show an overlay above the terminal scrollback with: status, exit code, signal (if any), last 10–20 lines, "Resume" / "New agent with same task" / "View diff" actions.

**Step 1: New component.** `apps/desktop/src/renderer/components/terminal/AgentStopReason.tsx`:

- Props: `agent: Agent` (with status in `failed | crashed | stopped | completed`).
- Render only when `agent.status` is terminal AND `panel` shows scrollback (not when live).
- Pull last ~20 lines from `scrollback` (existing IPC) — use a tiny tail helper.
- Show exit code + signal if available (these are on the agent record after T104 work — verify).
- Show "Session resume available" if the agent has a `resumeCommand` field (per CLAUDE.md, T101 added this). If yes, the `Resume` button calls a tRPC mutation to re-spawn with the resume command.
- "New agent with same task" → opens `SpawnAgentModal` pre-filled with `agent.taskDescription`.
- "View diff" → switches to the git pane scoped to that agent's worktree.

**Step 2: Integration.** Mount in `TerminalPanel.tsx` (or in one of its split children — see split plan below). When `agent.status` is non-terminal, render nothing. When terminal, render above or below the scrollback (decide based on layout — read what current dead-terminal placeholder looks like to keep continuity).

**Step 3: Tests.** Component test for each terminal state + the resume action wiring.

### Refactor splits

#### Split `manager.ts` (485 LOC → multiple ≤300 LOC files)

The file already has companions (`agent-worktree-ops.ts`, `agent-session-callbacks.ts`, `reattach-sidecar-agents.ts`, etc. per CLAUDE.md). The remaining 485 LOC in `manager.ts` is the orchestration core. Suggested split:

- `manager.ts` — public `AgentManager` class facade + lifecycle entry points (≤250 LOC).
- `agent-parallel-orchestration.ts` (NEW) — parallel run completion detection + promotion side-effects (extracted from manager + new T65 code).
- Existing siblings stay where they are.

Keep `AgentManager` as the public class with no API changes — consumers must not break.

#### Split `TerminalPanel.tsx` (598 LOC → multiple ≤300 LOC files)

T105 and T106 will each add ~80 LOC if dropped in directly. Split before adding. Suggested:

- `TerminalPanel.tsx` — outer shell, layout, ref forwarding, mode selection (live / read-only / crashed) (≤250 LOC).
- `TerminalToolbar.tsx` (NEW) — toolbar row with access-mode badge, isolation badge (T105), title, status dot.
- `TerminalScrollback.tsx` (NEW) — the dead-terminal placeholder + AgentStopReason mounting (T106 lives here).
- Live xterm rendering stays where it is (uses `TerminalInstance` which is WT1's domain — do NOT modify TerminalInstance).

Keep `TerminalPanel`'s public props identical.

**Coordination warning with WT1:** WT1 owns `TerminalInstance.tsx` (sibling in same folder) and is also doing a split of that file. Both WTs will create new files inside `renderer/components/terminal/`. **Use different filenames** (no collision risk on different file names — git merges fine) and **do not touch `TerminalInstance.tsx`** even if it would simplify your work.

## Files allowed to modify or create

**Modify:**
- `apps/desktop/src/main/agents/manager.ts` (split + complete T65 lifecycle integration)
- `apps/desktop/src/main/agents/*.ts` (other existing agent files — if needed to wire parallel completion detection)
- `apps/desktop/src/main/db/queries/parallel-runs.ts` (extend with comparator helper)
- `apps/desktop/src/main/db/queries/agents.ts` (if needed for isolation mode field)
- `apps/desktop/src/main/db/migrations.ts` (APPEND only — never edit past migrations; if T105 needs a new column on agents, append a migration)
- `apps/desktop/src/main/ipc/procedures/agents.ts` (add `getParallelRunDetails`, broadcast events)
- `apps/desktop/src/renderer/components/terminal/TerminalPanel.tsx` (split + integrate badges/overlay)
- `apps/desktop/src/renderer/components/workspace/sections/PipelineSection.tsx` (optional — link to comparator if you go that route)
- `packages/shared/src/types/agent.ts` (add `IsolationMode` if not present)
- `docs/TASK_TODO.md` (remove T65/T105/T106/T107 entries when complete)
- `docs/tasks_completed/2026_05.md` (log your commits)

**Create:**
- `apps/desktop/src/main/agents/agent-parallel-orchestration.ts`
- `apps/desktop/src/renderer/components/terminal/TerminalToolbar.tsx`
- `apps/desktop/src/renderer/components/terminal/TerminalScrollback.tsx`
- `apps/desktop/src/renderer/components/terminal/AgentStopReason.tsx`
- `apps/desktop/src/renderer/components/workspace/sections/ParallelRunComparator.tsx`
- Co-located test files for each new component (`.test.tsx` / `.test.ts`)

## Files you MUST NOT touch (other WTs own them)

- `apps/desktop/src/renderer/components/terminal/TerminalInstance.tsx` — **WT1 owns this**
- `apps/desktop/src/renderer/components/terminal/osc-handlers.ts` (new in WT1) — WT1 owns
- `apps/desktop/src/renderer/lib/dormant-ring.ts` (new in WT1) — WT1 owns
- `apps/desktop/src/main/terminal/*` — **WT1 owns**
- `apps/desktop/src/main/security/*` — **WT2 owns**
- `apps/desktop/src/main/ipc/router.ts` — **WT2 owns (capability allowlist edits)**; you may NOT add new routers here. If you genuinely need a new router and not just procedures inside `agents.ts`, document it as a follow-up.
- `apps/desktop/src/preload/*` — WT2 owns
- `apps/desktop/src/renderer/index.html` — WT2 owns
- `packages/core-rust/*` — **WT3 owns** (you may use existing `coreRust.getWorktreeDiff` etc., but do not modify Rust)
- `apps/desktop/src/main/ipc/procedures/fs-search.ts` (new in WT3) — WT3 owns
- `apps/desktop/src/main/ipc/procedures/search.ts` — out of scope
- `apps/desktop/src/renderer/stores/workspace.ts` — WT1 adds cwd state; you may add a `parallelRunActiveId` slice **additively** but coordinate carefully. **Preferred: use a new store** (e.g. `parallel-runs.ts`) and avoid touching `workspace.ts`.
- `apps/desktop/electron.vite.config.ts`, `electron-builder.ts`, `package.json` — out of scope

If you discover a real cross-cutting need, **stop and document it** in the PR description.

## Success criteria / Definition of Done

A PR opens from your worktree against `main` with all of the following:

- [ ] T65 completion detection: when all parallel agents terminate, run status transitions correctly. Unit-tested.
- [ ] T65 promotion: `promoteParallelAgent` updates run + records promoted agent. Sibling worktrees retained.
- [ ] T107 IPC: `getParallelRunDetails` returns enriched comparison data.
- [ ] T107 UI: `ParallelRunComparator` renders N columns with diff stat, score, cost, duration, last lines, promote + open-worktree buttons. Responsive grid.
- [ ] T105: isolation badge renders the correct color/label/tooltip for each of 4 states. `deriveIsolationMode` is unit-tested.
- [ ] T106: stop-reason panel renders on terminal-state agents with status, exit code, last lines, resume + new-task + view-diff actions.
- [ ] `manager.ts` split — each resulting file ≤ 300 LOC; public `AgentManager` API unchanged.
- [ ] `TerminalPanel.tsx` split — each resulting file ≤ 300 LOC; public props unchanged.
- [ ] **Zero new TypeScript/npm dependencies** unless explicitly justified.
- [ ] All quality gates pass — see below.
- [ ] PR description includes: T65 gap analysis (what was already done, what you added), screenshots of comparator + isolation badge (each state) + stop-reason panel, before/after LOC of split files, and a list of any deferred follow-ups.

## Quality gates (run before EVERY commit, all green required)

```bash
# Typecheck
bun run typecheck

# Lint + format (must be 0 errors, 0 warnings)
npx @biomejs/biome check apps/ packages/shared/src/ packages/ui/src/

# JS tests (all suites green, new tests included)
bun run test

# Rust (verify nothing regresses — you should not modify Rust)
cd packages/core-rust && cargo check && cargo clippy -- -D warnings && cargo test

# Production build (the real safety net)
bun run build
```

If any gate fails, **fix the root cause** — do not skip hooks, do not `--no-verify`, do not lower lint rules.

## Commits

Suggested split (one task per commit, refactors first):

1. `refactor: split manager.ts into focused modules`  (pure motion)
2. `refactor: split TerminalPanel.tsx into Toolbar + Scrollback`  (pure motion)
3. `feat(T65): wire parallel run completion detection + broadcast`
4. `feat(T107): comparator UI for parallel runs`
5. `feat(T105): worktree isolation status badge`
6. `feat(T106): agent stop-reason panel with resume/new-task/diff actions`

Conventional commits. Body explains **why**, not what. Refactor commits should explicitly say "no behavior change — pure split."

---

## Engineering best practices (read before coding)

These apply to every change you make. They are codified in the project's `CLAUDE.md` — re-read it for context.

### 1. Scope discipline
- This is the largest WT. Resist scope creep aggressively.
- Work **only** within "Files allowed". The WT1/WT2/WT3 contracts are non-negotiable — breaking them blocks the entire wave.
- File splits ARE in scope but limited to `manager.ts` and `TerminalPanel.tsx`. Do NOT refactor neighbors "while you're there".
- T65 is mostly done. Read first; don't rewrite what works.

### 2. Read before you write
- Read `parallel-runs.ts`, the relevant section of `agents.ts` IPC, and `ParallelSpawnModal.tsx` end-to-end before writing any T65 code.
- Read `TerminalPanel.tsx` and `manager.ts` end-to-end before splitting them.
- Read 2-3 existing renderer sections (`OplogSection.tsx`, `TokensSection.tsx`) to match patterns when writing the comparator.

### 3. TypeScript discipline
- No `any` — use the precise types from `@exegol/shared`.
- No non-null assertions (`x!`) — Biome will flag them. Use narrowing or `?`.
- Prefer `type` aliases over `interface` for object shapes (project convention).
- Use `import type { ... }` for type-only imports.
- For tRPC procedures: use `z.object({...})` with explicit min/max bounds on numeric fields.

### 4. No new dependencies
- This WT does not require any new npm/cargo deps. Everything is built from existing primitives (Radix, lucide-react, TanStack Query, your local components).
- If you find yourself wanting one, stop and explain in PR.

### 5. Comments policy
- Default: **no comments**. Well-named identifiers + small functions document themselves.
- Exception: lifecycle state machines (like parallel run completion detection) warrant a 1-line note above the transition table explaining the policy (e.g. `// any-failed counts as failure only after all peers settle`).
- Never explain WHAT — only WHY-when-non-obvious.

### 6. Match existing code style
- For renderer components: match `TokensSection.tsx` or `OplogSection.tsx` patterns (functional components, hooks at top, sub-components defined in-file unless reused).
- For IPC procedures: match neighboring procedures in `agents.ts` — same `publicProcedure.input(z.object({...})).query/mutation` shape.
- For DB queries: match `parallel-runs.ts` existing patterns.

### 7. Small focused commits
- Refactor commits (splits) MUST be pure motion with zero behavior change. Reviewers should be able to confirm via `git diff --stat` that no lines were added beyond moves.
- Feature commits each add ONE feature. Bundling T105 + T106 in one commit is OK if they're <200 lines combined; T107 deserves its own.
- Commit message body explains why.

### 8. Test what you ship
- Every new pure helper (`deriveIsolationMode`, completion-detection logic, `enrichParallelRunForComparison`) deserves a unit test.
- Component tests for the comparator and stop-reason panel — mock TanStack Query, render, assert on the layout.
- The split commits should be covered by EXISTING tests continuing to pass (proof that behavior didn't change).

### 9. Error handling discipline
- For tRPC procedures: throw `TRPCError` with explicit codes (`NOT_FOUND`, `BAD_REQUEST`, etc.).
- Do NOT add defensive try/catch around inputs that Zod has already validated.
- For component fetch errors: let TanStack Query surface the error state; render a useful message; never `JSON.stringify(err)` to the UI.

### 10. Performance awareness
- The comparator fetches per-agent data for N agents. Don't fan-out — write ONE IPC procedure (`getParallelRunDetails`) that does N work server-side and returns a single payload. N round trips from the renderer is wrong.
- The diff stat helper should use `coreRust.getDiff` (structured, fast) if available, falling back to `git diff --shortstat` otherwise.
- Auto-refetch on the comparator should be event-driven (push notifications), not polling-heavy. A 10s polling fallback is fine; don't poll every second.

### 11. UX awareness
- Isolation badge colors: green is GOOD, yellow is QUESTIONABLE, red is BAD. Don't invert.
- The `Promote` button is destructive-ish (kills other agents' relevance). Confirm via a small dialog OR via clear visual feedback ("Promoted — other variants archived").
- Empty states matter. The comparator showing "still running" deserves a thoughtful design, not a spinner.
- Tooltips on every badge — accessibility is not optional.

### 12. Threat model awareness
- The `Promote` action mutates DB state. Make sure it's idempotent (calling it twice with the same agentId is fine).
- The "New agent with same task" button copies `taskDescription` into the spawn modal — do NOT auto-spawn. User must confirm.
- The "Resume" button on stop-reason: only show if `resumeCommand` is present in the agent record. Verify the field exists before rendering the button.

### 13. Quality gate hygiene
- Run gates **before each commit**, not just before the PR.
- The split commits are the most likely place to break things — confirm full test suite passes immediately after each split, before adding feature code.
- The production build (`bun run build`) is the ultimate truth.

### 14. Don't iterate on passing code
- One pass for each task. Don't refactor / polish / over-engineer.
- The comparator doesn't need a settings panel. The badge doesn't need an animation. Ship the core; iterate later.

### 15. Document deferred items
- Anything you can't finish or punt on: explicit TODO comment with reasoning + a note in PR description.
- Specifically: if T65 has an existing design bug that doesn't block T107, document it as a follow-up, don't try to fix it here.

### 16. PR description is part of the work
- This WT is the biggest. Your PR description should be the most thorough.
- Lead with a **gap analysis for T65** ("here's what was already implemented, here's what I added").
- Include screenshots: comparator empty state, comparator with 3 columns + scores, each isolation badge state, stop-reason panel for failed/crashed/completed/stopped.
- "What was deferred and why" section is mandatory.

---

## Out of scope (explicitly)

Do NOT do any of the following, even if they seem related:

- T58 remaining (runtime mode switching, scheduler propagation) — out of scope
- T88 Ralph Loops in Pipelines — different WT (future)
- Modifying `TerminalInstance.tsx` — WT1 owns
- Modifying anything in `main/terminal/`, `main/security/`, `preload/`, `packages/core-rust/`
- Adding new tRPC routers (you may add procedures inside `agentRouter`; do not add new top-level routers)
- New columns on existing DB tables UNLESS strictly required for T105 (and then append a migration)
- Rewriting `ParallelSpawnModal` — it works; build the comparator alongside it
- Visual redesign of the workspace layout
- Adding charts/graphs to the comparator (text + numbers is enough)
- Adding tests for code you didn't write
- Adding new dependencies
- Modifying `package.json`, `bun.lock`, `electron-builder.ts`, vite config

## When you finish

1. Final quality gate pass (typecheck + biome + tests + build + cargo) — all green.
2. Smoke-launch the app (`bun run dev`) and verify: spawn a parallel run with 2 agents (use shell CLIs that exit fast for testing), wait for completion, open comparator, click Promote, verify state transitions correctly.
3. Update `docs/tasks_completed/2026_05.md` with a "WT4" section (commits + outcome bullets per task).
4. Remove T65, T105, T106, T107 from `docs/TASK_TODO.md` Active Backlog + Priority Order.
5. Push branch + open PR with the thorough description described above.
6. Stop. Do not start adjacent work.
