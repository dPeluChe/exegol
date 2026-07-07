# T28 — Rust-Native Diff Generation

## Inspiration Source
- **Repo**: GitButler (`github.com/gitbutlerapp/gitbutler`)
- **Files studied**: `crates/but-core/src/unified_diff.rs` (DiffHunk structure), `crates/but-core/src/diff/tree_changes.rs` (tree diff computation), `crates/but-status/src/lib.rs` (status + working tree snapshot), `crates/but-core/src/diff_types.rs` (DiffSpec, HunkHeader, ModeFlags)
- **Pattern applied**: Structured diff types (FileDiff → Hunk → DiffLine), programmatic git2 diff via `diff_tree_to_workdir_with_index` and `diff_tree_to_index`, delta status mapping

## What Changed
- `packages/core-rust/src/git/types.rs` — Added `DiffLine`, `DiffHunk`, `FileDiff`, `RepoSnapshot` napi types
- `packages/core-rust/src/git/mod.rs` — Added `get_diff(repo_path, staged)` returning `Vec<FileDiff>`, `get_repo_snapshot()`, `revert_to_snapshot()`. Internal `extract_file_diffs()` walks git2 diff with two-pass approach (deltas, then hunk/line population)
- `apps/desktop/src/main/ipc/procedures/diff.ts` — Added `structuredDiff` procedure calling Rust. Legacy `projectDiff` now tries Rust first, falls back to CLI. Lazy-loads `@exegol/core-rust`
- `apps/desktop/src/renderer/hooks/use-trpc.ts` — Added `useStructuredDiff` hook and `RustFileDiff` type

## Architecture Decisions
- **Two-pass extraction**: First pass creates `FileDiff` entries from git2 deltas (captures path, status, binary flag). Second pass uses `diff.print()` to walk hunks and lines, matching them to file entries. This avoids the complexity of git2's callback-based API while producing clean structured output.
- **Backward compatible**: Legacy string-based diff procedures (`projectDiff`, `stagedDiff`) remain for existing UI. New `structuredDiff` procedure returns typed data. DiffSection.tsx can be migrated incrementally.
- **Rust-first with CLI fallback**: If `@exegol/core-rust` isn't available (build issue), falls back to `execFileAsync('git', ['diff'])`.
- **Same types as GitButler**: FileDiff/DiffHunk/DiffLine mirror GitButler's `TreeChange`/`DiffHunk`/`UnifiedPatch` structure but simplified for napi serialization (no BString, no gix ObjectId).

## How to Test
1. Make changes in a project tracked by Exegol
2. Use the Diff Viewer tab — should still work (uses legacy procedures)
3. Call `diff.structuredDiff` via tRPC — returns typed `FileDiff[]` with hunks/lines
4. Verify: staged vs unstaged modes return correct diffs
5. Verify: binary files show `binary: true` with empty hunks
6. Verify: renames show `status: "renamed"` with `oldPath` populated
