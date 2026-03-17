# Exegol

Electron + React + Rust desktop app for orchestrating AI coding agents (Claude Code, Codex, etc.).

## Tech Stack

Electron, React 18, TailwindCSS, Rust (napi-rs), libSQL, tRPC, xterm.js, Bun, Turborepo

## Monorepo Structure

```
apps/desktop/        # Electron app (main + renderer processes)
packages/shared/     # Shared types, schemas, constants (Zod, TypeScript)
packages/ui/         # Shared React UI components
packages/core-rust/  # Rust native module via napi-rs (git ops, file watching)
```

## Development

```bash
bun install          # Install all dependencies
bun run dev          # Start Electron app in dev mode (Turborepo)
bun run build        # Production build
bun run lint         # Lint with Biome
cargo check          # Type-check Rust code (run inside packages/core-rust)
```

## Architecture Notes

- **tRPC over IPC**: tRPC routers run in the Electron main process and communicate with the renderer via IPC, not HTTP.
- **libSQL**: Uses libSQL (Turso's SQLite fork), not standard better-sqlite3.
- **Agent processes**: AI agents are spawned via `node-pty` as pseudo-terminal processes. Each agent gets its own PTY that streams output to an xterm.js terminal in the renderer.
- **Rust native module**: Git operations (repo info, worktrees, diffs) are implemented in Rust via napi-rs for performance.
- **State management**: Zustand stores in the renderer track agent and terminal state.
