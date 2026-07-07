# T26 — Dependency-Aware Scheduler

## Inspiration Source
- **Repo**: Stoneforge (`github.com/stoneforge-ai/stoneforge`)
- **Files studied**: `packages/smithy/src/services/dispatch-daemon.ts`, `dispatch-service.ts`
- **Pattern applied**: Sequential phase ordering in poll cycle. Single `polling` flag as concurrency guard. EventEmitter for external observers. `PollResult` uniform shape.
- **Repo**: DeerFlow (`github.com/bytedance/deer-flow`)
- **Files studied**: `backend/packages/harness/deerflow/subagents/executor.py`
- **Pattern applied**: `MAX_CONCURRENT_SUBAGENTS = 3` as configurable constant. Separate scheduler/execution separation. Terminal-state-only cleanup.

## What Changed
- **MODIFIED** `apps/desktop/src/main/scheduler/engine.ts` — added dependency resolution, concurrency limit (configurable, default 3), cycle detection via DFS
- **MODIFIED** `apps/desktop/src/main/db/queries/scheduler.ts` — `createScheduledTask` and `updateScheduledTask` support `dependsOn` field
- **MODIFIED** `apps/desktop/src/main/db/queries/helpers.ts` — `mapScheduledTaskRow` includes `dependsOn`
- **MODIFIED** `apps/desktop/src/main/ipc/procedures/scheduler.ts` — create/update schemas accept `dependsOn`, cycle detection on update
- **MODIFIED** `apps/desktop/src/renderer/components/workspace/sections/SchedulerSection.tsx` — dependency field in task form, dependency display in task rows
- **MODIFIED** `packages/shared/src/types/scheduler.ts` — `ScheduledTask` and `ScheduledTaskCreate` include `dependsOn`
- **NEW** Migration 015: `depends_on` column on `scheduled_tasks`

## Architecture Decisions
- **`dependsOn` as comma-separated string or JSON array**: simple schema, parsed at runtime. No need for a join table since dependency graphs are small (tens of tasks, not thousands)
- **Dependency check = last_result_status === 'success'**: a dependency is satisfied when it has run successfully at least once. This is simpler than tracking per-execution-instance dependencies
- **Concurrency limit stored in settings table**: `scheduler_max_concurrent` setting, default 3. Loaded once on engine start, updatable via `setMaxConcurrent()`
- **Cycle detection via DFS**: lightweight, runs only on update (not on every poll). Prevents user from creating circular dependencies through the UI

## How to Test
- Create task A, then task B with `depends_on: <A's id>`
- Task B should not fire until A has `last_result_status: 'success'`
- Set max concurrent to 1 in settings, schedule 3 tasks — only 1 runs at a time
- Try to create a cycle (A depends on B, B depends on A) — should get an error
- Task rows show dependency info in yellow text
