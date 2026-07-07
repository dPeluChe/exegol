# T37 — Scrollback & Persistence Optimization

## Inspiration Source
- **Repo**: T3 Code (`github.com/pingdotgg/t3code`)
- **Files studied**: `apps/server/src/terminal/Layers/Manager.ts`
- **Pattern applied**: Async debounced persistence, matched scrollback limits between frontend and backend

## What Changed
- Modified `main/terminal/pty-host.ts` — async throttled writes (5s max frequency) using `fs/promises`
- Modified `renderer/components/terminal/TerminalInstance.tsx` — reduced scrollback from 10,000 to 5,000 lines
- Removed `writeFileSync` from scrollback path — all disk I/O is now async
- Headless emulator snapshots written to `.log` files (crash recovery), renderer serialized state to `.serialized` (final state)

## Architecture Decisions
- Throttle (not debounce): writes at most once per 5s during active output. Debounce would never fire during continuous output.
- 5K scrollback matched: renderer xterm and headless emulator both use 5,000 lines. Eliminates previous mismatch (10K lines vs 1MB bytes).
- Async writes via fs/promises: eliminates the writeFileSync that blocked main process for 1-5ms per flush.
- Worst case data loss on crash: ~5s (vs previous 30s with synchronous writes).
- Scrollback accumulation moved to subprocess via headless emulator — no more raw buffer management in manager.ts.

## How to Test
1. Spawn an agent, verify scrollback persists after agent stops
2. Force-kill the app during agent run, restart — verify most output is preserved (up to ~5s loss)
3. Monitor main process CPU — should show no blocking spikes during heavy agent output
4. Verify file sizes in `~/.config/exegol/scrollback/` are reasonable (~100-500KB per session)
