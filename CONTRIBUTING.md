# Contributing to Exegol

Thanks for helping. This guide is for people; AI agents working in this repo follow
[AGENTS.md](AGENTS.md) (same rules, shorter). Architecture and conventions live in
[CLAUDE.md](CLAUDE.md).

## Setup

Prerequisites: [Bun](https://bun.sh/) 1.2+, [Node.js](https://nodejs.org/) 22 (20+ works),
[Rust](https://rustup.rs/) stable (the native module), git, and at least one agent CLI
(`claude`, `codex`, `agy`, `devin`...). macOS is the main platform; Linux builds in CI.

```bash
git clone https://github.com/dPeluChe/exegol.git && cd exegol
bun install
bun run rebuild:native   # core-rust + node-pty for Electron
bun run dev              # full pipeline; bun run dev:ui skips Rust (JS fallback, faster)
```

## The loop: one task, one PR

1. **Pick or file a task** in [docs/TASK_TODO.md](docs/TASK_TODO.md). Work that is not there
   yet gets a line there first.
2. **Branch from `main`**: `fix/…`, `feat/…`, `perf/…`, `build/…`, `docs/…`, `refactor/…`.
3. **Change the code** the way the surrounding code is written: reuse the helper a few files over
   before writing a new one, comments only for a non-obvious *why*.
4. **Pass the gates** (all green, no warnings):
   ```bash
   bun run lint             # pinned Biome 2.4.7, fails on warnings
   bun run typecheck
   bun run test && bun run test:shared
   cd packages/core-rust && cargo test && cargo clippy   # if you touched Rust
   ```
   Format with the pinned version only: `npx -y @biomejs/biome@2.4.7 check --write apps/ packages/shared/src`
   (an unpinned `npx biome` pulls the latest and reformats everything).
   One test file: `cd apps/desktop && npx vitest run src/path/to/file.test.ts`.
5. **Update the docs in the same PR**:
   - `docs/TASK_TODO.md`: remove what you finished (it holds pending work only)
   - `docs/TASK_COMPLETED/YYMM.md`: a dated entry, what changed and *why*, newest first
   - `docs/CHANGELOG.md` `[Unreleased]`: one line per user-visible change (Added / Changed / Fixed)
6. **Open the PR** with the template, then squash-merge. Commit messages follow
   conventional commits (`fix(terminal): …`).

## Rules that are easy to miss

- **PTY sidecar**: it outlives the app on purpose. If you change anything it bundles
  (`pty-sidecar-*.ts`, `ring-buffer.ts`), bump `SIDECAR_VERSION` in `pty-sidecar-protocol.ts`,
  or the running sidecar keeps the old code. A bump restarts every live terminal on update.
- **Database**: add migrations only to your group's file in `apps/desktop/src/main/db/migration-sets/`;
  never edit another group's set or a shipped migration.
- **IPC**: a new tRPC procedure or channel must be added to `apps/desktop/src/preload/capabilities.json`
  (a parity test enforces it). Paths from the renderer go through `assertPathInsideProject` /
  `isPathAllowed`; never trust a path, id or command string that crosses IPC.
- **React**: derive state instead of syncing it, TanStack Query for data (no fetching in
  `useEffect`), `key` to reset. Details in CLAUDE.md.
- **Error filters**: when you match an error by its text, test it against the real message.
- **Bug reports are public**: Exegol's own log lines never carry prompts, agent output, keys or
  home paths; `redact()` covers third-party text.
- **No secrets** in code, docs, tests or logs, and never in a commit.

## Releases

Maintainers cut releases: [docs/GUIDES/RELEASE.md](docs/GUIDES/RELEASE.md) (version bump,
notarized macOS build, Linux packages from CI, GitHub release, auto-update).

## Reporting bugs

In the app: the bug button in the title bar collects redacted diagnostics for you to review
before anything is sent. Otherwise open a GitHub issue with steps, what you expected and the
app version.
