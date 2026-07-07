# T20 — Activity Feed

## Inspiration Source
- **Repo**: Mission Control (`github.com/builderz-labs/mission-control`)
- **Files studied**: `src/components/panels/activity-feed-panel.tsx`, `src/lib/use-server-events.ts`
- **Pattern applied**: Timeline with type icons, grouped by day with dividers, filter by event type
- **Repo**: Uptime Kuma (`github.com/louislam/uptime-kuma`)
- **Files studied**: `server/server.js`
- **Pattern applied**: Heartbeat/notification patterns for event tracking

## What Changed
- `main/db/migrations.ts` — Added migration 013: `activities` table (id, type, entity_type, entity_id, project_id, description, created_at) with indexes
- `main/db/queries/activities.ts` — New file: `insertActivity()`, `listActivities()` with filtering
- `main/db/queries.ts` — Re-exported activities module
- `main/ipc/procedures/activities.ts` — New file: `activitiesRouter` with `list` endpoint (filters: projectId, type, limit, since)
- `main/ipc/router.ts` — Registered `activities` router
- `main/agents/manager.ts` — Added activity logging on agent spawn, completion, failure, and manual stop (non-fatal try/catch)
- `renderer/hooks/use-trpc.ts` — Added `Activity` type and `useActivities()` hook
- `renderer/components/workspace/sections/ActivitySection.tsx` — New component:
  - Scrollable timeline with type-specific icons and colors
  - Filter by event type (All, Spawned, Completed, Failed, Stopped, Scheduled, Port)
  - Grouped by day with sticky date dividers
  - Relative timestamps ("just now", "5m ago", "2h ago")
- `renderer/components/workspace/WorkspaceTabs.tsx` — Added "Activity" tab (Rss icon)
- `renderer/components/workspace/WorkspaceView.tsx` — Added ActivitySection rendering

## Architecture Decisions
- **Non-fatal logging**: Activity insertion is wrapped in try/catch so it never blocks agent operations. Activities are best-effort observability.
- **DB-backed, not in-memory**: Activities persist across app restarts. Could be extended with TTL cleanup via background job.
- **6 event types**: `agent_spawned`, `agent_stopped`, `agent_completed`, `agent_failed`, `scheduler_fired`, `port_detected`. Scheduler and port events are wired for future use.
- **Day grouping with sticky headers**: Inspired by Mission Control's timeline view. Sticky date dividers help orient the user in long activity lists.

## How to Test
- Open Activity tab
- Spawn an agent — verify "agent spawned" event appears immediately
- Stop the agent — verify "agent stopped/completed/failed" event appears
- Use filter buttons to filter by type
- Verify day grouping works correctly (Today, Yesterday, etc.)
