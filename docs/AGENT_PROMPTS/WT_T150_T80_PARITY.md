# Brief — WT-T150: T80 Closure + Rust↔JS Parity Vectors

> Paste this as the task for a claude-code agent spawned in an **isolated worktree**.
> Full spec: `docs/TASK_TODO.md` § T150. Source: `docs/RESEARCH/CODE_HEALTH_AUDIT_2026_07.md`.

You are implementing T150: finish the half-built error architecture and lock the Rust↔JS
parser mirror with shared golden vectors. Two independent deliverables.

## Deliverable 1 — T80 closure (`withRetry` wire-in or delete)
1. Read `apps/desktop/src/main/lib/errors.ts` (hierarchy + `withRetry`, currently ZERO call sites).
2. Wire `withRetry` + `TransientError` classification into these paths (each individually
   assessed — if a path is a bad fit, document why instead of forcing it):
   - Haiku/API calls: `main/agents/scoring.ts` (tier-3 judge), `main/pipeline/evaluator.ts`,
     `main/ipc/procedures/diff.ts` + `diff-ai.ts` (commit msg / AI summaries) — network
     errors + 429/5xx = transient
   - Git network ops (push/fetch) wherever executed for the Smart Git Button / worktrees
   - MCP host reconnect if not already classified (T80 notes say disconnects are transient)
3. Rule: retry ONLY transient (existing `isTransient()` guard), max 3, existing backoff.
   No retry on user-abort or permanent errors. Log retries at warn level.
4. If after honest assessment `withRetry` fits NOWHERE, delete it + its tests and say so.
   No half-builds may remain either way.

## Deliverable 2 — golden parity vectors (Rust FSM ↔ JS mirror)
1. Read `apps/desktop/src/main/agents/status-parser.ts` (JS mirror) and
   `packages/core-rust/src/processing/{osc_notify.rs,status_parser.rs,strip_ansi.rs}`.
2. Create ONE shared fixture set: `packages/core-rust/test-vectors/parser-vectors.json` —
   cases: plain ANSI stripping, OSC-777 notify signals (working/attention/finished, incl.
   split across chunk boundaries — the FSM must handle partial sequences), OSC-777
   shell-ready marker (must NOT be treated as a signal), status-phrase scraping cases,
   mixed noise. Each case: `{ name, input (byte-safe string), expectedStripped?,
   expectedSignals?, expectedStatus? }`.
3. Consume it from BOTH sides:
   - Rust: `#[cfg(test)]` test loading the JSON (serde) → assert against `AgentOutputStream`
     / scanner outputs. `cd packages/core-rust && cargo test` must pass.
   - JS: vitest suite loading the same file → assert against the JS mirror.
4. Divergences you find are the POINT: fix the JS mirror to match Rust (Rust is the source
   of truth) and record each divergence in the report.

## Rules
- Quality gate: biome --fix clean on your files, tsc node+web clean,
  `cd apps/desktop && npx vitest run` green, AND `cd packages/core-rust && cargo test` green
  (+ `cargo clippy` no new warnings).
- Commit on your branch. Do NOT push, do NOT create PRs — the supervisor reviews first.

## Final report format
Call sites wired (or the delete decision + rationale) · vector count + divergences found/fixed ·
gate outputs incl. cargo · anything unfinished, honestly.
