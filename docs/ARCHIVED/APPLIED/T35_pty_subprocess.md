# T35 — PTY Subprocess Isolation + Backpressure

## Inspiration Source
- **Repo**: Superset (`github.com/superset-sh/superset`)
- **Files studied**: `terminal-host/pty-subprocess.ts`, `terminal-host/pty-subprocess-ipc.ts`, `terminal-host/session.ts`, `terminal-host/terminal-host.ts`
- **Pattern applied**: Dedicated child process per PTY with binary framing protocol, output batching, concurrent spawn semaphore

## What Changed
- Created `main/terminal/pty-ipc.ts` — Binary framing protocol (5-byte header: type u8 + length u32 LE)
- Created `main/terminal/pty-subprocess.ts` — Standalone subprocess entry point (ELECTRON_RUN_AS_NODE=1)
- Created `main/terminal/pty-host.ts` — Session manager with spawn semaphore (max 3 concurrent)
- Modified `main/agents/manager.ts` — Replaced direct `pty.spawn()` with `PtyHost.createSession()`
- Modified `main/agents/spawn-env.ts` — Removed obsolete scrollback constants
- Modified `main/index.ts` — Added `getPtyHost().destroyAll()` on app quit
- Modified `electron.vite.config.ts` — Added subprocess as separate build entry

## Architecture Decisions
- Binary framing over JSON: terminal data contains escape sequences that are expensive to JSON-encode. Binary framing has near-zero overhead.
- Output batching (128KB or setImmediate): reduces IPC round-trips by 10-100x under heavy output.
- Kill escalation (SIGTERM -> 2s -> SIGKILL): ensures stuck processes get cleaned up.
- Scoring buffer kept in manager.ts (1MB cap): needed for agent scoring, separate from scrollback persistence.
- Spawn semaphore (max 3): prevents process bomb if many agents queued simultaneously.

## How to Test
1. Spawn a Claude Code agent — verify terminal works normally
2. Spawn 3+ agents simultaneously — verify semaphore queues (no crash)
3. Kill an agent mid-run — verify graceful cleanup
4. Check that blocking output doesn't freeze the UI (run `find / -name "*.ts"` in a shell pane)
