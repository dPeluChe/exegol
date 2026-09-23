#!/bin/sh
# Stop a stuck `bun run dev` Electron. Matches only the dev app ("Electron ."),
# never the PTY sidecar or MCP shim, so agent sessions stay alive.
PATTERN='node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \.( |$)'
if ! pgrep -f "$PATTERN" >/dev/null; then echo "no dev Electron running"; exit 0; fi
pkill -f "$PATTERN"
sleep 2
# A frozen main thread ignores TERM
pgrep -f "$PATTERN" >/dev/null && pkill -9 -f "$PATTERN" && echo "forced (was frozen)"
echo "dev Electron stopped; sidecar and agent sessions left running"
