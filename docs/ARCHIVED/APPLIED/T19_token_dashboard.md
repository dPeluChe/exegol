# T19 — Token Usage Dashboard (Cost Tracking)

## Inspiration Source
- **Repo**: Mission Control (`github.com/builderz-labs/mission-control`)
- **Files studied**: `src/components/panels/token-dashboard-panel.tsx`
- **Pattern applied**: Multi-timeframe support, per-model breakdown with cost bars, session cost table
- **Repo**: ClawWork (`github.com/HKUDS/ClawWork`)
- **Files studied**: `src/components/dashboard/`
- **Pattern applied**: Economic metrics display, quality scoring patterns

## What Changed
- `main/db/queries/token-usage.ts` — Added 3 new query functions:
  - `getModelBreakdown()` — Per-model aggregate (input/output tokens, cost, request count)
  - `getAgentCosts()` — Per-agent cost table (total tokens, total cost, avg per session)
  - `getDailyTrend()` — Daily cost/token/request aggregates for trend chart
- `main/ipc/procedures/token-usage.ts` — Added 3 new tRPC endpoints: `modelBreakdown`, `agentCosts`, `dailyTrend`
- `renderer/hooks/use-trpc.ts` — Added hooks: `useModelBreakdown()`, `useAgentCosts()`, `useDailyTrend()`
- `renderer/components/workspace/sections/TokensSection.tsx` — Full rewrite:
  - Summary cards: total cost, input tokens, output tokens, tool calls
  - Period selector (7d / 14d / 30d)
  - Daily cost trend bar chart (inline SVG)
  - Per-model breakdown with cost bars, token counts, pricing info
  - Per-agent cost table with avg cost/session
  - Model pricing catalog (Claude, GPT-4o, Gemini) with prefix matching
  - Scan Logs button retained

## Architecture Decisions
- **Dynamic model pricing catalog** (in-renderer, not DB): Pricing is hardcoded but with prefix matching for model variants. Could be moved to DB in future if users need to customize.
- **Period selector**: 7/14/30 day toggles affect all data queries. Summary card still uses last-24h from existing `useTokenUsageSummary` for backward compat.
- **Inline SVG bar chart** for daily trend: Same zero-dependency approach as T18 sparklines. Bars are auto-sized based on data length.

## How to Test
- Open Token Usage tab with a project selected
- Click "Scan Logs" to import Claude Code JSONL logs
- Verify model breakdown shows per-model cost bars
- Toggle between 7d/14d/30d periods
- Verify daily trend chart shows bars for days with activity
- Verify per-agent cost table shows agents with costs
