# Contributing to Exegol

Thanks for helping. This guide is for people; AI agents working in this repo follow
[AGENTS.md](AGENTS.md) (same rules, shorter). Architecture and conventions live in
[CLAUDE.md](CLAUDE.md). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
Security problems go through [SECURITY.md](SECURITY.md), never a public issue.

¿Hablas español? Ve a [En español](#en-español) al final.

## Setup

Prerequisites: [Bun](https://bun.sh/) 1.2.23+, [Node.js](https://nodejs.org/) 22 (20+ works),
[Rust](https://rustup.rs/) stable (the native module), git, and at least one agent CLI
(`claude`, `codex`, `agy`, `devin`...). macOS is the main platform; Linux builds in CI. On Linux
install `build-essential python3 libsecret-1-dev` first.

Fork the repo on GitHub, then:

```bash
git clone https://github.com/<you>/exegol.git && cd exegol
bun install
bun run rebuild:native   # core-rust + node-pty for Electron
bun run dev              # full pipeline; bun run dev:ui skips Rust (JS fallback, faster)
```

Faster loops: `bun run dev:ui` (skips Rust), `bun run kill:dev` for a stuck dev window,
`bun run dev:fresh` after changing the PTY sidecar. Logs: `~/.exegol/logs/` (the sidecar writes
`sidecar.log` there).

## Where to start

**Get to know the app first.** Run it, add a project, open a shell and an agent, split a pane,
pin a session to the Dashboard. The welcome tour (command palette → Show welcome tour), the
feature list in [docs/GUIDES/FEATURES.md](docs/GUIDES/FEATURES.md) and `Cmd+/` cover the rest.

**Pick something from the board**, [docs/TASK_TODO.md](docs/TASK_TODO.md):

| Section | What it is | Good for |
|---------|------------|----------|
| Verify live | Recent changes nobody has checked in the running app | A first contribution: try each one, report or fix what breaks |
| Priority Order | The next tasks, in order | Small to medium fixes |
| Active Backlog (T-numbers) | Larger features with a design | Ask in an issue before starting one |

**Find the code.** Architecture and conventions are in [CLAUDE.md](CLAUDE.md); the usual entry
points:

| You want to change | Look in |
|--------------------|---------|
| Something you see in the UI | `apps/desktop/src/renderer/components/` (by area: `layout/`, `workspace/`, `terminal/`, `settings/`) |
| Data from the main process | a tRPC procedure in `apps/desktop/src/main/ipc/procedures/`, its hook in `renderer/hooks/use-trpc*.ts`, and an entry in `preload/capabilities.json` |
| The database | a migration in your group's `main/db/migration-sets/` file and a query module in `main/db/queries/` |
| How an agent CLI starts or is detected | `main/agents/registry.ts` (providers), `manager.ts`, `spawn-env.ts` |
| Terminal behavior | `renderer/components/terminal/` (xterm) and `main/terminal/` (PTY, sidecar) |
| Keyboard shortcuts | `renderer/hooks/use-hotkeys.ts`, `renderer/lib/shortcuts.ts` and [KEYBOARD_SHORTCUTS.md](docs/GUIDES/KEYBOARD_SHORTCUTS.md) |
| Native parsing, git, search | `packages/core-rust/` |

## The loop: one task, one PR

1. **Pick or file a task** in [docs/TASK_TODO.md](docs/TASK_TODO.md). Work that is not there
   yet gets a line there first. From outside the project, an issue (bug or feature template)
   works too; for anything larger than a fix, wait for a reply before you build it.
2. **Branch from `main`**: `fix/…`, `feat/…`, `perf/…`, `build/…`, `docs/…`, `refactor/…`.
3. **Change the code** the way the surrounding code is written: reuse the helper a few files over
   before writing a new one, comments only for a non-obvious *why*.
4. **Pass the gates** (all green, no warnings):
   ```bash
   bun run lint             # pinned Biome 2.4.7, fails on warnings
   bun run typecheck
   bun run test && bun run test:shared
   bun run build            # CI builds too
   cd packages/core-rust && cargo check && cargo test && cargo clippy   # if you touched Rust
   ```
   Format with the pinned version only: `npx -y @biomejs/biome@2.4.7 check --write apps/ packages/shared/src`
   (an unpinned `npx biome` pulls the latest and reformats everything).
   One test file: `cd apps/desktop && npx vitest run src/path/to/file.test.ts`.
   React health: CI runs react-doctor on what your PR changes (errors fail it, new warnings show
   in the log). Locally: `cd apps/desktop && npx -y react-doctor@0.9.14 . --yes --scope changed --base main`.
   Fix the cause; never add a disable or ignore to make a finding go away.
5. **Update the docs in the same PR**:
   - `docs/TASK_TODO.md`: remove what you finished (it holds pending work only)
   - `docs/TASK_COMPLETED/YYMM.md`: a dated entry, what changed and *why*, newest first
   - `docs/CHANGELOG.md` `[Unreleased]`: one line per user-visible change (Added / Changed / Fixed)
   - A new or changed feature or shortcut: `docs/GUIDES/FEATURES.md` / `KEYBOARD_SHORTCUTS.md`,
     and the README highlights if it is one of them (`README.md` and `README.es.md`)
6. **Open the PR** with the template; it is squash-merged, so the PR title becomes the commit.
   Titles and commits follow conventional commits, `type(scope): what changed`, for example
   `fix(terminal): …` or `feat(panes): …`. Say in the PR what you checked and what you did not.

## Rules that are easy to miss

- **PTY sidecar**: it outlives the app on purpose. If you change anything it bundles
  (`pty-sidecar-*.ts`, `ring-buffer.ts`, `lib/ndjson.ts`; the list is in the `SIDECAR_VERSION`
  comment), bump `SIDECAR_VERSION` in `pty-sidecar-protocol.ts`, or the running sidecar keeps
  the old code, for released users too. A bump restarts every live terminal on update.
- **Database**: add migrations only to your group's file in `apps/desktop/src/main/db/migration-sets/`
  (new work goes in `wave3.ts`, ids `w3_NNN_…`); never edit another group's set or a shipped
  migration.
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
before anything is sent. Otherwise open an issue with the bug report template: steps, what you
expected and the app version. Issues are public: never paste prompts, agent output, API keys or
private paths.

## En español

Las contribuciones en español son bienvenidas: issues, PRs y comentarios. El código, sus
comentarios, los commits y los docs de `docs/` van en inglés; si se te complica, escribe en
español y lo resolvemos en la revisión. Lo esencial:

- **Instalación**: haz fork, `bun install`, `bun run rebuild:native` y `bun run dev` (los
  requisitos están arriba, en Setup).
- **Validaciones** antes del PR, todas en verde y sin warnings: `bun run lint` (Biome fijo en
  2.4.7; para formatear usa solo `npx -y @biomejs/biome@2.4.7 check --write apps/ packages/shared/src`),
  `bun run typecheck`, `bun run test && bun run test:shared` y `bun run build`; si tocaste Rust,
  `cargo check`, `cargo test` y `cargo clippy` en `packages/core-rust`.
- **Una tarea por PR**, con los docs en el mismo PR: quitar la tarea de `docs/TASK_TODO.md`, una
  entrada con fecha en `docs/TASK_COMPLETED/YYMM.md` y una línea en `docs/CHANGELOG.md`
  `[Unreleased]` si el cambio se nota para quien usa la app.
- **Sidecar del PTY**: si cambias un archivo que empaqueta (la lista está en el comentario de
  `SIDECAR_VERSION`, en `pty-sidecar-protocol.ts`), sube `SIDECAR_VERSION`.
- **Migraciones**: solo en el archivo de tu grupo dentro de `db/migration-sets/`; nunca edites
  una migración ya publicada.
- **Commits**: conventional commits (`fix(terminal): …`); el PR se fusiona con squash.
- **Seguridad**: nunca abras un issue público para una vulnerabilidad; sigue
  [SECURITY.md](SECURITY.md).

