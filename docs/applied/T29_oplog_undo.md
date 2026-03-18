# T29 — Oplog / Undo Timeline

## Inspiration Source
- **Repo**: GitButler (`github.com/gitbutlerapp/gitbutler`)
- **Files studied**: `crates/gitbutler-oplog/src/oplog.rs` (snapshot-based sequential log), `crates/gitbutler-oplog/src/entry.rs` (Snapshot, SnapshotDetails, OperationKind enum), `crates/gitbutler-oplog/src/reflog.rs` (GC protection via reflog), `crates/gitbutler-oplog/src/state.rs` (oplog state persistence)
- **Pattern applied**: Operations logged as sequential entries with before/after refs, undo creates new "revert" commit (never force-push), operation type enum

Also studied:
- **Pi** (`github.com/badlogic/pi-mono`): Session tree with id/parentId append-only entries, implicit oplog where session file IS the history

## What Changed
- `packages/core-rust/src/git/types.rs` — Added `RepoSnapshot` napi type
- `packages/core-rust/src/git/mod.rs` — Added `get_repo_snapshot()` and `revert_to_snapshot()` functions. Revert creates a new commit with the target tree on top of current HEAD (safe, never force-pushes)
- `apps/desktop/src/main/db/migrations.ts` — Migration 014: `oplog` table with agent_id, project_id, operation, ref_before, ref_after, description
- `apps/desktop/src/main/db/queries/oplog.ts` — CRUD operations for oplog entries
- `apps/desktop/src/main/db/queries.ts` — Added oplog export
- `apps/desktop/src/main/ipc/procedures/oplog.ts` — tRPC router: listProject, listAgent, undo
- `apps/desktop/src/main/ipc/router.ts` — Registered oplog router
- `apps/desktop/src/main/agents/manager.ts` — Records worktree_create and commit operations in oplog. Captures initial HEAD snapshot on spawn, detects commits on exit by comparing before/after
- `apps/desktop/src/renderer/hooks/use-trpc.ts` — Oplog hooks: useProjectOplog, useAgentOplog, useUndoOplog
- `apps/desktop/src/renderer/components/workspace/sections/OplogSection.tsx` — Timeline UI with operation icons, ref links, undo buttons, operation type filters
- `apps/desktop/src/renderer/components/workspace/WorkspaceTabs.tsx` — Added "Oplog" tab
- `apps/desktop/src/renderer/components/workspace/WorkspaceView.tsx` — Wired OplogSection

## Architecture Decisions
- **DB-backed oplog (not git-backed)**: Unlike GitButler which stores oplog as git commits on a special branch, Exegol uses a SQLite table. This is simpler, avoids polluting the repo's git history, and allows easy querying/filtering. Trade-off: no git GC protection needed since oplog is separate from the repo.
- **Safe undo via new commit**: `revert_to_snapshot()` in Rust creates a new commit whose tree matches the target commit's tree, parented on current HEAD. This is safe (never force-pushes, never rewrites history). Follows GitButler's "create before-restore snapshot" philosophy but simplified.
- **Before/after ref tracking**: Each oplog entry records `ref_before` and `ref_after` (commit SHAs). Undo uses `ref_before` to revert. This is simpler than GitButler's full tree snapshot approach but sufficient for Exegol's needs.
- **Commit detection on exit**: AgentManager captures HEAD SHA at spawn and compares on exit. If different, records a "commit" operation. This catches all commits made by the agent without needing to hook into git itself.
- **Non-fatal recording**: All oplog operations are wrapped in try/catch. Oplog failures never block agent lifecycle.

## How to Test
1. Start the app, select a project
2. Spawn an agent that makes commits (e.g., with worktree)
3. Navigate to the "Oplog" tab
4. Verify: worktree_create and commit operations appear in timeline
5. Verify: operation icons and colors match type
6. Verify: before/after SHA refs are displayed
7. Hover over a "commit" entry → click "Undo" button
8. Verify: a new "revert" entry appears, repo HEAD matches the before ref
9. Test filters: click "Commits", "Branches", etc. to filter entries
