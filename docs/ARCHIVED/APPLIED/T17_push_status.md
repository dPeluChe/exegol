# T17 — Push-First Agent Status Updates

## Inspiration Source
- **Repo**: Mission Control (`github.com/builderz-labs/mission-control`)
- **Files studied**: `src/lib/use-server-events.ts`, `src/lib/use-smart-poll.ts`
- **Pattern applied**: SSE event dispatch to Zustand store + visibility-aware polling fallback
- **Repo**: Uptime Kuma (`github.com/louislam/uptime-kuma`)
- **Files studied**: `server/server.js`
- **Pattern applied**: Socket.io broadcast to all connected clients on status change

## What Changed
- `main/agents/manager.ts` — Added `broadcastAgentStatus()` that sends IPC events on every status transition (spawning→running→completed/failed)
- `main/system/resources.ts` — Added `broadcastMetrics()` that pushes system metrics to renderer every 10s, plus `metricsHistory` buffer (last 30 data points) for sparkline charts
- `main/ipc/procedures/resources.ts` — Added `history` endpoint for metrics snapshots
- `preload/index.ts` — Exposed `onAgentStatus(callback)` and `onMetrics(callback)` via contextBridge
- `renderer/env.d.ts` — Added `AgentStatusEvent` and `SystemMetricsEvent` type declarations
- `renderer/stores/agents.ts` — Added `startAgentStatusPush()` / `stopAgentStatusPush()` functions that subscribe to IPC push events and update Zustand store
- `renderer/contexts/ProjectContext.tsx` — Mounts push event subscription on startup
- `renderer/hooks/use-trpc.ts` — Reduced polling intervals (agents: 10s→30s, agent detail: 2s→10s, system metrics: 10s→30s) since push events handle real-time updates

## Architecture Decisions
- **IPC over WebSocket/SSE**: Electron's IPC is the natural push channel — no need for a separate SSE or WebSocket server. `BrowserWindow.webContents.send()` broadcasts to all renderer windows.
- **Dual-layer approach**: Push events provide real-time status updates. tRPC polling at reduced intervals provides eventual consistency fallback and initial hydration on mount.
- **Non-destructive merge**: Push events only update `status` and `currentStep` on existing agents in the store. New agents are still hydrated via tRPC query.

## How to Test
- Spawn an agent and observe that the status badge updates immediately (no 10s delay)
- Open Resources tab and see live metrics updating every 10s via push
- Kill and restart the app — agents should hydrate from DB on mount (tRPC fallback)
