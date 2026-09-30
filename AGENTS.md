# AGENTS.md

Instructions for AI coding agents (Codex, Devin, Gemini/Antigravity, OpenCode, Claude Code and
others) working in this repo. Claude Code also loads [CLAUDE.md](CLAUDE.md), which holds the
architecture; read it before changing a subsystem. People: [CONTRIBUTING.md](CONTRIBUTING.md).

## Commands

```bash
bun install && bun run rebuild:native   # setup (Rust + node-pty for Electron)
bun run dev                              # run the app
bun run lint                             # pinned Biome 2.4.7, fails on warnings
bun run typecheck
bun run test && bun run test:shared
cd apps/desktop && npx vitest run src/path/file.test.ts   # one test file
npx -y @biomejs/biome@2.4.7 check --write apps/ packages/shared/src   # format (pinned only)
```

React health: CI runs react-doctor@0.9.14 on the PR's changes; errors fail; fix the cause, no disables.

## Before you finish a change

- Lint, typecheck and tests all pass, with no warnings.
- Docs updated in the same change: remove the task from `docs/TASK_TODO.md` (pending work only),
  add a dated entry to `docs/TASK_COMPLETED/YYMM.md` (what and why), one user-facing line in
  `docs/CHANGELOG.md` `[Unreleased]`; a new feature or shortcut also goes in
  `docs/GUIDES/FEATURES.md` or `KEYBOARD_SHORTCUTS.md`.
- One task per branch and PR.

## Hard rules

- Changing `apps/desktop/src/main/terminal/pty-sidecar-*.ts` or `ring-buffer.ts` → bump
  `SIDECAR_VERSION` in `pty-sidecar-protocol.ts`.
- New tRPC procedure or IPC channel → add it to `apps/desktop/src/preload/capabilities.json`.
- Migrations only in your own `db/migration-sets/<group>.ts`; never edit shipped ones.
- Paths, ids and commands from the renderer are untrusted: validate them in main
  (`assertPathInsideProject`, `isPathAllowed`, zod regex for names).
- Never commit secrets, never put prompts, agent output, keys or home paths in log lines
  (bug reports are public).
- Reuse existing helpers; match the surrounding code; comments only for a non-obvious why.
- Do not run `git push --force`, rewrite history on `main`, or publish releases unless asked.

## Where things are

- `apps/desktop/src/main`: Electron main (agents, IPC routers, DB, PTY sidecar, MCP server)
- `apps/desktop/src/renderer`: React UI (components, stores, hooks)
- `apps/desktop/src/preload`: the IPC bridge and its allowlist
- `packages/shared`: types and zod schemas shared by main and renderer
- `packages/core-rust`: napi-rs native module (ANSI/status parsing, git, search)
- `docs/`: board, changelog, architecture, guides (index in `docs/README.md`)
