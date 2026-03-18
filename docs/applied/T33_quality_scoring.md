# T33 — Quality Scoring for Agent Output

## Inspiration Source
- **Repo**: gstack (`github.com/garrytan/gstack`)
- **Files studied**: `test/helpers/eval-store.ts`, `test/helpers/llm-judge.ts`, `test/skill-validation.test.ts`, `ARCHITECTURE.md`
- **Pattern applied**: 3-tier test pyramid (free static → E2E → LLM-as-judge), non-fatal observability, machine-readable diagnostics, weighted composite scoring

Also studied:
- **ClawWork** (`github.com/HKUDS/ClawWork`): 4-dimension weighted rubric (completeness 40%, correctness 30%, quality 20%, domain 10%), quality cliff threshold
- **Mission Control** (`github.com/builderz-labs/mission-control`): Quality review gates pattern

## What Changed
- `apps/desktop/src/main/agents/scoring.ts` — New scoring engine with 3-tier approach
- `apps/desktop/src/main/agents/manager.ts` — Hook scoring on agent exit (non-fatal)
- `apps/desktop/src/main/db/migrations.ts` — Migration 013: `agent_scores` table
- `apps/desktop/src/main/ipc/procedures/scoring.ts` — tRPC router for scoring queries
- `apps/desktop/src/main/ipc/router.ts` — Register scoring router
- `apps/desktop/src/renderer/hooks/use-trpc.ts` — React hooks for scoring data
- `apps/desktop/src/renderer/components/workspace/sections/ScoringSection.tsx` — Scoring dashboard UI
- `apps/desktop/src/renderer/components/workspace/WorkspaceTabs.tsx` — Added "Scoring" tab
- `apps/desktop/src/renderer/components/workspace/WorkspaceView.tsx` — Wire ScoringSection

## Architecture Decisions
- **3-tier scoring**: Tier 1 parses stdout for free signals (files_changed, compiles, tests_pass, task_completed). Tier 2 captures structured metrics (exit_reason, turns_used, tokens_spent). Tier 3 (LLM-as-judge) is stubbed for future implementation behind API key gate.
- **Weighted composite score**: Adopted ClawWork's weighted rubric approach — completeness (40%), correctness (30%), efficiency (20%), quality (10%). Score is 0.0–1.0.
- **Non-fatal**: All scoring wrapped in try/catch. Scoring failure never blocks agent completion. Follows gstack's "non-fatal observability" principle.
- **Separate table**: `agent_scores` is 1:1 with agents via `agent_id` PK. Avoids polluting the agents table with score columns. Enables efficient aggregation queries.
- **Machine-readable exit_reason**: Enum ('success', 'failure', 'stopped', 'timeout', 'unknown') enables jq/SQL filtering.

## How to Test
1. Start the app, select a project
2. Spawn an agent (e.g., Claude Code with a simple task)
3. Wait for the agent to complete
4. Navigate to the "Scoring" tab in workspace
5. Verify: score card appears with overall score, tier 1 signals (build/tests/done), file count, turns
6. Verify: aggregate stats show in the overview cards
7. Verify: CLI performance breakdown table shows the agent's CLI type
