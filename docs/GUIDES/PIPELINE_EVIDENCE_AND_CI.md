# Pipeline evidence and CI

Pipeline runs record a Git tree before setup and agent execution. Each agent step records its own tree before spawning. The evaluator receives the cumulative run diff; step results receive only that step's changes, including committed changes, deletions, and new files. Existing edits at startup are excluded from the run diff. Ignored files are excluded.

Snapshots use a temporary index, leaving the user's staging untouched. Git references under `refs/exegol/pipelines/<run-id>/` retain baseline objects locally. SQLite stores the evidence directory and baseline reference; step references are stored with step results. These references remain for historical evidence and are not pushed by ordinary branch pushes.

A baseline capture failure pauses the pipeline before starting an agent. Runs without a recorded baseline, including older paused runs, require a new run. Evidence capture has a 30-second timeout per Git command and a 16 MiB output limit. Capture errors remain visible as unavailable evidence, not empty successful diffs. Concurrent edits in the same working directory are included, so use an isolated worktree when attribution matters.

`bun run lint` invokes Biome directly for desktop, shared, and UI TypeScript sources and fails on warnings. It no longer invokes an empty Turbo lint task. CLI sources and Rust are outside this Biome scope.

`.github/workflows/ci.yml` runs on pull requests, pushes to main, and manual dispatch. On macOS it installs the frozen Bun lockfile, checks lint and desktop TypeScript, runs desktop/shared/Rust tests, and builds the application. Action references are pinned to commit hashes. CI does not package, sign, publish, or configure branch protection.

Run the same checks locally:

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run test:shared
cargo test --locked --manifest-path packages/core-rust/Cargo.toml
bun run build
```
