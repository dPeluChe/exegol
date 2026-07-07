# T34 — Agent Task Queue (Parallel Execution)

## Inspiration Source
- **Repo**: gstack (`github.com/garrytan/gstack`)
- **Files studied**: `ARCHITECTURE.md` (Conductor pattern for 10+ parallel sessions), `CLAUDE.md` (workflow philosophy: "completeness is cheap with AI"), `browse/src/config.ts` (state file for tracking concurrent processes)
- **Pattern applied**: Queue executor polling loop, configurable concurrency limit per project, state persistence in DB
- **Repo**: Stoneforge (`github.com/stoneforge-ai/stoneforge`)
- **Files studied**: `packages/smithy/src/services/dispatch-daemon.ts`
- **Pattern applied**: Single `polling` flag as concurrency guard, sequential phase ordering, `PollResult` uniform shape
- **Repo**: DeerFlow (`github.com/bytedance/deer-flow`)
- **Files studied**: `backend/packages/harness/deerflow/subagents/executor.py`
- **Pattern applied**: `MAX_CONCURRENT_SUBAGENTS = 3` default, separate scheduler/execution pools, terminal-state-only cleanup
- **Repo**: Mission Control (`github.com/builderz-labs/mission-control`)
- **Files studied**: `src/app/api/tasks/queue/route.ts`, `tests/task-queue.spec.ts`
- **Pattern applied**: Priority-based SQL ordering with CASE WHEN, SELECT + conditional UPDATE retry pattern, `QueueReason` response enum

## What Changed
- **NEW** `apps/desktop/src/main/agents/queue.ts` — `QueueExecutor` singleton: polls task_queue table every 5s, dispatches tasks respecting concurrency limit and dependencies, registers completion callbacks to unblock dependents
- **NEW** `apps/desktop/src/main/db/queries/queue.ts` — addToQueue, getQueueTask, listQueueTasks, listQueuedTasks, countRunningQueueTasks, updateQueueTaskStatus, cancelQueueTask, unblockDependents, updateQueueTaskPriority
- **NEW** `apps/desktop/src/main/ipc/procedures/queue.ts` — tRPC router: list, get, add, cancel, updateStatus
- **NEW** `apps/desktop/src/renderer/components/workspace/sections/QueueSection.tsx` — Queue panel with task list, add dialog, cancel button, status badges, priority display
- **MODIFIED** `apps/desktop/src/renderer/components/agents/AgentLauncher.tsx` — spawn/queue mode toggle (Zap/ListOrdered icons), "Add to queue" option
- **MODIFIED** `apps/desktop/src/main/index.ts` — QueueExecutor lifecycle (start/stop)
- **MODIFIED** `apps/desktop/src/renderer/components/workspace/WorkspaceTabs.tsx` — added "Queue" tab
- **MODIFIED** `apps/desktop/src/renderer/components/workspace/WorkspaceView.tsx` — renders QueueSection
- **MODIFIED** `packages/shared/src/types/agent.ts` — QueueTask, QueueTaskStatus types
- **NEW** Migration 016: `task_queue` table with indexes

## Architecture Decisions
- **Polling executor over event-driven**: simpler for Electron's single-process model. 5s interval is responsive enough for task queues. Single-flight guard prevents overlapping polls
- **Per-project concurrency limit**: default 3, configurable via settings DB. Matches DeerFlow's `MAX_CONCURRENT_SUBAGENTS` pattern
- **Priority as integer**: higher = first. SQL CASE WHEN ordering for status groups (running > queued > blocked > completed). Simple and extensible
- **Dependency via `depends_on` column**: single parent dependency (comma-separated for multiple). Completed tasks auto-unblock dependents
- **Spawn/queue mode toggle**: toggle button in AgentLauncher header (Zap = spawn, ListOrdered = queue) keeps the UI simple without modal dialogs

## How to Test
- Open the Queue workspace tab — should show empty state
- Click "Add Task" — fill in prompt, CLI, priority → task appears as "queued"
- Add multiple tasks — they execute up to the concurrency limit (default 3)
- Add task with dependency → shows as "blocked" until dependency completes
- In AgentLauncher, click the ListOrdered icon to switch to queue mode → clicking an agent adds to queue instead of spawning
- Cancel a queued task → status changes to "cancelled"
