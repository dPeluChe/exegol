# Review Notes — Cluster D: Infrastructure (Scheduler + Port Detection)

## Tasks completed
- T05: Internal Scheduler Engine — cron-based scheduler using croner that spawns agent tasks on a cadence. Includes engine singleton, 8 DB queries, tRPC router with 8 endpoints, full UI with task CRUD (create + edit + delete), execution history, sidebar overview.
- T07: Port Detection — detects listening TCP ports via lsof filtered by project CWD, plus config file parsing (package.json scripts, .env, vite/next config). Shows port badges per project in sidebar with click-to-open.

## What I'd improve with more time
- Scheduler: configurable poll timeout (currently hardcoded 10min) and poll interval (5s)
- Scheduler: WebSocket/IPC events instead of polling for agent completion
- Ports: detect Docker container ports
- Extract STATUS_COLORS to shared constant (duplicated in SchedulerSection and ProjectsSection)

## Edge cases not handled
- Scheduler: if the app crashes mid-execution, the scheduled_result won't be recorded (no DB transaction wrapping the full execution lifecycle)
- Ports: lsof on Linux may have different output format (only macOS tested)
- Ports: lsof requires no special permissions on macOS but may need sudo on some Linux distros
- Ports: CWD resolution via `lsof -p <pid>` adds N subprocess calls per detected port (mitigated by Promise.all parallelism)

## Shared file conflicts risk
Files touched that other clusters may also modify:
- `router.ts`: added `scheduler: schedulerRouter` (line 12)
- `queries.ts`: added scheduler section (lines 345-483) — new functions only, no existing code modified
- `use-trpc.ts`: added Scheduler hooks (lines 162-232) and Ports hook (lines 234-251) — appended before App Info section
- `index.ts`: added 2 lines for scheduler lifecycle (line 116 start, line 149 stop)
- `resources.ts` (procedure): added `ports` query (lines 24-26)
- `ProjectsSection.tsx`: added PortBadges component (lines 52-99) and one line in expanded view (line 121)
- `shared/types/scheduler.ts`: added `ScheduledTaskCreate` type (lines 19-26)

## Performance notes
- Scheduler polling uses 5s interval with 10-minute timeout cap — prevents infinite loops
- Concurrent execution guard (runningTasks Set) — prevents duplicate agent spawns
- Port detection: lsof with 5s timeout, CWD checks parallelized via Promise.all
- Sidebar port badges poll every 15s (ports don't change frequently)
- Scheduler tasks list polls every 10s

## New files created
- `apps/desktop/src/main/scheduler/engine.ts` — SchedulerEngine class with cron job management
- `apps/desktop/src/main/ipc/procedures/scheduler.ts` — tRPC router for scheduler CRUD
- `apps/desktop/src/main/system/ports.ts` — port detection (runtime CWD-filtered + config parsing)

## New DB migrations
- None — uses existing migration 005 tables (scheduled_tasks, scheduled_results)

## New tRPC routes
- `scheduler.list` — list all scheduled tasks, optionally filtered by projectId
- `scheduler.get` — get single scheduled task by id
- `scheduler.create` — create task with cron validation
- `scheduler.update` — update task fields, re-register cron if expression changes
- `scheduler.delete` — delete task and stop cron job
- `scheduler.toggle` — enable/disable task
- `scheduler.results` — list execution history for a task
- `scheduler.runNow` — trigger immediate execution (fire-and-forget with .catch)
- `resources.ports` — detect listening ports for a project path
