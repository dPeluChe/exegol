# WT2 — Security Hardening (Defense-in-Depth)

> **Worktree mission:** raise Exegol's security posture to production-grade by tightening the renderer/main boundary and refusing obviously dangerous filesystem + command operations. This brief is your **canonical scope**. Do NOT pick tasks from `docs/TASK_TODO.md` outside this brief.

## Tasks bundled in this WT

- **T117** — Security hardening: expand `path-guard.ts` + create `command-guard.ts` (Small)
- **T118** — Tighten the renderer CSP header (Small)
- **T119** — Capability allowlist pattern for the preload bridge (Medium)

## Why these matter (do not skip)

Exegol runs an Electron renderer that:
- Loads arbitrary user URLs in a `<webview>` (browser pane). One XSS in our renderer or a vulnerable webview hands an attacker access to the entire preload bridge.
- Spawns agent CLIs that ingest model output. A malicious or compromised model could try to coerce the agent into running destructive commands.
- Reads files based on inputs that originate (eventually) from LLM tools.

Today our defenses are:
- A narrow `isPathAllowed()` that checks symlink-resolved containment.
- A permissive CSP that allows `cdn.jsdelivr.net` (unused by our code), `frame-src *`, `child-src *`.
- No allowlist on the preload bridge — anything wired through `contextBridge` is callable by any code running in the renderer.

We don't add features in this WT — we **harden boundaries**. Terax-AI ships a much stricter version of each of these, and we lift their patterns.

## Reference reading (read FIRST, before any code)

1. `docs/RESEARCH/TERAX_STACK_REVIEW.md` § **Area 3: Shell host (Tauri vs Electron)** — the rationale + file pointers.
2. `CLAUDE.md` at repo root — Exegol architecture summary (preload + IPC sections especially).
3. `apps/desktop/src/main/security/path-guard.ts` (current 51 LOC) — what's already there.
4. `apps/desktop/src/main/security/path-guard.test.ts` — existing test conventions.
5. `apps/desktop/src/preload/index.ts` (140 LOC) — the current bridge surface.
6. `apps/desktop/src/main/ipc/router.ts` (58 LOC) — the tRPC router shape.
7. `apps/desktop/src/renderer/index.html` — the existing CSP `<meta>` tag.

Then read these Terax files:
- `terax-ai/src/modules/ai/lib/security.ts` (`31-402`) — the canonical command/path guard regex + bidi-char detection.
- `terax-ai/src-tauri/capabilities/default.json` (`9-28`) — capability allowlist pattern.
- `terax-ai/src-tauri/tauri.conf.json` (around line 27) — the strict CSP they ship.

Terax repo path on disk: `/Users/peluche/dPeluCheData/PROJECTS/dPeluChe/_code_/_repos_2_learn/github.com/crynta/terax-ai`

## Implementation plan

### T117 — `path-guard.ts` expansion + new `command-guard.ts`

**Goal:** refuse obviously dangerous filesystem operations AND obviously destructive shell commands at the IPC/security boundary.

#### Part A — expand `path-guard.ts`

Keep the existing API surface (`isPathInside`, `realpathSafe`, `isPathAllowed`) — they are used by callers and tests pass. Add the following:

1. **Bidi-character detection** (`hasBidiChars(name: string): boolean`):
   - Scan for Unicode bidi format chars: `U+202A`–`U+202E`, `U+2066`–`U+2069`.
   - Used to defeat "Trojan Source" attacks where filenames or paths visually mislead reviewers.
   - Refuse any path whose basename or any segment contains these.

2. **NTFS Alternate Data Stream (ADS) check** (`hasAdsSuffix(name: string): boolean`):
   - Reject names containing `:` after the drive letter (e.g. `file.txt:hidden_stream`).
   - On Windows, ADS lets attackers hide content behind innocent-looking files.
   - This is Windows-future-proofing — we don't have Windows builds yet but the code path is cheap.

3. **Sensitive-path refusal** (`isSensitivePath(p: string): boolean`):
   - Refuse paths inside or referencing: `.env*`, `.ssh/`, `.aws/credentials`, `.config/gh/`, `.gnupg/`, `.netrc`, `.npmrc`, `.docker/config.json`, system keychain dirs (`~/Library/Keychains/`).
   - Match basename + full-path-contains patterns. Be conservative — false positives are acceptable here; false negatives are not.

