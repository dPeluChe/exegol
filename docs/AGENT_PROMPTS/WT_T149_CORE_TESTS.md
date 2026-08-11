# Brief — WT-T149: Orchestration-core Tests

> Paste this as the task for a claude-code agent spawned in an **isolated worktree**.
> Full spec: `docs/TASK_TODO.md` § T149. Source analysis: `docs/RESEARCH/CODE_HEALTH_AUDIT_2026_07.md`.

You are implementing T149: tests for Exegol's orchestration core — the crash/corruption-prone
surface that currently has zero coverage. Work ONLY on tests (+ minimal DI seams where
strictly needed). Do NOT refactor product behavior.

## Read first (in order)
1. `docs/TASK_TODO.md` § T149 (scope + priorities)
2. Existing test patterns: `apps/desktop/src/main/agents/agent-file-events.test.ts`
   (in-memory libsql DB pattern), `apps/desktop/src/main/pipeline/state-machine.test.ts`
3. The targets: `main/db/migrations.ts` + `db/migration-sets/`, `main/pipeline/executor.ts`,
   `main/agents/manager.ts`, `main/mcp/exegol-server.ts`

## Deliverables (priority order — ship what you finish honestly)
1. **Migrations (highest value)**: run the FULL chain (36 base + migration-sets) against a
   fresh `:memory:` DB → assert key tables/columns exist (agents, memories w/ reinforcement
   cols, budgets, github-less ok) → run the chain AGAIN → assert idempotent (no throw, same
   schema). Test file: `main/db/migrations.test.ts`.
2. **Pipeline executor transitions**: exercise `PipelineExecutor` against the T78 state
   machine — valid path (queued→running→step advance→completed), invalid transition rejected
   with warning (not throw), pause/resume, cancel, loop-back guard (max iterations). Mock
   agent spawning at the manager boundary — do NOT spawn real PTYs.
3. **MCP server token lifecycle**: mint token → call accepted; revoke → `-32002`; unknown
   token → `-32002`; accessMode=read agent denied `memory_save` (server-side derivation).
   If the socket server is hard to boot in vitest, test the token registry + gating
   functions directly — say so in the report.
4. **Manager spawn lifecycle** (only if time allows): `runPreflight` already tested — cover
   `buildPtyInvocation` branches (plain shell vs agent, resume paths, hooks file for
   claude-code, env guards DISABLE_AUTO_UPDATE present).

## Rules
- Small DI seams are allowed (extract a function parameter, export a helper) but keep
  product diffs minimal and behavior identical — every product-code line you touch must be
  justified in the report.
- No network, no real PTYs, no real git repos unless a tmp dir fixture is trivial.
- Quality gate before finishing:
  `npx @biomejs/biome check --fix apps/ packages/shared/src/ packages/ui/src/` (clean on your files),
  `npx tsc --noEmit -p apps/desktop/tsconfig.node.json`,
  `npx tsc --noEmit -p apps/desktop/tsconfig.web.json`,
  `cd apps/desktop && npx vitest run` (ALL green).
- Commit on your branch. Do NOT push, do NOT create PRs — the supervisor reviews first.

## Final report format
Files added/changed with 1-line rationale · product-code lines touched (justify each) ·
gate outputs · what you did NOT finish and why.
