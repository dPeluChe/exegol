# WT5 — Codebase Hygiene (Monolith File Splits)

> **Worktree mission:** split six files that are over the 500 LOC soft limit into focused, cohesive modules **without changing any behavior**. These files are NOT touched by WT1-WT4, so this WT runs in full parallel with them. This brief is your **canonical scope**.

## Six files to split

| File | Current LOC | Owner WT | Split-safe? |
|---|---|---|---|
| `apps/desktop/src/renderer/components/workspace/BrowserPaneContent.tsx` | 799 | none | ✅ |
| `apps/desktop/src/main/ipc/procedures/diff.ts` | 714 | none | ✅ |
| `apps/desktop/src/renderer/components/settings/TerminalSettings.tsx` | 587 | none | ✅ |
| `packages/core-rust/src/processing/status_parser.rs` | 557 | none | ⚠ see WT3 coordination |
| `apps/desktop/src/renderer/components/workspace/WorkspaceTabBar.tsx` | 544 | none | ✅ |
| `apps/desktop/src/renderer/components/workspace/sections/TasksSection.tsx` | 505 | none | ✅ |

**Coordination notes (read once):**
- WT3 owns `packages/core-rust/` for adding the new `search/` module + editing `lib.rs`. WT3 is explicitly forbidden from modifying `processing/`, so your `status_parser.rs` split is safe. You will only touch `packages/core-rust/src/processing/` — do NOT edit `lib.rs` or anything outside that folder.
- WT1 and WT4 both work in `renderer/components/terminal/`. You don't touch that folder at all.
- WT4 works in `renderer/components/workspace/sections/PipelineSection.tsx` and creates new `ParallelRunComparator.tsx` in same folder. You touch `TasksSection.tsx` — different file, no conflict.

## Why this matters (do not skip)

The project's `CLAUDE.md` sets a 400-500 LOC soft limit per file. Files over that limit:
- Are harder to navigate, harder to review, harder to test in isolation.
- Tend to mix concerns that should be separated.
- Show up as flags in code-review tooling.

This WT is **pure hygiene** — no new features, no behavior changes. The win is reviewability for future work + a clearer mental map of the codebase.

## The Golden Rule

> **Every commit must be PURE MOTION. Zero behavior change. Reviewers should be able to confirm via `git diff --stat` that lines were moved, not rewritten.**

If you're tempted to "improve" something while you're moving it — STOP. That's a separate PR. This WT is about splits, not refactors of logic.

## Reference reading (read FIRST, before any code)

