# T36 — Headless Emulator + State Recovery

## Inspiration Source
- **Repo**: Superset (`github.com/superset-sh/superset`)
- **Files studied**: `terminal-host/headless-emulator.ts`, `terminal-host/session.ts`
- **Pattern applied**: Server-side @xterm/headless for state tracking, SerializeAddon snapshots, OSC-7 CWD parsing

## What Changed
- Created `main/terminal/headless-emulator.ts` — @xterm/headless wrapper with SerializeAddon and CWD tracking
- Integrated into `main/terminal/pty-host.ts` — each session has a HeadlessEmulator instance
- Modified `main/ipc/procedures/scrollback.ts` — live snapshot from headless emulator as first priority
- Added `@xterm/headless` and `@xterm/addon-serialize` to dependencies

## Architecture Decisions
- Headless terminal in main process mirrors renderer terminal state independently
- SerializeAddon generates full snapshots (ANSI + cursor + attributes) — same quality as renderer
- OSC-7 parsing enables CWD tracking without polling
- Live snapshot priority: running agents return headless state directly via scrollback.get(), no file I/O needed
- 5K scrollback (matched with renderer) keeps memory bounded at ~500KB per session

## How to Test
1. Start an agent, let it produce output
2. Reload the renderer (Cmd+R in dev) — terminal should restore from headless snapshot
3. Kill app (force quit), restart — scrollback should be available from periodic disk snapshots
4. Check CWD tracking: `echo $'\e]7;file://localhost/tmp\a'` in a shell, verify via getPtyHost().getCwd()
