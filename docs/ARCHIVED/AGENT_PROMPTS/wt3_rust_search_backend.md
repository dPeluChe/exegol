# WT3 — Rust Search Backend

> **Worktree mission:** add a fast, gitignore-aware, in-process filesystem search to Exegol's Rust core. This is foundation work — it unblocks Command Palette file finder, future AI tools that need to read project context, and any "find in project" UX we want later. This brief is your **canonical scope**. Do NOT pick tasks from `docs/TASK_TODO.md` outside this brief.

## Tasks bundled in this WT

- **T116** — Rust search crates (`ignore`, `grep-regex`, `grep-searcher`, `grep-matcher`, `globset`) wired into `packages/core-rust` with napi exports, plus tRPC procedures exposing them to the renderer (Medium)

This is a single-task WT — focused, deep work on one cohesive change.

## Why this matters (do not skip)

Today we have **no in-process filesystem search**. If we ever want:

- "Open file" fuzzy finder in the Command Palette
- AI tools that need to find files in the project before reading them
- "Find in project" surface (Cmd+Shift+F)
- Smart Git Button to scan for `.env` leaks before commit

…we'd have to spawn `ripgrep` from a shell and parse its text output. That's:
- Slow (process spawn overhead)
- Fragile (text parsing)
- Dependent on the user having `rg` installed
- Hard to limit (no clean way to bound results in flight)

The `ignore` crate (which powers ripgrep) gives us:
- **Native respect for `.gitignore`, `.ignore`, `.git/info/exclude`** without manual parsing
- **Parallel walking** of large trees with bounded memory
- **Structured results** (paths, line numbers, byte offsets) ready for napi
- **Composability** with `globset` (include/exclude patterns) and `grep-regex` (pattern matching)

Terax-AI uses exactly this stack for their AI file tools. We lift the design.

**Important context: this WT is foundation only.** No UI consumes the new endpoints yet — that's downstream work. Your DoD is "the endpoint is callable from the renderer and returns correct, bounded results." Wiring it into the Command Palette is OUT OF SCOPE.

## Reference reading (read FIRST, before any code)

