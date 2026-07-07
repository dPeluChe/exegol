# T21 — Terminal SerializeAddon for Buffer Persistence

## Inspiration Source
- **Repo**: Tabby (`github.com/Eugeny/tabby`)
- **Files studied**: `tabby-terminal/src/frontends/xtermFrontend.ts` (SerializeAddon usage, `saveState()`/`restoreState()` pattern), `tabby-core/src/services/tabRecovery.service.ts` (recovery token storage), `tabby-terminal/src/features/debug.ts` (serialize to file/clipboard)
- **Pattern applied**: SerializeAddon captures terminal buffer state as ANSI escape sequences. Tabby uses `serialize({ excludeAltBuffer: true, excludeModes: true })` and restores via `xterm.write(serializedState)`. Exegol adopts this exact pattern with renderer-side serialization persisted to disk via tRPC mutation.

## What Changed
- `apps/desktop/src/renderer/components/terminal/TerminalInstance.tsx` — Added `@xterm/addon-serialize`, wrapped in `forwardRef` exposing `TerminalInstanceHandle.serialize()` via `useImperativeHandle`
- `apps/desktop/src/renderer/components/terminal/TerminalPanel.tsx` — Captures serialized state via ref when agent transitions to stopped, persists via `scrollback.saveSerialized` tRPC mutation
- `apps/desktop/src/main/ipc/procedures/scrollback.ts` — Added `saveSerialized` mutation (writes `.serialized` files), updated `get` to prefer serialized state over raw `.log` files
- `apps/desktop/package.json` — Added `@xterm/addon-serialize@^0.14.0`

## Architecture Decisions
- **Renderer-side serialization**: SerializeAddon runs in the renderer (where xterm.js lives), not main process. The serialized state is sent to main via tRPC mutation for disk persistence.
- **Dual-file storage**: `.serialized` files alongside existing `.log` files. `get` prefers serialized (higher fidelity), falls back to raw log (backwards compatible).
- **Non-fatal**: Serialization failures are silently caught — raw scrollback always available as fallback.
- **No main process changes**: `AgentManager` continues capturing raw PTY output for `.log` files (needed for FTS indexing in T23). Serialized state is a renderer-side enhancement.

## How to Test
1. Launch an agent (e.g., Claude Code) and let it produce colored output
2. Stop the agent — check `~/.config/Exegol/scrollback/` for both `{agentId}.log` and `{agentId}.serialized` files
3. Navigate away and back to the stopped agent terminal — should show full colors/formatting
4. Delete the `.serialized` file and reload — should fall back to raw `.log` with same visual result
