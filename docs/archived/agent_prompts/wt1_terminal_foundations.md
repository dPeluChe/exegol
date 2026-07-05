# WT1 — Terminal Foundations

> **Worktree mission:** make Exegol's PTY/terminal infrastructure trustworthy, shell-aware, and robust under pressure. This brief is your **canonical scope**. Do NOT pick tasks from `docs/TASK_TODO.md` outside this brief, even if they look related.

## Tasks bundled in this WT

- **T112** — OSC 7 + OSC 133 shell integration (Medium)
- **T113** — PTY flusher hardening (Small)
- **T115** — DormantRing for hidden panes (Small)
- **Refactor split** — `renderer/components/terminal/TerminalInstance.tsx` (currently 425 LOC, sitting at the project's soft limit). Split into smaller modules as part of T113 + T115 work. See "Split plan" below.

## Why these matter (do not skip)

Exegol orchestrates agent CLIs, but it also hosts plain user shells (`empty` pane spawns `$SHELL`). Today:

- We have **no reliable cwd tracking** for shell panes — only the parsing-based `status_parser.rs` for agent CLIs, which is content-specific and brittle for generic shells.
- The PTY sidecar may slice partial ANSI/CSI sequences on overflow (renderer ends up with broken state).
- WebGL context-loss (Mac sleep/wake) blanks the terminal with no recovery handler.
- When a pane is hidden, the renderer-side buffer is discarded — only the sidecar ring (8 MB) survives, but at the cost of replay from scratch.

Terax-AI (the comparison terminal we reviewed in `docs/RESEARCH/TERAX_STACK_REVIEW.md`) solves all of this with shell-integration init scripts + a hardened flusher + a per-pane dormant ring. We lift their patterns into our Electron stack.

## Reference reading (read FIRST, before any code)

1. `docs/RESEARCH/TERAX_STACK_REVIEW.md` § **Area 2: Terminal / PTY** — the rationale and the file pointers
2. `CLAUDE.md` at repo root — Exegol architecture summary, especially the PTY Sidecar Architecture section
3. `apps/desktop/src/main/terminal/pty-sidecar-entry.ts` — current sidecar flusher
4. `apps/desktop/src/renderer/components/terminal/TerminalInstance.tsx` — current xterm wrapper

Then read these Terax files (full paths in your worktree clone of terax-ai):
- `terax-ai/src-tauri/src/modules/pty/scripts/zshrc.zsh`, `bashrc.bash`, `profile.ps1` — the canonical init scripts to lift
- `terax-ai/src-tauri/src/modules/pty/session.rs` (`86-271`) — the 4 ms-coalesce + ESC c discard pattern
- `terax-ai/src/modules/terminal/lib/osc-handlers.ts` (`1-86`) — the frontend OSC parser + SSH spoofing guard
- `terax-ai/src/modules/terminal/lib/dormantRing.ts` (`1-71`) — the bounded chunk ring

Terax repo path on disk: `/Users/peluche/dPeluCheData/PROJECTS/dPeluChe/_code_/_repos_2_learn/github.com/crynta/terax-ai`

## Implementation plan

### T112 — OSC 7 + OSC 133 shell integration

**Goal:** shell panes (NOT agent CLIs) emit cwd + prompt boundaries via ANSI escape sequences. Renderer parses them and pushes per-pane cwd into the workspace store.

**Steps:**

1. **Create init scripts** under `apps/desktop/src/main/terminal/shell-integration/`:
   - `zshenv.zsh`, `zprofile.zsh`, `zlogin.zsh`, `zshrc.zsh` (zsh chain)
   - `bashrc.bash`
   - `profile.ps1` (PowerShell — future Windows; lift it anyway so we don't redo this work later)

   Each script emits:
   - `OSC 7;file://<host><cwd>\x07` after `cd` (cwd tracking)
   - `OSC 133;A\x07` on `precmd` (prompt start)
   - `OSC 133;B\x07` on prompt end (re-injected if framework rebuilt PS1)
   - `OSC 133;C\x07` on pre-exec (command starts)
   - `OSC 133;D;<exit-code>\x07` on command done

   **Lift them verbatim from Terax** (`pty/scripts/`) — they are battle-tested. Adjust only paths/variables that reference Terax names.

2. **Materialize on disk** on first run. Extend `apps/desktop/src/main/terminal/shell-wrappers.ts` so the init scripts get written to `~/.exegol/shell-integration/` if missing (use the existing pattern in that file for materializing agent wrapper scripts).

3. **Wire shell-pane spawn** to use the integration:
   - When `paneType === "empty"` (auto-spawned shell) or any future direct shell pane, build the spawn command with `ZDOTDIR=~/.exegol/shell-integration zsh -i` (zsh) or `bash --rcfile ~/.exegol/shell-integration/bashrc.bash -i` (bash).
   - **Do NOT** wrap agent CLI spawns — those have their own loops and we'd corrupt their output.
   - Detect shell choice from `$SHELL` (existing helper likely exists; if not, add a small one).

4. **Frontend OSC parser** in a new file `apps/desktop/src/renderer/components/terminal/osc-handlers.ts`:
   - Export `registerOscHandlers(term: Terminal, paneId: string, deps: { setCwd; setLastExit })`.
   - Parse OSC 7 → extract cwd, normalize Windows drive-letter forms (`/C:/Users/foo` → `C:/Users/foo`).
   - Parse OSC 133 A/B/C/D → track `inCommand` state, register `IMarker` on A (for "jump to previous prompt"), surface exit code on D.
   - **Critical SSH spoofing guard:** reject OSC 7 updates while `inCommand === true`. A remote SSH session can emit OSC 7 from inside its own shell — we must not propagate those to our pane's cwd badge. Lift this exact logic from Terax `osc-handlers.ts:27-32`.

5. **Workspace store** — add per-pane cwd state:
   - `paneCwd: Record<paneId, string>` and `paneLastExit: Record<paneId, number | null>` (additive, do not refactor existing state).
   - Setter actions: `setPaneCwd(paneId, cwd)`, `setPaneLastExit(paneId, code)`.

6. **Tests** (`apps/desktop/src/renderer/components/terminal/osc-handlers.test.ts`):
   - Valid OSC 7 → cwd extracted
   - OSC 7 with Windows drive letter → normalized
   - OSC 7 during `inCommand === true` → rejected (spoof guard)
   - OSC 133 A/B/C/D → state transitions correct
   - Malformed sequences → no crash

### T113 — PTY flusher hardening + WebGL context-loss recovery

**Goal:** the sidecar never produces malformed ANSI under load; the renderer recovers from GPU context loss.

**Steps:**

1. **Audit the sidecar flusher** (`apps/desktop/src/main/terminal/pty-sidecar-entry.ts`):
   - Confirm the coalescing window value. Terax uses **4 ms** with **4 MiB MAX_PENDING**. If ours is different, document the rationale or align.
   - **On overflow, drop the entire pending buffer + emit `\x1bc` (hard reset) + a dim notice** (e.g., `\x1b[2m[exegol: output buffer overflow — earlier output dropped]\x1b[0m\n`). **Never slice a partial CSI sequence in half.** This is critical.
   - Reference: Terax `session.rs:86-271`.

2. **WebGL context-loss handler** in `TerminalInstance.tsx`:
   - Listen for `webglcontextlost` on the canvas the WebGL addon owns.
   - On lost: schedule a 250 ms timeout, then call `term.loadAddon(new WebglAddon())` to re-attach.
   - **Add a max-retry counter (default 3).** If retries exhausted, fall back to xterm's canvas renderer (or DOM renderer) and log once. **This is the gap in Terax's impl — they infinitely retry. Don't copy that.**
   - On `webglcontextrestored`, reset the counter.

3. **Tests** (extend existing terminal tests):
   - Sidecar buffer overflow → output begins with `\x1bc` after the flush event (mock the underlying PTY data source).
   - WebGL handler max-retry triggers fallback (jsdom-mock the event).

### T115 — DormantRing for hidden panes

**Goal:** hidden panes keep a small in-memory ring so the renderer can replay buffered output instantly when the pane becomes visible again, without waiting for the sidecar's full snapshot.

**Steps:**

1. **New file** `apps/desktop/src/renderer/lib/dormant-ring.ts`:
   - Bounded chunk ring: max **256 KB** total, max **256 chunks** count, whichever hits first.
   - `class DormantRing { write(chunk: string): void; drain(): string; clear(): void }`
   - On overflow: keep the most recent slice, prepend `\x1bc` (hard reset) + a dim `[buffer overflow]` notice. Same pattern as the sidecar flusher.
   - Reference: Terax `dormantRing.ts:1-71`.

2. **Hook** `useDormantRing(paneId)` consumed by `TerminalInstance.tsx`:
   - When `paneVisible === false`, route incoming PTY data into the ring instead of writing to xterm.
   - When `paneVisible` transitions to `true`, drain the ring and write to xterm in one shot, then resume live writes.
   - If the ring is empty on un-hide (or overflowed), trigger a snapshot request from the sidecar (existing path).

3. **Tests** (`apps/desktop/src/renderer/lib/dormant-ring.test.ts`):
   - Writing under 256 KB → drain returns exact concatenation
   - Writing over 256 KB → drain returns `\x1bc...[overflow notice]...[recent slice]`
   - Chunk count cap: 257 small chunks → 256 retained
   - `clear()` empties

### Refactor split — `TerminalInstance.tsx`

The file is at **425 LOC** today. T113 (WebGL handler) + T115 (DormantRing wiring) will push it well over the 500 LOC project limit if left as one file. **Split it now** as part of this WT, BEFORE adding T113/T115 logic.

**Suggested split** (you may adjust if it improves cohesion, but stay within `renderer/components/terminal/`):

- `TerminalInstance.tsx` — public component, ref forwarding, lifecycle (mount/unmount, resize, focus). Target ≤ 250 LOC.
- `terminal-buffer.ts` — pure helpers for buffer scroll/position math (the `atTop`/`atBottom` computation).
- `terminal-webgl.ts` — WebGL addon attach + context-loss recovery (T113 lives here).
- `terminal-dormant-wiring.ts` — DormantRing integration glue (T115 lives here).
- `terminal-types.ts` — shared `TerminalHandle`, `TerminalProps`, etc.

Keep public API identical (consumers must not change imports).

## Files allowed to modify or create

**Modify:**
- `apps/desktop/src/main/terminal/pty-sidecar-entry.ts`
- `apps/desktop/src/main/terminal/shell-wrappers.ts`
- `apps/desktop/src/renderer/components/terminal/TerminalInstance.tsx`
- `apps/desktop/src/renderer/stores/workspace.ts` (additive only — new per-pane state slices; do not refactor existing slices)
- `docs/TASK_TODO.md` (remove T112/T113/T115 entries when complete)
- `docs/tasks_completed/2026_05.md` (log your commits at the end)

**Create:**
- `apps/desktop/src/main/terminal/shell-integration/` (entire folder + init scripts)
- `apps/desktop/src/renderer/components/terminal/osc-handlers.ts`
- `apps/desktop/src/renderer/components/terminal/osc-handlers.test.ts`
- `apps/desktop/src/renderer/components/terminal/terminal-buffer.ts` (from split)
- `apps/desktop/src/renderer/components/terminal/terminal-webgl.ts` (from split)
- `apps/desktop/src/renderer/components/terminal/terminal-dormant-wiring.ts` (from split)
- `apps/desktop/src/renderer/components/terminal/terminal-types.ts` (from split)
- `apps/desktop/src/renderer/lib/dormant-ring.ts`
- `apps/desktop/src/renderer/lib/dormant-ring.test.ts`

## Files you MUST NOT touch (other WTs own them)

- `apps/desktop/src/renderer/components/terminal/TerminalPanel.tsx` — **WT4 owns this**
- `apps/desktop/src/renderer/components/terminal/ChatView.tsx` — out of scope
- `apps/desktop/src/renderer/components/terminal/AgentStopReason.tsx` — WT4 will create this
- `apps/desktop/src/main/agents/*` — WT4 owns
- `apps/desktop/src/main/pipeline/*` — WT4 owns
- `apps/desktop/src/main/security/*` — WT2 owns
- `apps/desktop/src/main/ipc/router.ts` — WT2 owns
- `apps/desktop/src/preload/*` — WT2 owns
- `apps/desktop/src/renderer/index.html` — WT2 owns (CSP header)
- `packages/core-rust/*` — WT3 owns
- `packages/shared/src/types/agent.ts` — WT4 owns (isolationMode field)
- `apps/desktop/src/main/db/migrations.ts` — append-only; WT4 may append here
- `apps/desktop/electron.vite.config.ts`, `electron-builder.ts`, `package.json` — do not modify

If you discover a real cross-cutting need, **stop and write a note** in your final PR description explaining the problem. Do not silently expand scope.

## Success criteria / Definition of Done

A PR opens from your worktree against `main` with all of the following:

- [ ] T112: shell-integration scripts present, materialized on first run, wrapped into shell-pane spawn for zsh and bash. OSC 7 cwd flows into workspace store. OSC 133 D exit code flows into workspace store. SSH spoofing guard verified by test.
- [ ] T113: sidecar flusher overflow drops pending + emits `\x1bc`. WebGL context-loss handler recovers with max-retry counter.
- [ ] T115: `DormantRing` class + `useDormantRing` hook. Hidden panes route into ring; un-hide drains and resumes live.
- [ ] `TerminalInstance.tsx` split — each file in the new set ≤ 300 LOC.
- [ ] **Zero new dependencies** added unless explicitly justified in PR description. (You should not need any.)
- [ ] All quality gates pass — see below.
- [ ] PR description includes: file-by-file summary, screenshots of cwd badge behavior in a shell pane, screenshot of overflow notice, before/after LOC of split files.

## Quality gates (run before EVERY commit, all green required)

```bash
# Typecheck
bun run typecheck

# Lint + format (must be 0 errors, 0 warnings)
npx @biomejs/biome check apps/ packages/shared/src/ packages/ui/src/

# JS tests (all suites green, new tests included)
bun run test

# Rust (you should not be modifying Rust, but verify nothing regresses)
cd packages/core-rust && cargo check && cargo clippy -- -D warnings && cargo test

# Production build (the real safety net)
bun run build
```

If any gate fails, **fix the root cause** — do not skip hooks, do not `--no-verify`, do not lower lint rules.

## Commits

- One commit per task is preferred: `feat(T112): ...`, `feat(T113): ...`, `feat(T115): ...`.
- The TerminalInstance split can be its own prep commit: `refactor: split TerminalInstance.tsx into focused modules`.
- Use conventional commits. Body should explain **why**, not what (the diff shows what).
- Co-author trailer (will be added by your harness automatically).

---

## Engineering best practices (read before coding)

These apply to every change you make. Most are codified in the project's `CLAUDE.md` files — re-read them for context.

### 1. Scope discipline
- Work **only** within "Files allowed". Cross-cutting needs go in the PR description, not the diff.
- File splits ARE in scope but limited to `TerminalInstance.tsx`. Do not refactor neighbors "while you're there".
- No "nice-to-have" features. If the brief doesn't ask for it, it doesn't go in.

### 2. Read before you write
- Before editing any file, read it end-to-end (or at least the section + surrounding context). The harness Read tool is cheap; bad assumptions are expensive.
- Read the Terax source pointers (`/Users/peluche/dPeluCheData/PROJECTS/dPeluChe/_code_/_repos_2_learn/github.com/crynta/terax-ai/...`) — they are the reference impl. Lift patterns, don't reinvent.

### 3. TypeScript discipline
- No `any` unless absolutely unavoidable (and then add a one-line comment why).
- No non-null assertions (`x!`) — Biome will flag them. Use type narrowing or optional chaining (`x?.`).
- Prefer `type` aliases over `interface` for object shapes that won't be extended (project convention).
- Use `import type { ... }` for type-only imports.

### 4. No new dependencies
- This WT does not require any new npm/cargo deps. If you think you need one, **stop and explain in PR**. Most likely there's a built-in or existing util.

### 5. Comments policy
- Default: **no comments**. Well-named identifiers and small functions document themselves.
- Add a comment **only** when the WHY is non-obvious — a hidden constraint, subtle invariant, workaround for a specific bug. Reference the bug/issue if you can.
- Never explain WHAT the code does. Never multi-paragraph docstrings.

### 6. Match existing code style
- Look at 2-3 neighbor files before writing. Match indentation, import order (Biome enforces), naming conventions, file structure.
- Tabs vs spaces, single vs double quotes — match what's there.

### 7. Small focused commits
- One logical change per commit. Don't bundle unrelated work.
- Commit message body explains **why**, headline explains **what** in present tense imperative.
- Keep diffs reviewable — if a commit exceeds ~400 lines, ask yourself if it can be split.

### 8. Test what you ship
- Every new pure function deserves a unit test. Especially: OSC parsers, ring buffer overflow logic, retry counters.
- Use Vitest patterns from existing tests as templates.
- Mock the absolute minimum — prefer real strings, real bytes, real state machines.
- If you can't easily test it, that's signal the design is wrong.

### 9. Error handling discipline
- Don't add try/catch for cases that can't happen. Trust framework guarantees.
- Only validate at system boundaries — incoming OSC bytes, untrusted input. Internal callers can be trusted.
- For overflow / context-loss / retry-exhausted: **degrade gracefully + log once**. Don't silently swallow, don't crash the renderer.

### 10. Performance awareness
- xterm runs on every keystroke. OSC handlers run on every escape sequence — keep them O(1) in the hot path.
- The 4 ms coalesce window in the sidecar exists for a reason. Don't reduce it without measuring.
- Avoid allocating in tight loops — reuse buffers where the API allows.

### 11. Threat model awareness
- The SSH spoofing guard on OSC 7 is **not optional**. A user SSH'd into a remote box can emit OSC 7 from inside their remote shell — those bytes flow through our PTY → our handler. If we accept them, our cwd badge lies and any feature built on it (Smart Git Button, future "open IDE here") becomes unreliable.
- Same logic applies to other OSC sequences that can carry user-controllable data.

### 12. Quality gate hygiene
- Run gates **before each commit**, not just before the PR.
- If a gate flakes, find out why — don't retry until green.
- The build is the ultimate truth. If typecheck passes but build fails, the build wins.

### 13. Don't iterate on passing code
- One pass. Don't refactor / polish / over-engineer unless asked.
- If your first solution works and is clean, ship it. Saving 5 lines is not worth a second review cycle.

### 14. Document deferred items
- Anything you can't finish: add a clear TODO comment with reasoning + a note in the PR description.
- Do not leave half-finished features. Either complete or back-out cleanly.

### 15. PR description is part of the work
- Write the PR description as you go — keep a scratch in your editor.
- It should answer: what changed, why it changed, how it was verified, what was deferred, what to look out for in review.
- Screenshots / terminal recordings beat 1000 words for UI-affecting changes.

---

## Out of scope (explicitly)

Do NOT do any of the following, even if they seem related:

- T114 (xterm renderer pool) — too large for this WT
- Anything touching `TerminalPanel.tsx` (WT4 owns)
- Anything touching agents, pipelines, scoring, MCP host
- Security regex / CSP / capability allowlist (WT2 owns)
- Rust search crates (WT3 owns)
- Cosmetic UI polish unless it's the cwd badge being added by T112
- Renaming variables / moving files outside the allow list
- Adding new dependencies
- Updating `package.json` or `bun.lock` (you should not need to)
- Modifying anything in `docs/RESEARCH/` (read-only reference)

## When you finish

1. Final quality gate pass (typecheck + biome + tests + build) — all green.
2. Update `docs/tasks_completed/2026_05.md` with a "WT1" section (commits + brief outcome bullets per task).
3. Remove T112, T113, T115 from `docs/TASK_TODO.md` Active Backlog + from Wave 1 priority order.
4. Push branch + open PR with a thorough description.
5. Stop. Do not start adjacent work.