4. **`assertSafePath(p: string, opts: { allowedBases: string[] })`** — a one-shot helper that combines: bidi check → ADS check → sensitive path → realpath-resolved containment via `isPathAllowed`. Throws a typed `PathGuardError` with a `reason` field on refusal.

Keep all existing exports working unchanged — callers should be able to opt into the new helpers without breaking.

#### Part B — new `command-guard.ts`

Create `apps/desktop/src/main/security/command-guard.ts`:

```
export type CommandRefusal =
  | { ok: false; reason: "fork-bomb" | "rm-rf-root" | "dd-of-disk" | "curl-pipe-sh" | "bidi-chars"; matched: string }
  | { ok: true };

export function inspectCommand(cmd: string): CommandRefusal;
```

Patterns to refuse (lift verbatim from Terax `security.ts:31-402`, adapt to a regex table):

- **Fork bombs**: classic `:(){ :|:& };:` and obvious variants
- **`rm -rf` on home or root**:
  - `rm -rf /` (with optional flags before `-rf`)
  - `rm -rf ~`, `rm -rf $HOME`, `rm -rf ${HOME}`
  - `rm -rf .` / `rm -rf ..` / `rm -rf *` at the root level
- **`dd of=/dev/sd*|hd*|nvme*|disk*`** — direct device writes
- **Curl/wget piped to shell**: `curl … | sh`, `curl … | bash`, `wget -O- … | sh`, etc.
- **Bidi chars in command** — same detection as path guard

`inspectCommand` is **side-effect free**, returns a refusal verdict. Callers decide whether to log + reject. Today, the only call site we add is in the agent spawn path — find where `AgentManager.spawn` (or whatever currently constructs the shell command for the agent CLI) and gate it. If the WT4 surface is unstable here, just create the helper + the test and document the integration point in the PR description; we can wire it later.

#### Part C — tests

Co-locate tests next to the modules (project convention, not a `__tests__` folder):

- `apps/desktop/src/main/security/path-guard.test.ts` — extend the existing file with cases for bidi chars, ADS, sensitive paths, and the `assertSafePath` helper.
- `apps/desktop/src/main/security/command-guard.test.ts` — new file with at least one case per refusal category + at least 3 cases that SHOULD pass (a normal `npm install`, a `git status`, a multi-line cmd that contains `rm` in a safe context like inside a comment string).

### T118 — Tighten the renderer CSP

The current `<meta http-equiv="Content-Security-Policy">` in `apps/desktop/src/renderer/index.html` is more permissive than it needs to be. Tighten it without breaking the app:

**Required changes:**