1. `docs/RESEARCH/TERAX_STACK_REVIEW.md` § **Area 2: Terminal / PTY** (mentions search crates) and the library shopping list table — the rationale.
2. `CLAUDE.md` at repo root — Exegol architecture summary, especially the **Rust native module** section.
3. `packages/core-rust/Cargo.toml` — current deps.
4. `packages/core-rust/src/lib.rs` — current napi exports + module structure (you'll add a `mod search`).
5. `packages/core-rust/src/git/` and `packages/core-rust/src/processing/` — existing module patterns to match.
6. `apps/desktop/src/main/ipc/procedures/search.ts` — **already used** for FTS5 scrollback search. Do NOT break it; ADD new procedures alongside.
7. `apps/desktop/src/main/agents/spawn-env.ts` — how `coreRust` is loaded with fallback to `process.resourcesPath/core-rust` for packaged builds. Your new exports follow the same path automatically.

Then read these Terax references (their Tauri-based equivalent — same crates, different host):
- `terax-ai/src-tauri/Cargo.toml` — see how they declare the crates.
- `terax-ai/src-tauri/src/modules/fs/search.rs` and `terax-ai/src-tauri/src/modules/fs/grep.rs` — the canonical implementations.

Terax repo path on disk: `/Users/peluche/dPeluCheData/PROJECTS/dPeluChe/_code_/_repos_2_learn/github.com/crynta/terax-ai`

## Implementation plan

### Step 1 — Add Rust crate dependencies

In `packages/core-rust/Cargo.toml`, add to `[dependencies]`:

```toml
ignore = "0.4"          # gitignore-respecting parallel walker (ripgrep's engine)
grep-regex = "0.1"      # Regex matcher for grep
grep-searcher = "0.1"   # Line-oriented searcher
grep-matcher = "0.1"    # Matcher trait
globset = "0.4"         # Glob patterns for include/exclude
```

Check current versions on crates.io and pick the latest stable. These should compile cleanly with our `napi 3` setup; if there's a transitive conflict, document it and pin.

Bundle size impact: ~1 MB added to the `.node` artifact. Acceptable.

### Step 2 — Create the `search` module

New folder `packages/core-rust/src/search/`:

```
search/
├── mod.rs           # Re-exports + module declaration (small)
├── fuzzy.rs         # fs_search: filename fuzzy finder
├── grep.rs          # fs_grep: content search
└── types.rs         # Shared types (SearchResult, GrepHit, etc.)
```

Wire `mod search;` and `pub use search::*;` into `lib.rs` (mirror how `git` and `processing` are wired).

#### `types.rs`

Define napi-exported structs:

```rust
#[napi(object)]
pub struct SearchResult {
  pub path: String,           // Absolute path
  pub relative_path: String,  // Relative to search root
  pub score: i32,             // Fuzzy match score (higher = better)
  pub is_dir: bool,
}

#[napi(object)]
pub struct GrepHit {
  pub path: String,
  pub relative_path: String,
  pub line_number: u32,       // 1-indexed
  pub line: String,           // The matching line, trimmed to a reasonable length
  pub column_start: u32,      // 0-indexed byte offset of match start in the line
  pub column_end: u32,        // 0-indexed byte offset of match end in the line
}

#[napi(object)]
pub struct SearchLimits {
  pub max_results: Option<u32>,        // Default 100
  pub max_depth: Option<u32>,          // Default 16
  pub include_hidden: Option<bool>,    // Default false
  pub respect_gitignore: Option<bool>, // Default true
}

#[napi(object)]
pub struct GrepOptions {
  pub case_insensitive: Option<bool>,  // Default false
  pub include_hidden: Option<bool>,    // Default false
  pub respect_gitignore: Option<bool>, // Default true
  pub max_matches: Option<u32>,        // Default 500
  pub max_file_size_kb: Option<u32>,   // Default 1024 (skip huge files)
  pub globs: Option<Vec<String>>,      // Optional include patterns (e.g. ["**/*.ts", "**/*.tsx"])
}
```

#### `fuzzy.rs`

```rust
#[napi]
pub fn fs_search(query: String, root: String, limits: SearchLimits) -> Result<Vec<SearchResult>>
```

Behavior:

- Walk `root` using `ignore::WalkBuilder` with the configured `respect_gitignore`, `hidden`, and `max_depth` settings.
- For each entry, score the path against `query` using a simple **subsequence + substring** scoring (you don't need a full fzf algorithm — a basic case-insensitive `contains` + word-boundary bonus is fine and fast).
  - Suggested scoring: substring match (+100), word-boundary match (+50), characters in subsequence (+1 each), basename match weighted higher than full-path match (+200).
- Maintain a fixed-size min-heap (`BinaryHeap` of `Reverse<(score, entry)>`) bounded by `max_results`. Push every entry; pop the lowest when heap exceeds the cap.
- After the walk, sort the remaining entries by score descending, then by path ascending for tie-breaks.
- Return the bounded result.

Edge cases:
- Empty `query` → return the first `max_results` entries in walk order (useful for "Cmd+P with nothing typed").
- Non-existent `root` → return `Err` with a clear message.
- Symlink loops → `WalkBuilder` handles this by default; don't disable.

#### `grep.rs`

```rust
#[napi]
pub fn fs_grep(pattern: String, root: String, opts: GrepOptions) -> Result<Vec<GrepHit>>
```

Behavior:

- Build a `grep_regex::RegexMatcher` from `pattern`, honoring `case_insensitive`.
- Build a `grep_searcher::Searcher` with default config (line-by-line, UTF-8 default).
- Use `ignore::WalkBuilder` for the file traversal — same settings as fuzzy.
- For each candidate file:
  - Skip if `file_size > max_file_size_kb * 1024`.
  - Skip if `globs` is set and the file doesn't match any glob (use `globset::GlobSetBuilder`).
  - Run the searcher. Collect each match into a `GrepHit`.
  - Stop early once `hits.len() >= max_matches`.
- Trim long match lines (e.g. cap at 240 chars, with `...` if truncated) so we don't ship massive single lines over IPC.
- Return the bounded result, sorted by (path asc, line_number asc).

Edge cases:
- Invalid regex → return `Err` with the parse error.
- Non-text file (binary) — `grep_searcher` auto-detects; skip silently.
- Empty `pattern` → return `Err("pattern must not be empty")`.

### Step 3 — Wire napi exports into `lib.rs`

Add `mod search;` and `pub use search::*;` next to the existing `mod git;` / `mod processing;`. Verify the napi macros expose the new functions automatically — `cargo build` should produce updated `index.d.ts` with the new types and functions.

### Step 4 — Expose via tRPC

**Do NOT modify the existing `searchRouter`** in `apps/desktop/src/main/ipc/procedures/search.ts` — it's used for FTS5 scrollback search and has a different contract.

Create a new router file: `apps/desktop/src/main/ipc/procedures/fs-search.ts`:

```typescript
import { z } from "zod";
import { coreRust } from "../../agents/spawn-env";
import { publicProcedure, router } from "../trpc";

export const fsSearchRouter = router({
  fuzzyFind: publicProcedure
    .input(
      z.object({
        query: z.string(),
        root: z.string(),
        maxResults: z.number().min(1).max(500).optional(),
        maxDepth: z.number().min(1).max(32).optional(),
        includeHidden: z.boolean().optional(),
        respectGitignore: z.boolean().optional(),
      }),
    )
    .query(({ input }) => {
      if (!coreRust) throw new Error("Rust native module not available");
      return coreRust.fsSearch(input.query, input.root, {
        maxResults: input.maxResults,
        maxDepth: input.maxDepth,
        includeHidden: input.includeHidden,
        respectGitignore: input.respectGitignore,
      });
    }),

  grep: publicProcedure
    .input(
      z.object({
        pattern: z.string().min(1),
        root: z.string(),
        caseInsensitive: z.boolean().optional(),
        includeHidden: z.boolean().optional(),
        respectGitignore: z.boolean().optional(),
        maxMatches: z.number().min(1).max(5000).optional(),
        maxFileSizeKb: z.number().min(1).max(10240).optional(),
        globs: z.array(z.string()).optional(),
      }),
    )
    .query(({ input }) => {
      if (!coreRust) throw new Error("Rust native module not available");
      return coreRust.fsGrep(input.pattern, input.root, {
        caseInsensitive: input.caseInsensitive,
        includeHidden: input.includeHidden,
        respectGitignore: input.respectGitignore,
        maxMatches: input.maxMatches,
        maxFileSizeKb: input.maxFileSizeKb,
        globs: input.globs,
      });
    }),
});
```

Register it in `apps/desktop/src/main/ipc/router.ts`:

```typescript
import { fsSearchRouter } from "./procedures/fs-search";
// ...
export const appRouter = router({
  // ... existing entries
  fsSearch: fsSearchRouter,
});
```

### Step 5 — Tests

#### Rust tests (co-located, project convention)

In `fuzzy.rs` and `grep.rs`, add `#[cfg(test)] mod tests { ... }` blocks. Use `tempfile` for setup (add `tempfile = "3"` to `[dev-dependencies]`).

**Minimum coverage:**

`fuzzy.rs` tests:
- Finds files by exact basename match
- Respects `.gitignore` (creates a `.gitignore`, verifies ignored files don't appear)
- `include_hidden = false` (default) skips dotfiles
- `include_hidden = true` includes dotfiles
- `max_results` bound is honored
- `max_depth` bound is honored
- Empty query returns first N entries
- Non-existent root returns Err
- Scoring: basename match ranks above full-path-only match

`grep.rs` tests:
- Finds matches across multiple files
- Case-insensitive flag works
- `.gitignore` is respected
- `max_matches` caps results
- `max_file_size_kb` skips large files
- `globs` filters by extension
- Invalid regex returns Err
- Binary files are skipped silently
- Truncates very long match lines

Make sure `cargo test` passes from `packages/core-rust/`.

#### TypeScript tests

For the tRPC layer, add `apps/desktop/src/main/ipc/procedures/fs-search.test.ts`:

- Mocks `coreRust` (`fsSearch`, `fsGrep`).
- Verifies Zod parsing rejects invalid inputs (empty pattern, negative limits, etc).
- Verifies output is passed through unchanged.

You don't need an integration test (real Rust + real FS) — the Rust tests cover the engine; the TS tests cover the bridge. We can add an integration test later if we observe issues.

### Step 6 — Bundle verification

`packages/core-rust` is bundled into the Electron app via `extraResources` in `electron-builder.ts` (see `from: "../../packages/core-rust"`). Verify that:

1. `cargo build` produces an updated `.node` binary that includes the new exports.
2. `bun run build` (from repo root) packages it correctly.
3. The new types appear in `packages/core-rust/index.d.ts` (auto-generated by napi).

You should not need to touch `electron-builder.ts` — the existing `extraResources` block already grabs the updated artifact.

## Files allowed to modify or create

**Modify:**
- `packages/core-rust/Cargo.toml`
- `packages/core-rust/src/lib.rs` (add `mod search;` + re-export)
- `apps/desktop/src/main/ipc/router.ts` (register `fsSearchRouter`)
- `docs/TASK_TODO.md` (remove T116 entries when complete)
- `docs/tasks_completed/2026_05.md` (log your commits)

**Create:**
- `packages/core-rust/src/search/mod.rs`
- `packages/core-rust/src/search/fuzzy.rs`
- `packages/core-rust/src/search/grep.rs`
- `packages/core-rust/src/search/types.rs`
- `apps/desktop/src/main/ipc/procedures/fs-search.ts`
- `apps/desktop/src/main/ipc/procedures/fs-search.test.ts`

**You should NOT need to modify** `packages/core-rust/index.d.ts` directly — it's auto-generated by `napi build`. If it doesn't update, that's a build config issue worth investigating, not something to hand-edit.

## Files you MUST NOT touch (other WTs own them)

- `apps/desktop/src/main/ipc/procedures/search.ts` — **existing FTS5 router; do NOT modify**. Add a new file (`fs-search.ts`) instead.
- `apps/desktop/src/main/terminal/*` — **WT1 owns**
- `apps/desktop/src/main/security/*` — **WT2 owns**
- `apps/desktop/src/preload/*` — WT2 owns
- `apps/desktop/src/renderer/index.html` — WT2 owns
- `apps/desktop/src/main/agents/*` — **WT4 owns**
- `apps/desktop/src/main/pipeline/*` — WT4 owns
- `apps/desktop/src/main/db/migrations.ts` — WT4 may append
- `apps/desktop/src/renderer/components/*` — out of scope (no UI wiring in this WT)
- `apps/desktop/src/renderer/stores/*` — out of scope
- `packages/shared/src/types/agent.ts` — WT4 owns
- `apps/desktop/electron.vite.config.ts`, `electron-builder.ts`, `package.json` — out of scope
- Existing Rust modules (`git/`, `processing/`) — do NOT refactor or modify

If you need to touch something forbidden, **stop and document it** in the PR description. Do not silently expand scope.

## Success criteria / Definition of Done

A PR opens from your worktree against `main` with all of the following:

- [ ] Five Rust crates added to `Cargo.toml` with explicit versions.
- [ ] New `search/` module with `fuzzy.rs`, `grep.rs`, `types.rs`, `mod.rs`.
- [ ] napi exports: `fsSearch(query, root, limits)` and `fsGrep(pattern, root, opts)` callable from TypeScript with correct types in the auto-generated `index.d.ts`.
- [ ] tRPC router `fsSearchRouter` with `fuzzyFind` and `grep` procedures, registered in `appRouter`.
- [ ] All Rust tests pass: `cd packages/core-rust && cargo test`.
- [ ] All TS tests pass.
- [ ] `cargo clippy -- -D warnings` clean.
- [ ] Production build succeeds (`bun run build`) and the new exports are present in the bundled `.node`.
- [ ] **Zero new TypeScript/npm dependencies** (Rust crates are expected; TS side should add nothing).
- [ ] PR description includes: list of crates + versions, example calls from the renderer with sample input/output, bundle size delta (run `du -sh packages/core-rust/*.node` before and after), and a note that NO UI consumes this yet (foundation work).

## Quality gates (run before EVERY commit, all green required)

```bash
# Rust — primary deliverable
cd packages/core-rust
cargo check
cargo clippy -- -D warnings
cargo test
cd ../..

# Typecheck
bun run typecheck

# Lint + format (must be 0 errors, 0 warnings)
npx @biomejs/biome check apps/ packages/shared/src/ packages/ui/src/

# JS tests (existing + new fs-search tests)
bun run test

# Production build (the real safety net — verifies napi bridge + packaging)
bun run build
```

If any gate fails, **fix the root cause**. No bypasses.

## Commits

- Suggested split:
  1. `feat(T116): add ignore + grep-* + globset crates with napi exports`  (Rust core)
  2. `feat(T116): expose fsSearch + fsGrep via tRPC fs-search router`  (TS bridge + tests)
- Use conventional commits. Body explains WHY (foundation for future AI tools + Command Palette).

---

## Engineering best practices (read before coding)

These apply to every change you make. They are codified in the project's `CLAUDE.md` — re-read it.

### 1. Scope discipline
- Single task, single focused PR. No tangential refactors of existing Rust modules.
- Do NOT touch the existing FTS5 `searchRouter` in `procedures/search.ts`. Create a NEW router file. This is a contract preservation issue.

### 2. Read before you write
- Read `packages/core-rust/src/git/mod.rs` + `processing/mod.rs` to see how existing modules are structured. **Match those patterns exactly** — same file naming, same use of `#[napi(object)]`, same Result type conventions.
- Read Terax's `fs/search.rs` and `fs/grep.rs` carefully. Lift their patterns; don't reinvent.

### 3. Rust style discipline
- `#![deny(clippy::all)]` is already enforced in `lib.rs`. Your code must pass `clippy -- -D warnings`.
- Use `?` for error propagation, not unwrap/expect (except in tests).
- Define error types via `napi::Error::from_reason("...")` for napi-facing errors, or use `napi::Result` with `?` from `anyhow`-style helpers.
- No `clone()` unless necessary. Slices and `&str` where possible.
- Pre-allocate vectors when capacity is known (e.g. `Vec::with_capacity(max_results as usize)`).

### 4. TypeScript discipline (for the tRPC side)
- No `any`. The napi-generated types are precise; use them.
- No non-null assertions. Use the existing `if (!coreRust) throw ...` pattern from neighboring procedures (`diff.ts`, etc.).
- Zod schemas must match Rust types exactly. If you change a field name, change both.

### 5. No new TypeScript/npm dependencies
- The Rust crates ARE the deliverable, but the TypeScript side should add nothing. If you find yourself wanting a TS dep (e.g. an LRU helper for caching results), stop and reuse what's already there (e.g. `apps/desktop/src/main/lib/lru-cache.ts` was added recently — but caching is out of scope for THIS WT).

### 6. Comments policy
- Default: **no comments**.
- Exception: scoring algorithms in `fuzzy.rs` should have a 1-2 line block above the function explaining the formula (the WHY of weights). E.g. `// Basename matches outrank full-path matches by 2x; word-boundary hits are worth 50.`
- Never explain WHAT a function does — the name + signature suffice.

### 7. Match existing code style
- Look at `packages/core-rust/src/git/diff.rs` and `processing/status_parser.rs` for napi function structure, type layout, doc patterns. Match them.
- Test naming: `#[cfg(test)] mod tests { use super::*; ... #[test] fn name_describes_behavior() { ... } }`.

### 8. Small focused commits
- The Rust core and the TS bridge are independent enough to land as 2 commits. They should be reviewable in isolation.
- Do not bundle unrelated work (no "while I'm here, let me refactor git2 usage").

### 9. Test what you ship
- Every napi function MUST have at least 3 unit tests in Rust. Use `tempfile::TempDir` to build the test fixture.
- Test the actual edge cases listed in "Edge cases" above. Don't skip the binary-file or gitignore cases — they're easy to write and cover the high-value behavior.
- The TS bridge tests should mock `coreRust` and verify the Zod parsing rejects bad input.

### 10. Performance awareness
- `ignore::WalkBuilder` is already parallel by default. Use it as-is; don't sequentialize.
- Maintain a fixed-size heap for `fs_search` — do NOT collect all entries and sort at the end (that's O(N log N) memory).
- For `fs_grep`, stop the walk early once `max_matches` is reached. Use an `AtomicUsize` for the counter if threading.
- Cap returned line content at ~240 chars to keep IPC payloads small.

### 11. Threat-model awareness
- The `root` parameter is user-controlled (eventually, via the renderer). Do NOT allow walking system directories like `/`, `~`, etc. without explicit caller intent — but the validation belongs to the **caller**, not to your function. Document this assumption in the function's doc comment.
- Do NOT follow symlinks outside `root` by default — `ignore::WalkBuilder` handles this; don't disable the protections.
- For the regex in `fs_grep`: `grep-regex` already protects against catastrophic backtracking (it uses Rust's regex crate). Don't roll your own regex engine.

### 12. Quality gate hygiene
- Run `cargo clippy -- -D warnings` after EVERY Rust change. Clippy is strict here; address its suggestions rather than `#[allow]`-ing.
- Run the production build (`bun run build`) at the end — this is the only way to verify the napi bridge produces the correct types.

### 13. Don't iterate on passing code
- If your first fuzzy-scoring implementation works and the tests pass, ship it. Don't golf the algorithm.
- If your first grep walker hits all the tests, leave it. We can optimize later if we hit a real perf wall.

### 14. Document deferred items
- Anything you couldn't finish or punted on: explicit TODO comment with reasoning + a note in the PR description.
- "No UI consumes this yet" is the headline note for the PR — make it impossible to miss.

### 15. PR description is part of the work
- Include: crate list with versions, example renderer call (TS code block), Rust+TS test coverage summary, bundle size delta, build verification screenshot, explicit statement that no UI is wired yet.

---

## Out of scope (explicitly)

- Wiring the new endpoints into the Command Palette, file finder UI, or any renderer component
- Caching results (we don't know the workload yet — premature)
- Index building / persistent search index (different problem; FTS5 already covers scrollback)
- Modifying the existing FTS5 `searchRouter` (`procedures/search.ts`)
- Adding TypeScript fuzzy-finder dependencies (`fzf`, `fuse.js`, etc.) — Rust does the work
- Renaming or refactoring existing Rust modules (`git/`, `processing/`)
- Adding new types to `packages/shared/` (the napi types live in `core-rust/index.d.ts`)
- Modifying `electron-builder.ts` (the existing `extraResources` block handles it)
- Modifying `apps/desktop/src/preload/*` (WT2 owns)
- Anything in `main/terminal/`, `main/agents/`, `main/pipeline/`

## When you finish

1. Final quality gate pass — all green.
2. Update `docs/tasks_completed/2026_05.md` with a "WT3" section (commits + outcome bullets).
3. Remove T116 from `docs/TASK_TODO.md` Active Backlog + from Wave 1 priority order.
4. Push branch + open PR with a thorough description (see "PR description" in best practices).
5. Stop. Do not start adjacent work.