1. `CLAUDE.md` at the repo root — Exegol architecture summary. The "Max 400-500 LOC per file" line is in the quality gate section.
2. Each of the six files end-to-end. You can't split well if you don't understand what's there.
3. `apps/desktop/src/main/agents/manager.ts` (recently split per CLAUDE.md's `T75` notes) — example of how the project structures multi-file modules.
4. The existing tests for each file (if any) — they MUST keep passing without modification.

Look at how files are already split in the codebase (e.g. `main/terminal/` has `pty-host.ts` + `pty-session-types.ts` + `pty-shell-ready.ts` + `pty-scrollback.ts` + `pty-legacy-session.ts`). Match those patterns.

## Suggested split structure per file

These are **starting points** — adjust based on what you find when reading. The constraint is: each resulting file ≤ 300 LOC, cohesive concern per file, public API unchanged.

### 1. `BrowserPaneContent.tsx` (799 LOC)

Read first. Then candidate split:

- `BrowserPaneContent.tsx` — outer pane container, lifecycle, message passing (≤250 LOC). Exports `BrowserPane`.
- `BrowserAddressBar.tsx` — URL input, focus handling, submit behavior.
- `BrowserToolbar.tsx` — back/forward/reload/devtools-toggle buttons.
- `BrowserNavigation.ts` — pure helpers for URL parsing, history state.
- `browser-types.ts` — shared types if needed.

Co-locate any sub-types or constants the components share. Avoid a "utils.ts" dumping ground.

### 2. `diff.ts` (714 LOC)

This is the tRPC procedure router for git operations. Recently extended for T110c (LRU cache). Candidate split:

- `diff.ts` — main router definition + structuredDiff/projectDiff/stagedDiff (the cached queries). Keep `AsyncLruCache` import and the cache wiring here (≤250 LOC).
- `diff-mutations.ts` — stage / unstage / commit / push procedures.
- `diff-pr.ts` — createPullRequest / mergePullRequest / `gh` CLI detection.
- `diff-helpers.ts` — `runGitDiff`, `resolveProjectPath`, and other shared helpers.
- `diff-ai.ts` (optional) — `suggestCommitMessage` (raw fetch to Anthropic) if it warrants a dedicated file.

Each sub-file exports the procedures as named functions; `diff.ts` imports and composes them into the router. Or: each sub-file exports its own sub-router and `diff.ts` merges them. Pick the pattern that fits cleanly — look at how the agentRouter or pipelineRouter is composed for prior art.

**Don't change any procedure's input/output signature** — these are tRPC types consumed by the renderer.

### 3. `TerminalSettings.tsx` (587 LOC)

Settings panel for terminal section. Candidate split:

- `TerminalSettings.tsx` — outer panel, state, save logic (≤250 LOC).
- `FontCard.tsx` — per-font card with select + preview trigger.
- `FontPreview.tsx` — the live preview component.
- `FamilyChainBadge.tsx` — the family-chain visualization.
- `terminal-settings-state.ts` (optional) — if there's significant local state logic worth extracting.

Keep all save/load behavior identical. Read the existing settings IPC integration before touching anything.

### 4. `status_parser.rs` (557 LOC)

Rust file with `AgentOutputStream` class + pattern tables + tests. Candidate split (all files live in `packages/core-rust/src/processing/`):

- `status_parser.rs` — public `AgentOutputStream` class definition + `#[napi]` exports (≤250 LOC).
- `status_match_table.rs` — the const patterns + matcher logic.
- `status_parser_tests.rs` — move the `#[cfg(test)] mod tests` block here if it's substantial (>100 LOC). If small, leave tests inline.

Update `processing/mod.rs` to declare the new modules. Do NOT touch `lib.rs` — `processing/mod.rs` already handles the public surface (see `pub use processing::*` in `lib.rs`).

**The Rust tests inside the file MUST continue to pass with zero modification.** That's the proof of zero behavior change.

### 5. `WorkspaceTabBar.tsx` (544 LOC)

Tab bar with quick launch + layout presets. Candidate split:

- `WorkspaceTabBar.tsx` — outer bar, tab rendering, active state (≤250 LOC).
- `QuickLaunchMenu.tsx` — the agent quick-launch dropdown (portal).
- `LayoutPresetsDropdown.tsx` — the layout presets menu (with custom saved layouts).
- `tab-bar-helpers.ts` (optional) — pure helpers.

**Check if `WorkspaceTabBar.tsx` imports from `lib/layout-presets.ts`** — CLAUDE.md mentions that file. Don't touch it; just import from it.

### 6. `TasksSection.tsx` (505 LOC)

GitHub issues integration. Candidate split:

- `TasksSection.tsx` — outer section, query + filter state (≤250 LOC).
- `IssueCard.tsx` — per-issue display.
- `IssueFilters.tsx` — filter chips/dropdown.
- `IssueDetail.tsx` — detail panel (if it's substantial).
- `tasks-helpers.ts` (optional) — issue formatting helpers.

This file is right at 505 LOC — borderline. If a clean 2-file split (`TasksSection.tsx` + `IssueCard.tsx`) gets you ≤350 LOC, ship that. Don't over-engineer the split.

## Files allowed to modify or create

**Modify:**
- All six files listed above.
- `packages/core-rust/src/processing/mod.rs` (declare new sub-modules from status_parser split).
- `docs/TASK_TODO.md` — there is no current task entry for this WT; add a "WT5 Hygiene Split" entry in `tasks_completed/2026_05.md` instead.
- `docs/tasks_completed/2026_05.md` (log your commits).

**Create:**
- All the new sibling files listed in the suggested-split sections.
- No new test files unless a moved-out chunk lacks coverage that you're confident should exist (and even then, document why in the PR — it's not the primary mission).

## Files you MUST NOT touch (other WTs own them, or are out of scope)

- `apps/desktop/src/renderer/components/terminal/*` — **WT1 + WT4 own**
- `apps/desktop/src/main/terminal/*` — **WT1 owns**
- `apps/desktop/src/main/security/*` — **WT2 owns**
- `apps/desktop/src/preload/*` — WT2 owns
- `apps/desktop/src/renderer/index.html` — WT2 owns
- `apps/desktop/src/main/ipc/router.ts` — WT2 owns
- `packages/core-rust/src/lib.rs` — **WT3 owns**
- `packages/core-rust/src/search/*` — WT3 creates
- `packages/core-rust/src/git/*` — out of scope (not over limit)
- `packages/core-rust/Cargo.toml` — WT3 owns (adds crates)
- `apps/desktop/src/main/agents/*` — **WT4 owns**
- `apps/desktop/src/main/pipeline/*` — WT4 owns
- `apps/desktop/src/main/db/*` — out of scope (migrations is append-only by other WTs)
- `apps/desktop/src/renderer/stores/workspace.ts` (716 LOC, but WT1 + WT4 touch it) — DEFER
- `apps/desktop/src/main/db/migrations.ts` (576 LOC, append-only) — DEFER
- `apps/desktop/src/renderer/components/terminal/TerminalPanel.tsx` (598 LOC, WT4 splits it) — DEFER
- `apps/desktop/src/renderer/components/workspace/WorkspacePane.tsx` (468 LOC, indirect touch from multiple WTs) — DEFER
- `apps/desktop/src/renderer/components/workspace/sections/PipelineSection.tsx` (354 LOC, under limit + WT4 territory)
- `apps/desktop/src/renderer/components/workspace/sections/ParallelRunComparator.tsx` (created by WT4)
- `apps/desktop/electron.vite.config.ts`, `electron-builder.ts`, `package.json` — out of scope
- ANY file under 500 LOC that's not in your six-target list

If you discover that a file split forces a coupling change in a non-listed file, **stop and document it** in the PR description. Do not silently expand scope.

## Success criteria / Definition of Done

A PR opens from your worktree against `main` with all of the following:

- [ ] All six target files split. Each resulting file ≤ 300 LOC.
- [ ] **Zero behavior changes.** The diff for each split commit should be moves + imports, not edits of logic.
- [ ] All existing tests pass without modification.
- [ ] Public exports preserved exactly (consumers must not need to change their imports — verify by grep).
- [ ] Type-check passes, biome passes (0 errors, 0 warnings), production build passes, all JS + Rust tests pass.
- [ ] PR description includes: a table of before/after LOC for each file + the split structure used, and a statement explicitly affirming "no behavior changes — pure motion."
- [ ] **Zero new dependencies.**

## Quality gates (run before EVERY commit, all green required)

```bash
# Typecheck
bun run typecheck

# Lint + format (must be 0 errors, 0 warnings)
npx @biomejs/biome check apps/ packages/shared/src/ packages/ui/src/

# JS tests (all suites green — these are your PROOF of zero behavior change)
bun run test

# Rust (your status_parser split lives here)
cd packages/core-rust && cargo check && cargo clippy -- -D warnings && cargo test

# Production build (the real safety net — catches import-cycle bugs)
bun run build
```

If any gate fails, **fix the root cause** — do not skip hooks, do not `--no-verify`, do not lower lint rules.

## Commits

**One commit per file split.** Six commits total:

1. `refactor: split BrowserPaneContent.tsx into focused components`
2. `refactor: split diff.ts router into diff/mutations/pr/helpers`
3. `refactor: split TerminalSettings.tsx into FontCard/FontPreview/etc`
4. `refactor: split status_parser.rs into matcher/tests submodules`
5. `refactor: split WorkspaceTabBar.tsx into QuickLaunch/LayoutPresets`
6. `refactor: split TasksSection.tsx into Issue components`

Use conventional commits. Body explicitly states **"No behavior change — pure motion."** and lists the before/after LOC.

Each commit must pass quality gates independently. If a split breaks tests, you missed something — fix the split, don't rewrite the tests.

---

## Engineering best practices (read before coding)

### 1. Scope discipline (the most important rule for this WT)
- You split EXACTLY six files. No more, no less.
- You do NOT improve logic while moving it. Resist the urge.
- You do NOT add features, you do NOT rename functions, you do NOT change signatures.
- If something is obviously wrong in the code you're moving, leave it. File a follow-up note in the PR description. This WT is hygiene only.

### 2. Read before you write
- Read each file end-to-end before splitting it. You need to understand the data flow to know where the natural seams are.
- Look at how similar splits were done in the past (search git log for `refactor: split` commits, especially the T75 monolith decomposition wave per CLAUDE.md).

### 3. Public API preservation
- Before each split, grep for who imports from the file. Note every imported symbol.
- After the split, every one of those symbols must still be importable from the same path. The cleanest pattern: keep re-exports in the original file so external code doesn't change.
- If you genuinely need to break an import path (you should not), update every call site IN THE SAME COMMIT.

### 4. TypeScript discipline
- No `any`. The moved code already has types — preserve them.
- No new non-null assertions.
- Use `import type { ... }` for type-only imports.
- If you have to add a tiny shared type during the split, give it a clear name in the new file's `*-types.ts` companion.

### 5. Rust discipline (for status_parser.rs)
- `#![deny(clippy::all)]` is enforced at `lib.rs`. Your split must pass clippy.
- Tests stay green without modification. If a test imports something that you moved to a submodule, update the `use` line — that's the ONLY allowed test edit.
- Public functions (`#[napi]` exports) must stay in `status_parser.rs` (or be re-exported from it) so the napi-generated `index.d.ts` doesn't change.

### 6. No new dependencies
- Splits are pure motion. They never need a new dep. If you find yourself reaching for one, you're not doing a split — you're refactoring. Stop.

### 7. Comments policy
- Do NOT add comments while splitting. The code's existing comments should move along with it.
- The split itself is the documentation — well-named files express intent.
- Do NOT add "moved from X" comments. Git history records that.

### 8. Match existing code style
- Each new file should look like an existing file in the same folder. Import order, naming conventions, file structure — all match.
- For tRPC procedure splits: look at how other routers compose multiple files (if any) or compose inline.

### 9. Small focused commits — one per file
- Each commit splits ONE file. Six commits in this PR.
- Within a commit: pure motion. Reviewers should be able to use `git log --follow` or diff line counts to verify.
- A commit that mixes "split this file" + "move helpers from another file" is harder to review. Keep them separate.

### 10. Test what you ship
- **The existing tests are your safety net.** Run them after EVERY commit, not just at the end.
- If a test breaks after a split, your split changed behavior. Find what changed (often: an import path issue, a re-export missing, a circular dep). Fix the split, not the test.
- No new tests needed. The point is "no change," and the existing tests prove it.

### 11. Import discipline
- Watch for circular imports — splits create them easily. If you see a TypeScript error about circular imports, restructure (often by moving a shared type to a `*-types.ts` file).
- Use absolute imports where the project uses them (`@exegol/ui`, `@exegol/shared`); use relative imports where it does. Match the file you're splitting.

### 12. Performance awareness (non-issue here, but)
- Splits should be 100% performance-neutral. If you see a perf opportunity, file a follow-up note. Don't take it.

### 13. Don't iterate on passing code
- One pass per file. If your first split works, ship it.
- Don't tune file names after the fact. Don't "improve" the structure across commits. Each commit is final.

### 14. Document what you found
- The PR description should list, for each file:
  - Old LOC → new LOC (sum of new files).
  - The split structure used.
  - Any surprises or follow-ups discovered (e.g. "diff.ts has duplicated `resolveProjectPath` helper that should live in `diff-helpers.ts` — done in this PR").
- If you encountered a case where the suggested split didn't fit the actual code (e.g. you found that `BrowserPaneContent.tsx` is actually well-organized internally and 4 files made more sense than 3), document the deviation.

### 15. PR description is part of the work
- This PR's review is unusual: the reviewer should be able to scan it in 10 minutes because every commit is pure motion. Make that easy:
  - In the PR description, list every commit with a one-line summary.
  - For each file, paste the LOC table.
  - Affirm explicitly: "No behavior changes. All tests pass without modification."

---

## Out of scope (explicitly)

Do NOT do any of the following, even if they seem related:

- Split any file under 500 LOC (we have a soft limit at 400-500; only true monoliths above 500 are in scope).
- Split `workspace.ts` (716 LOC, WT1 + WT4 actively touch it).
- Split `migrations.ts` (576 LOC, append-only by design).
- Split `TerminalPanel.tsx` (598 LOC, **WT4 owns** the split internally).
- Split `WorkspacePane.tsx` (468 LOC, under the cutoff anyway).
- "Improve" any code while moving it. No renames. No restructured loops. No type tightening.
- Add tests for code you didn't add.
- Touch files in `main/terminal/`, `main/agents/`, `main/pipeline/`, `main/security/`, `preload/`, `renderer/components/terminal/`.
- Modify `lib.rs` in core-rust (WT3 owns it).
- Add new dependencies.
- Modify `package.json`, `bun.lock`, `electron-builder.ts`, vite config.
- Try to land this PR alongside a feature PR — this is a standalone hygiene change.

## When you finish

1. Final quality gate pass — all green. Run twice if any step felt flaky.
2. Verify with `wc -l` that each resulting file is ≤ 300 LOC.
3. Verify with `git diff --stat HEAD~6..HEAD` that the total line delta is roughly zero (lines removed from the original ≈ lines added across the new files; modulo import statements).
4. Update `docs/tasks_completed/2026_05.md` with a "WT5" section listing all six commits + before/after LOC.
5. Push branch + open PR with the description outlined above.
6. Stop. Do not start adjacent work.