1. **Remove `https://cdn.jsdelivr.net`** from all directives — no code references it (`grep -r cdn.jsdelivr apps/desktop/src/` returns only the CSP itself).
2. **Add `wasm-unsafe-eval`** to `script-src` only if needed — Terax uses this for tree-sitter / wasm modules. Audit: does any code we run (streamdown's mermaid? something else?) need it? If yes, add it; if no, skip. Document the decision in the PR.
3. **Add `connect-src`** with an explicit allowlist of HTTPS endpoints we hit directly from the renderer or main process:
   - `https://api.anthropic.com` (Smart Git Button + scoring)
   - `https://api.github.com` (GitHub procedures)
   - `https://github.com` (release downloads)
   - `https://cdn.jsdelivr.net` (DROP — we don't use it)
   - Add others by grepping for `fetch(` in main + renderer and listing every external host.
   - Localhost / `http:` connections during dev: gated by `is.dev` if we can detect at runtime, otherwise leave as `'self'` only and let dev tools complain.
4. **Keep `frame-src *` + `child-src *`** for the browser pane webview — but **add a comment** explaining why (so future maintainers don't tighten it blindly and break the browser pane).
5. **Drop any `'unsafe-eval'`** — verify nothing depends on `eval()`. Tailwind v4 doesn't need it.

The CSP `<meta>` tag is a long single-line string. Make it readable by splitting across lines in the source (HTML allows whitespace inside attribute values).

**Verification step:** after changing CSP, smoke-launch the app (`bun run dev`) and check the DevTools Console for CSP violations. Iterate on the policy if anything legitimate breaks.

### T119 — Capability allowlist for the preload bridge

**Goal:** an attacker who lands XSS in the renderer can only reach the tRPC routes and IPC channels listed in a declarative allowlist — not the full preload surface.

#### Step 1 — Create `apps/desktop/src/preload/capabilities.json`

Structure:

```jsonc
{
  "$schema": "Capabilities allowlist — see docs/ARCHITECTURE/CAPABILITIES.md",
  "trpc": {
    "projects": "*",
    "agents": "*",
    "settings": "*",
    "// ...": "list every router currently in main/ipc/router.ts",
    "// Wildcard `*` means: all procedures under this router are allowed."
  },
  "ipc": [
    "terminal:write",
    "terminal:resize",
    "terminal:data",
    "terminal:get-snapshot",
    "terminal:save-clipboard-image",
    "menu:new-tab",
    "menu:close-pane",
    "agent:handoff",
    "// ...": "list every channel currently used in preload/index.ts"
  ]
}
```

Generate the lists by reading the existing `ipc/router.ts` (you saw the routers) + `preload/index.ts` (you saw the channels). **The initial allowlist must accept everything the renderer currently calls** — this PR is about adding the gate, not breaking the app.

#### Step 2 — Enforce in `preload/index.ts`

Load the JSON at preload load time. Wrap every forwarding call in a check:

- `trpc.invoke(path, input)` — verify `path` matches the allowlist (`router.procedure` form; support `router.*` wildcard).
- `ipc.send(channel, ...args)` / `ipc.invoke(channel, ...args)` / `ipc.on(channel, ...)` — verify `channel` is in the allowlist.

On refusal: throw a typed error (e.g. `new Error("Capability denied: ${path}")`) and log via `console.warn`. The renderer's TanStack Query will surface this naturally.

Keep the existing public API — `window.api.trpc.invoke`, `window.api.terminal.write`, etc., should all still work. The gate is internal.

#### Step 3 — Defense in depth: re-check in main

In `apps/desktop/src/main/ipc/router.ts` (or wherever the IPC `trpc` handler is registered — likely `registerTrpcIpcHandler` in `ipc/trpc-ipc.ts`):

- Load the same `capabilities.json` (copy it to `out/main/` at build time if needed, or read from the original location).
- On every `trpc` invoke, verify the path is in the allowlist. Reject if not.
- This protects against a compromised preload.

#### Step 4 — Documentation

Create `docs/ARCHITECTURE/CAPABILITIES.md`:

- Explain the threat model (XSS in renderer → blast radius bounded).
- Document how to add a new capability when wiring a new feature: update `capabilities.json`, regenerate, confirm preload + main agree.
- Note any wildcards used and the trade-off.

## Files allowed to modify or create

**Modify:**
- `apps/desktop/src/main/security/path-guard.ts`
- `apps/desktop/src/main/security/path-guard.test.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/main/ipc/router.ts` (only if you wire the allowlist check here; preferred location: a small helper in `ipc/capabilities.ts`)
- `apps/desktop/src/main/ipc/trpc-ipc.ts` (allowlist check, if it lives here — investigate)
- `apps/desktop/src/renderer/index.html` (CSP tightening only — do NOT touch the splash / body / scripts)
- `docs/TASK_TODO.md` (remove T117/T118/T119 entries when complete)
- `docs/tasks_completed/2026_05.md` (log your commits)

**Create:**
- `apps/desktop/src/main/security/command-guard.ts`
- `apps/desktop/src/main/security/command-guard.test.ts`
- `apps/desktop/src/preload/capabilities.json`
- `apps/desktop/src/main/ipc/capabilities.ts` (helper to load + check)
- `docs/ARCHITECTURE/CAPABILITIES.md`

## Files you MUST NOT touch (other WTs own them)

- `apps/desktop/src/main/terminal/*` — **WT1 owns**
- `apps/desktop/src/renderer/components/terminal/*` — WT1 + WT4 territory
- `apps/desktop/src/main/agents/*` — **WT4 owns**
- `apps/desktop/src/main/pipeline/*` — WT4 owns
- `apps/desktop/src/main/db/migrations.ts` — WT4 may append migrations
- `packages/core-rust/*` — **WT3 owns**
- `apps/desktop/src/renderer/stores/workspace.ts` — WT1 + WT4 touch this
- `packages/shared/src/types/agent.ts` — WT4 owns
- `apps/desktop/electron.vite.config.ts`, `electron-builder.ts`, `package.json` — out of scope
- Renderer feature components (workspace sections, settings panels, etc.) — out of scope

**Specifically for T117 Part B**: if integrating `inspectCommand` into the agent spawn path would force you to edit `apps/desktop/src/main/agents/manager.ts` (WT4 territory) or `apps/desktop/src/main/agents/spawn-env.ts`, **don't**. Ship the helper + tests. Document the integration point in the PR description as a follow-up task; WT4 or a later PR can wire it.

## Success criteria / Definition of Done

A PR opens from your worktree against `main` with all of the following:

- [ ] T117 path-guard: bidi-char, ADS, sensitive-path helpers + `assertSafePath`. Existing path-guard tests still pass + new tests cover each refusal type.
- [ ] T117 command-guard: `inspectCommand` covers fork bombs, `rm -rf` patterns, `dd of=/dev/*`, `curl|sh`, bidi chars. Test file covers each refusal + ≥3 passing cases.
- [ ] T118 CSP: jsdelivr removed, explicit `connect-src` allowlist, comment on `frame-src *`. DevTools Console shows zero CSP violations on a smoke-launched app for the basic flow (open settings, open file explorer, spawn a pane).
- [ ] T119 capability allowlist: JSON file present, preload enforces, main re-checks, `docs/ARCHITECTURE/CAPABILITIES.md` written.
- [ ] **Zero new dependencies** — none of this needs one.
- [ ] All quality gates pass — see below.
- [ ] PR description includes: file-by-file summary, the exact diff of the CSP `<meta>` content (before/after), a list of capabilities (router paths + IPC channels) the allowlist accepts, and a note on whether `inspectCommand` is wired into the spawn path or deferred.

## Quality gates (run before EVERY commit, all green required)

```bash
# Typecheck
bun run typecheck

# Lint + format (must be 0 errors, 0 warnings)
npx @biomejs/biome check apps/ packages/shared/src/ packages/ui/src/

# JS tests (all suites green, new tests included)
bun run test

# Rust (verify nothing regresses — you should not be modifying Rust)
cd packages/core-rust && cargo check && cargo clippy -- -D warnings && cargo test

# Production build (the real safety net)
bun run build
```

If any gate fails, **fix the root cause** — do not skip hooks, do not `--no-verify`, do not lower lint rules.

## Commits

- One commit per task is preferred: `feat(T117): path-guard + command-guard hardening`, `feat(T118): tighten renderer CSP`, `feat(T119): preload capability allowlist`.
- The `docs/ARCHITECTURE/CAPABILITIES.md` may be its own commit or live with T119.
- Use conventional commits. Body explains **why** (the threat being mitigated), not **what** (the diff shows what).

---

## Engineering best practices (read before coding)

These apply to every change you make. They are codified in the project's `CLAUDE.md` — re-read it for context.

### 1. Scope discipline
- Work **only** within "Files allowed". Cross-cutting needs go in the PR description, not the diff.
- No "while I'm here" refactors. Security work is high-leverage; surprises are dangerous. Keep diffs minimal and focused.

### 2. Read before you write
- Before editing any file, read it end-to-end. Security boundaries are easy to break by accident.
- Read Terax's `security.ts` carefully — it has subtle handling (e.g. command pattern that allows `git status` but refuses `rm -rf /`). Lift it; don't invent.

### 3. TypeScript discipline
- No `any` — security helpers must have precise types. The refusal sum type (`CommandRefusal`) is exhaustively check-able and tests should exercise every branch.
- No non-null assertions (Biome will flag). Use type narrowing.
- Prefer `type` aliases over `interface` for these helpers.
- Use `import type { ... }` for type-only imports.

### 4. No new dependencies
- All three tasks are pure logic + config. No npm/cargo deps required. If you find yourself wanting one, stop and explain.

### 5. Comments policy
- Default: **no comments**.
- Exception (and you'll use it more in this WT than usual): when a regex refuses something subtle, a one-line `// refuses: rm -rf with optional flags between rm and -rf, e.g. "rm -fr /"` is justified WHY-context.
- Never explain WHAT a function does — the name + signature should suffice.

### 6. Match existing code style
- Look at `path-guard.ts` + `path-guard.test.ts` — they set the bar for this folder. Match their patterns.
- Test naming: `describe("functionName")` with nested `it("does X")` cases.

### 7. Small focused commits
- One logical change per commit. Don't bundle path-guard + command-guard if they ship in separate test files.
- The CSP commit should be a single-line diff in `index.html` + the matching commit message. Easy to review = easier to merge.

### 8. Test what you ship
- Security helpers without tests are a liability. **Every refusal pattern must have at least one passing test.** Every "should be allowed" case should have at least one passing test.
- Use `it.each` for parametrized cases — DRY beats copy-paste in test files.
- Aim for ≥95% line coverage on the new files (this is realistic given how small they are).

### 9. Error handling discipline
- For security refusals: throw a typed error with a `reason` field. Callers should be able to log and surface it. Do not return `null` / `undefined` for "refused" — that's ambiguous with "missing".
- For the CSP `connect-src` allowlist: if you're not sure a host is hit, **grep the codebase first**. Don't add hosts on speculation. Adding a host is a one-line follow-up if something breaks.

### 10. Performance awareness
- All these checks run on the hot path (every IPC call, every spawn). Keep them O(1) or O(n) in command length.
- Pre-compile regex patterns at module scope, not per-call.
- Don't allocate per-call where you can return early.

### 11. Threat model awareness
- The point of this WT is reducing blast radius from compromise. Every design decision should be evaluated as: "If an attacker controlled this input, what's the worst they could do, and does my code make that worse OR contain it?"
- Conservatism beats cleverness here. False positives (refusing a benign `rm` inside a comment) are acceptable; false negatives are not.
- Do not add escape hatches ("ignore the guard if env var X is set"). The guard is the guard.

### 12. Quality gate hygiene
- Run gates **before each commit**. Especially the build — CSP violations show up at runtime; the build also catches some loaders that need `unsafe-eval` etc.
- If a CSP tightening breaks a real feature (e.g. some legitimate font CDN), DOCUMENT the host you're adding back + reason, don't silently revert.

### 13. Don't iterate on passing code
- One pass. If your first regex refuses fork bombs correctly, ship it. Don't golf it to a one-liner.

### 14. Document deferred items
- If you can't wire `inspectCommand` into the agent spawn path without crossing into WT4 territory: ship the helper + tests, document the integration point clearly in the PR, and move on.
- Any other deferrals go into the PR description as a "follow-ups" section.

### 15. PR description is part of the work
- Include: threat → mitigation mapping for each refusal pattern, the exact new CSP, the capabilities allowlist diff, and a list of cases tested.
- For security changes, reviewers should not have to guess what's protected.

---

## Out of scope (explicitly)

- Anything inside `main/terminal/`, `main/agents/`, `main/pipeline/`, `main/db/`, `packages/core-rust/`
- Wiring `inspectCommand` into the agent spawn path (WT4 territory if it requires editing manager.ts)
- Browser-pane URL filtering (separate, future task)
- Settings UI for the user to toggle security gates (not now)
- Rewriting `keystore.ts` (out of scope — works fine today)
- Adding new tRPC routers or IPC channels (allowlist gates existing ones; doesn't add new)
- Modifying `package.json` or `bun.lock`
- Modifying anything in `docs/RESEARCH/` (read-only reference)

## When you finish

1. Final quality gate pass (typecheck + biome + tests + build) — all green.
2. Smoke-launch the app (`bun run dev`) and verify zero CSP violations in DevTools Console for the basic flow.
3. Update `docs/tasks_completed/2026_05.md` with a "WT2" section (commits + outcome bullets per task).
4. Remove T117, T118, T119 from `docs/TASK_TODO.md` Active Backlog + from Wave 1 priority order.
5. Push branch + open PR with a thorough description (threat → mitigation, before/after CSP, capability list).
6. Stop. Do not start adjacent work.
