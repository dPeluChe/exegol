# T18 — Resources Dashboard (Real Metrics UI)

## Inspiration Source
- **Repo**: Mission Control (`github.com/builderz-labs/mission-control`)
- **Files studied**: `src/components/panels/agent-squad-panel-phase3.tsx`, `src/store/index.ts`
- **Pattern applied**: Per-agent metrics grid with threshold indicators, Zustand subscribeWithSelector
- **Repo**: Uptime Kuma (`github.com/louislam/uptime-kuma`)
- **Files studied**: `src/pages/DashboardHome.vue`
- **Pattern applied**: Dashboard layout with status indicators and progress bars

## What Changed
- `renderer/components/workspace/sections/ResourcesSection.tsx` — Full rewrite:
  - System overview: CPU%, RAM used/total, disk used/total with progress bars and threshold colors
  - Inline SVG sparkline charts for CPU and RAM (last 30 data points)
  - Per-agent process table with PID, CPU%, RAM MB, uptime
  - Threshold indicators: green <70%, yellow 70-90%, red >90%
  - Live metrics via push events (T17 pattern) with tRPC fallback
- `main/system/resources.ts` — Added `MetricsSnapshot` type, `metricsHistory` array (30 points), `getMetricsHistory()` export
- `main/ipc/procedures/resources.ts` — Added `history` endpoint
- `renderer/hooks/use-trpc.ts` — Added `useMetricsHistory()` hook and `MetricsSnapshot` type

## Architecture Decisions
- **Inline SVG sparklines** instead of recharts: Zero dependency, minimal bundle size, sufficient for simple trend visualization. Each sparkline is ~10 lines of SVG with gradient fill.
- **Push-first metrics**: Live metrics come from `onMetrics` push events. tRPC polling is reduced to 30s fallback. Sparkline data from local push history takes priority over server history.
- **Threshold colors**: Consistent color language (green/yellow/red) across progress bars, text values, and sparkline strokes.

## How to Test
- Open Resources tab with a project selected
- Verify CPU, RAM, disk show real values with colored progress bars
- Spawn an agent — verify it appears in the per-agent process table with CPU/RAM metrics
- Wait 30+ seconds — verify sparkline charts show trend data
