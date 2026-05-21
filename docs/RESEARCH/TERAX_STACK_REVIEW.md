# Terax-AI Stack Review — what we can lift into Exegol

Scope: comparative architecture review against the Terax-AI terminal emulator
(`/_repos_2_learn/github.com/crynta/terax-ai`, v0.7.0, Tauri 2 + React 19 + Vercel AI SDK v6).
Goal is **optimizations / libraries / patterns we can adopt**, not feature parity.
Exegol is a multi-agent orchestrator with strictly more surface (pipelines, MCP,
oplog, scoring, scheduler, sidecar). Terax is a single-window terminal with an AI
side-panel — but the parts they ship are sharper than ours in several places.

## TL;DR

1. **Add OSC 7 + OSC 133 shell-integration init scripts** — Terax injects zsh / bash / fish / pwsh rc files that emit `OSC 7` (cwd) and `OSC 133 A/B/C/D` (prompt boundaries + exit code). This gives us *trustworthy* cwd, *trustworthy* command boundaries, and exit codes for free in `terminal` panes, without the hand-rolled status parsing that lives in our Rust `status_parser.rs`. Effort: **M**.
   Files to read: `src-tauri/src/modules/pty/scripts/zshrc.zsh`, `bashrc.bash`, `profile.ps1`; `src/modules/terminal/lib/osc-handlers.ts:1-86`.

2. **Adopt `streamdown` + `use-stick-to-bottom` for any rendered AI markdown / streaming text panes.** Both are bundle-friendly (single-purpose), and `use-stick-to-bottom` solves "should the scrollback auto-stick to the bottom?" properly (we re-implement weak versions of this in `TerminalPanel`). Effort: **S**.

3. **Replace our two direct Anthropic `fetch()` calls (Smart Git Button + Tier-3 scoring) with Vercel AI SDK v6 (`@ai-sdk/anthropic` + `generateText`).** It gives us provider-cache breakpoint helpers, structured-output via Zod, retries, and the ability to swap Haiku for a cheaper local LM-Studio model with zero code change. Effort: **S**.
   Files to change: `apps/desktop/src/main/ipc/procedures/diff.ts:324-396`, `apps/desktop/src/main/agents/scoring.ts:210-280`.

4. **Adopt `keytar`-style OS keychain for API keys (Electron `safeStorage` is fine but DB-bound).** Terax uses `keyring` (Rust) + an explicit Linux fallback. Our `safeStorage` ties keys to the DB row; rotating the DB drops keys. Effort: **M**.
   Files: `apps/desktop/src/main/security/keystore.ts:1-40` vs `src-tauri/src/modules/secrets.rs:1-80`.

5. **Vite manual-chunking for the AI provider SDKs** — Terax splits each `@ai-sdk/*` into its own chunk so unused providers don't bloat the initial load (`vite.config.ts:32-67`). When we adopt the SDK we should mirror this. Effort: **S**.

6. **Renderer-pool pattern for xterm instances** (Terax keeps a `POOL_MAX_SIZE = 5` slot pool with `data-terax-recycler` off-screen host, snapshot+replay on slot swap, WebGL context-loss recovery). This is materially better than our per-pane `TerminalInstance` and would let us scale to many tabs without N WebGL contexts. Effort: **L** (cross-cuts WorkspacePane, ring-buffer reattach, snapshot replay). See `src/modules/terminal/lib/rendererPool.ts:1-700`.

7. **Plan-mode + per-hunk diff review for *future* in-process AI flows** (when we add an "Exegol-native" AI tool runner alongside the spawned CLI agents). Terax's `usePlanStore` + `PlanDiffReview` + `needsApproval` flow is the cleanest pattern in the repo. Effort: **M** if we ever build native tools; **0** if we stay CLI-only.

## Side-by-side stack table

| Layer | Exegol | Terax | Verdict |
|---|---|---|---|
| Shell host | Electron 41 | Tauri 2 | **Keep ours** — switching is months, sidecar / libsql / tRPC don't trivially port |
| Renderer build | electron-vite | Vite 7 (frontend) + tauri build | Keep ours, but **steal manual chunks** |
| Frontend framework | React 18 | React 19 | **Adopt React 19** in a future bump (concurrent improvements, Compiler) — M |
| State store | Zustand 5 | Zustand 5 | Match |
| Styles | Tailwind 4 | Tailwind 4 (no config, `@theme` in CSS) | **Move our Tailwind config into CSS `@theme`** — S |
| UI primitives | Radix (per package) + lucide-react | `radix-ui` umbrella + shadcn + **hugeicons** | Hybrid — consider hugeicons for variety, **skip umbrella package** |
| Terminal | xterm 6 + WebGL, per-pane instance | xterm 6 + WebGL + **pooled slot recycler** + dormant ring + OSC 7/133 | **Adopt OSC 7/133**; renderer pool is L but worth it |
| PTY | node-pty via sidecar + 8MB ring buffer + JSON-RPC | portable-pty (Rust) + per-PTY flusher (4ms coalesce) + Job Object on Windows + 4MB ring | Mostly match. **Lift Windows Job Object pattern** when we add Win |
| AI | Direct Anthropic `fetch()` + spawned CLIs | Vercel AI SDK v6 (8 providers) + tools w/ approval + subagents | **Adopt SDK for our internal LLM calls** (S); keep CLI agents |
| Secrets | electron `safeStorage` + SQLite settings table | `keyring` Rust + Linux file fallback | Functionally equivalent; **document our fallback story** — S |
| Editor (read-only) | Monaco | CodeMirror 6 + AI ghost autocomplete + vim mode + 8 themes | **Switch to CodeMirror** if we ever add inline edit / AI ghost — M-L. Monaco is fine for view-only |
| Diff | Custom diff component | `@codemirror/merge` + per-hunk accept/reject in `PlanDiffReview` | **Adopt `@codemirror/merge`** when we move to CodeMirror — S after editor swap |
| Git | git2 (Rust napi) — strong | git2 (Rust) + GraphRail SVG graph | We're stronger here (oplog, undo); **borrow GraphRail SVG idea** for git history viewer — M |
| Markdown stream | react-markdown | **streamdown** | **Adopt streamdown** — S |
| Token counting | log-parser scans agent log files | tokenlens | **Adopt tokenlens** for in-app counter — S |
| Search | grep over fs (via Rust)? we have none built-in | `ignore` + `grep-regex` + `grep-searcher` (Rust) | **Add Exegol-side fuzzy/grep tool** powered by `ignore` + `grep-*` — M (very high ROI for AI tools) |
| Markdown / docs viewer | react-markdown | streamdown | (see above) |
| Auto-update | electron-updater | tauri-plugin-updater + minisign | Match (different mechanisms) |
| Multi-window | floating PiP via BrowserWindow | settings as separate webview window | Both OK; **align settings into its own window** is optional |

## Area 1: AI / Agent layer

### How Terax does it

- **Provider registry + lazy import** (`src/modules/ai/lib/agent.ts:70-211`): every provider SDK is dynamic-imported inside the switch so the bundle only loads what the user actually configured. The model `LanguageModel` is cached by `${provider} ${key} ${id} ${urls}` in `modelCache`.
- **`Experimental_Agent` / `streamText`** with `stopWhen: stepCountIs(MAX_AGENT_STEPS)` and `onStepFinish` to forward tool-call labels to the status bar (`agent.ts:395-438`).
- **Anthropic cache breakpoints** are applied manually — first message + last message get `providerOptions.anthropic.cacheControl = { type: "ephemeral" }` (`agent.ts:294-311`). Other providers do prefix caching automatically.
- **History compaction** (`compactModelMessagesDetailed`) runs every turn against `getModelContextLimit(model)` — we don't compact, we just let the CLI agents handle it.
- **Context-aware transport** (`src/modules/ai/lib/transport.ts:71-114`) wraps the chat with a `getLive()` snapshot every turn (cwd, active file, workspace root, terminal-private mode) and injects an `<env>` block into the last user message. **TERAX.md** is also read once (cached 30s) and pasted as the system "project memory" block (`transport.ts:8-33`). Compare to our memory store — Terax is simpler and dumber, but lazier (only on send, not background).
- **Tools** (`src/modules/ai/tools/`): 7 builders compose into one tool record (`tools.ts`). Each tool is a Vercel `tool()` with `inputSchema: z.object(...)` + `needsApproval: true` for mutating ones. Approval is *built into the SDK* — the chat surfaces a `tool-approval-request` UI part, the user clicks Approve, and the SDK uses `lastAssistantMessageIsCompleteWithApprovalResponses` to resume automatically. We have none of this — our pipelines spawn whole CLI agents per step.
- **Edit invariant**: `edit` / `multi_edit` require prior `read_file` on the same path (`tools/edit.ts:139-152`). Prevents blind edits.
- **`needsApproval` UI** (`components/AiToolApproval.tsx:33-95`): a memoized card with a tool-specific preview, deliberately *not* showing streamed write content (the diff tab is the source of truth).
- **Plan mode**: mutating tools route into `usePlanStore` (`tools/edit.ts:89-104`) instead of executing; `PlanDiffReview` then renders a side-by-side accept/reject UI. We don't have this. Our pipelines have a `plan` access mode that just sets an env var; Terax actually queues mutations as data.
- **Subagents** (`agents/runSubagent.ts:28-75`): named system-prompted mini-agents with read-only tool subsets, invoked from the main chat via a `run_subagent` tool. Uses `generateText` (non-streaming) with a 12-step cap. Notably *not* spawned CLIs — it's the same provider/model running with a smaller tool surface.
- **Security guard** (`lib/security.ts`): basename regex + protected-dir prefix matching + symlink-canonicalize re-check + Trojan Source bidi-char blocking + fork-bomb / `rm -rf /` / `dd of=/dev/disk` / `curl | sh` detection (`security.ts:31-402`). This is **more thorough** than our `path-guard.ts`.

### Where Exegol differs

- We don't have an "in-process LLM" — every AI workflow is a *spawned external CLI* (Claude Code, Codex, Gemini, etc) parsed via the Rust `status_parser.rs`. The SDK doesn't help for that.
- Our two **direct LLM calls** are `apps/desktop/src/main/ipc/procedures/diff.ts:324-396` (Smart Git Button commit-message Haiku) and `apps/desktop/src/main/agents/scoring.ts:210-280` (Tier-3 LLM-as-judge). Both raw `fetch()` to `api.anthropic.com`, no cache breakpoints, no retry, no abort beyond `AbortSignal.timeout(20_000)`.
- We have no tool-approval flow because we don't run tools in-process. Our equivalent is the per-pipeline-step `accessMode: read|write|plan` env var (`apps/desktop/src/main/agents/spawn-env.ts`).
- We have richer downstream features the SDK doesn't help with (oplog, scoring, pipelines, MCP host).

### What to adopt

1. **Swap raw `fetch()` for `@ai-sdk/anthropic` + `generateText`** in `diff.ts:324-396` and `scoring.ts:210-280` (S). Concrete:
   - Add `@ai-sdk/anthropic` + `ai` to `apps/desktop/package.json`.
   - Build a small helper `apps/desktop/src/main/ai/llm.ts` exporting `getAnthropic(db)` that pulls the key from `keystore.ts` and returns an `LanguageModel`.
   - In `suggestCommitMessage`: `const { text } = await generateText({ model: getAnthropic(ctx.db)('claude-haiku-4-5-20251001'), prompt, maxOutputTokens: 120, abortSignal: AbortSignal.timeout(20_000) })`.
   - Same in `evaluateTier3` but with structured output: `const { object } = await generateObject({ schema: z.object({ clarity: z.number().min(1).max(5), ... }) })` — this *replaces* the regex parse on `text.match(/\{[^}]+\}/)`.
   - **Cache breakpoints** would give us a ~30-50% cost reduction on Tier-3 evaluations if we send the same scrollback shape across many agents — copy the `applyCacheBreakpoints` helper from `agent.ts:294-311`.

2. **Borrow `tools/edit.ts:34-87` exact-string-edit algorithm** if/when we add an "Exegol native edit" tool. Their algorithm — substring search + uniqueness check + readCache invariant + replace_all with re-count via `indexOf` loop — is the same pattern Claude Code's `Edit` tool uses and is good prior art.

3. **Lift the security regex** in `src/modules/ai/lib/security.ts:31-402` into `apps/desktop/src/main/lib/path-guard.ts`. Especially the bidi-char check, the NTFS ADS handling (`name:stream` collapse), and `rm -rf ~ / $HOME` detection. Our current guard is narrower.

4. **Memory loading pattern** (`transport.ts:8-33`): mtime-cached read of `TERAX.md` per workspace, 30s TTL, 32KB cap, injected at send-time only. If/when we want a similar "CLAUDE.md → agent prompt" injection inside Exegol (for non-Claude agents that don't auto-load it), this pattern is tiny and the right shape.

### What to skip

- **Don't replace CLI agents with the SDK.** Our value-prop is orchestrating *external* coding agents (Claude Code, Codex, etc) — those have their own tool registries, MCP, plan modes, hooks. Wrapping them in Vercel AI SDK would be a regression. Use the SDK only for our *internal* LLM utility calls.
- **Don't adopt their subagent pattern.** We already have richer pipelines (steps, loops, worktrees, state machine).
- **Don't adopt the SDK's tool-approval flow.** It only makes sense when *you* control the model loop. We don't.

## Area 2: Terminal / PTY

### How Terax does it

- **Per-PTY threads with coalescing flusher** (`src-tauri/src/modules/pty/session.rs:86-271`): reader thread → shared `Mutex<Vec<u8>>` → flusher thread with `FLUSH_COALESCE = 4ms` window, `MAX_PENDING = 4 MiB`. On overflow: discard the **entire** pending buffer + emit `ESC c` (hard reset) + a dim notice — they deliberately don't slice a partial CSI sequence in half. Our PTY sidecar has a similar 8MB ring but the coalescing logic is different. **The 4ms-coalesce + `ESC c` discard pattern is worth lifting**.
- **OSC 7 + OSC 133 shell integration**:
  - Init scripts in `src-tauri/src/modules/pty/scripts/{zshenv,zprofile,zlogin,zshrc}.zsh`, `bashrc.bash`, `init.fish`, `profile.ps1`. Loaded via `ZDOTDIR` (zsh), `--rcfile` (bash), or `pwsh -File`.
  - `zshrc.zsh:1-60` emits `OSC 133 A` (prompt-start) on `precmd`, `OSC 133 B` (prompt-end, re-injected if framework like p10k rebuilt PS1), `OSC 133 C` (pre-exec), `OSC 133 D;<exit>` (command done with code).
  - Frontend OSC handlers (`src/modules/terminal/lib/osc-handlers.ts:19-86`) track `inCommand` state and **reject OSC 7 updates emitted while a command is running** (so a remote SSH session can't spoof cwd). This is the right threat model.
- **Windows Job Object** (`src-tauri/src/modules/pty/job.rs:1-73`): every ConPTY child is assigned to a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. When the handle drops, the kernel kills the entire process subtree. Without this, killing pwsh leaves `npm run dev` orphaned.
- **SPAWN_LOCK** (`session.rs:62`) — Windows-only mutex around `openpty + spawn`. ConPTY has a documented race when two `CreatePseudoConsole` calls interleave.
- **Drop order matters** — `session.rs:29-46` documents that `_job` must drop before `master` because `ClosePseudoConsole` on Windows blocks on conhost draining. Lifecycle subtlety we don't have because we're not on Windows yet.
- **Renderer pool** (`src/modules/terminal/lib/rendererPool.ts:1-700`):
  - At most **5 xterm slots** (each with FitAddon + SearchAddon + SerializeAddon + WebLinks + WebGL).
  - When a tab is hidden, its slot is *released*: serialize the screen (5000-line cap) into a string, push the live ring into a `DormantRing` (256KB / 256 chunks bounded), detach the host from the recycler, mark the slot free.
  - When the tab comes back: pick the best slot (LRU, deprioritize alt-screen + focused), `term.reset()`, write the snapshot, replay the dormant ring. For alt-screen TUIs (vim, htop): *discard* the ring and force a SIGWINCH "kick" so the TUI repaints from scratch.
  - WebGL context-loss handler with 250ms recovery delay (WebKit may lose contexts on sleep/wake).
  - Hosts live in a permanent off-screen `data-terax-recycler` div, `position: fixed; left: -99999px`, with `contain: strict`. Hides via `visibility: hidden` + `requestAnimationFrame x2` before unhiding (avoids flash).
- **DormantRing** (`dormantRing.ts:1-71`): 256KB / 256-chunk bounded chunk ring. On overflow: keep the most recent slice + an `ESC c` + notice (same pattern as Rust ringbuffer).
- **OSC 133 prompt tracker** (`osc-handlers.ts:37-74`) registers `IMarker` at each `A` marker so the UI can "jump to previous prompt" / select last command output.
- **DA filter** (`src-tauri/src/modules/pty/da_filter.rs`) — strips spurious Device Attribute queries.
- **Multiple PTY modes**:
  - `pty_*` — interactive long-lived (the actual terminal tab).
  - `shell_run_command` — one-shot for AI tools, builds via `build_oneshot_command` (PowerShell or `$SHELL -lc`).
  - `shell_session_*` — persistent shell with state across calls, uses a **randomized sentinel** per session to track cwd safely against stdout spoofing (`shell/session.rs:35-44`). Wraps each command: `command; __terax_rc=$?; printf '\n%s%s\n' '<sentinel>' "$(pwd)"; exit $__terax_rc`. The strip step uses `rfind(sentinel)` so even if the command output contains the sentinel literal, only the *last* one (from the wrapper) wins.
  - `shell_bg_*` — long-running background processes (dev servers) with bounded ring buffer + log retrieval.

### Where Exegol differs

- We have **one PTY mode** — the long-lived interactive PTY via our sidecar. We don't have one-shot shell or background dev servers as a separate command surface. Both gaps we'd hit when adding richer in-app AI tools.
- Our shell integration is **parsing-based** (`packages/core-rust/src/processing/status_parser.rs` looks for hardcoded status phrases in the ANSI-stripped output) — fragile and locked to specific CLI output formats. Terax's OSC 133 approach is *content-agnostic*.
- We have **one xterm instance per pane** (`TerminalInstance.tsx`) — N panes = N WebGL contexts. We unmount when a tab is hidden (because each pane component owns its xterm). Terax keeps slots alive and recycles them — material win if a user has 10+ open tabs.
- We have **no Windows support** in scope yet, but when we add it, the SPAWN_LOCK + Job Object + drop order patterns from Terax are battle-tested and we should copy them rather than rediscovering.

### What to adopt

1. **OSC 7 + OSC 133 init scripts** (M). Concrete plan:
   - Create `apps/desktop/src/main/terminal/shell-integration/` with `zshrc.zsh`, `bashrc.bash`, `profile.ps1` lifted from Terax (with our naming).
   - Modify `apps/desktop/src/main/terminal/shell-wrappers.ts` to materialize these scripts under `~/.exegol/shell-integration/` on first run.
   - When spawning a shell pane (not an agent CLI), wrap: `ZDOTDIR=~/.exegol/shell-integration zsh` or `bash --rcfile ~/.exegol/shell-integration/bashrc.bash -i`.
   - Add `apps/desktop/src/renderer/components/terminal/osc-handlers.ts` registering OSC 7 + OSC 133 handlers on the xterm instance — push parsed cwd into the workspace store (per-pane).
   - **Win**: cwd badge per pane (for the empty/shell pane type — agent panes get cwd from the spawn metadata).
   - **Bonus**: exit code from `OSC 133 D` lets the Smart Git Button trigger a refresh after a successful `git commit` without polling.

2. **The 4ms-coalesce + `ESC c` discard pattern** (S). Our sidecar already buffers, but check `apps/desktop/src/main/terminal/pty-sidecar-entry.ts` — if we currently slice on overflow, switch to "drop entire pending + emit `\x1bc[notice]`".

3. **`shell_run_command` one-shot pattern** (M). When we want to add Exegol-native AI tools (e.g. a "summarize this file" action that calls `cat` + LLM), having a separate one-shot shell exec API in main is cleaner than spawning a PTY for it. We'd put this in `apps/desktop/src/main/terminal/shell-exec.ts`.

4. **`shell_session_*` randomized sentinel pattern** (`shell/session.rs:35-58`) for any future "persistent agent shell" feature — if/when we ship a non-CLI agent that wants to maintain `cd` state across tool calls, the sentinel approach is necessary to avoid prompt-injection from stdout. **Not urgent**.

5. **Renderer slot pool** (L). This is a real architectural change. Steps:
   - Lift `rendererPool.ts` + `dormantRing.ts` into `apps/desktop/src/renderer/lib/terminal-pool.ts`.
   - Replace `TerminalInstance` with a `usePooledTerminal(paneId, container)` hook that acquires + releases.
   - Wire `WorkspacePane` so hidden panes release the slot instead of unmounting.
   - Floating PiP: ensure the snapshot/replay flow works when a pane detaches.
   - **Benefit**: many tabs no longer mean many WebGL contexts. Memory drops linearly.
   - **Risk**: our sidecar ring buffer already provides "instant reconnect"; adding a second renderer-side ring (dormantRing) is mostly redundant unless we cap WebGL count.

6. **Windows ConPTY patterns** (placeholder; effort N/A until we add Windows): SPAWN_LOCK, PtyJob + KILL_ON_JOB_CLOSE, explicit drop-order documentation. Files to copy from: `pty/session.rs:29-58`, `pty/job.rs:1-73`.

### What to skip

- **`portable-pty` vs `node-pty`**: switching the PTY library buys nothing on macOS/Linux; both are mature. Only relevant if we wanted to *eliminate* node-pty's prebuild complexity by moving PTY into our Rust napi module. Effort to do that: **L**, payoff: marginal (occasional `electron-rebuild` annoyance).
- **DA filter (`da_filter.rs`)**: Specific to portable-pty behavior on Windows, not relevant for us right now.

## Area 3: Shell host (Tauri vs Electron)

### How Terax does it

- **Tauri 2 plugin architecture** (`src-tauri/src/lib.rs:89-180`):
  - 9 plugins wired: `process`, `updater`, `window-state`, `autostart`, `store`, `os`, `log`, `opener`.
  - Each plugin is `.plugin(plugin_xxx::init())` in `run()` and requires a matching `permissions` entry in `src-tauri/capabilities/default.json:9-28`.
  - **Capability allowlist is webview-side** — the renderer literally cannot invoke `core:window:allow-close` without the capability entry. Even with full XSS, the attack surface is bounded.
- **Tauri config bundling** (`tauri.conf.json:30-69`):
  - `bundle.targets: "all"`, per-platform sections, minisign-signed updater (`createUpdaterArtifacts: true`).
  - Linux: `decorations: false + transparent: true`, deb depends on `libwebkit2gtk-4.1-0` / `libgtk-3-0`, rpm on `webkit2gtk4.1` / `gtk3`, appimage bundles its own media framework.
  - Windows: NSIS `currentUser` (no admin), `webviewInstallMode: downloadBootstrapper` (no offline embed = smaller installer).
  - macOS: `minimumSystemVersion: 13.0`, `titleBarStyle: Overlay + hiddenTitle: true`.
- **Window state restore via `tauri-plugin-window-state`** but explicitly excludes `StateFlags::VISIBLE` (`lib.rs:98-102`) so the frontend can `window.show()` after first paint — avoids transparent-window-shadow flash on Windows/Linux.
- **CSP is restrictive** (`tauri.conf.json:27`): explicit `script-src 'self' 'wasm-unsafe-eval'`, no inline scripts, IPC over `ipc://` schemes. Electron's `nodeIntegration: false + contextIsolation: true` + our preload-only IPC gets us most of the way there, but we don't have a CSP header.
- **Settings as separate webview window** (`lib.rs:32-86`): own window with `always_on_top: true`, `parent: main` (lifecycle tied), reused if already open, focus + emit `terax:settings-tab` event for deep-linking. We have settings as an in-app modal (`SettingsPanel.tsx`).
- **`removeUnusedCommands: true`** (`tauri.conf.json:11`) — Tauri tree-shakes unused IPC commands at build. We don't have an equivalent for tRPC routers (every router is loaded on startup).

### Where Exegol differs

- **We're on Electron**, with all the baggage (Chromium per process, ~150MB+ baseline, no capability allowlist). Our IPC surface is via tRPC over `ipcRenderer.invoke` — every router loaded in-process in main.
- **Bundle config** is `electron-builder.ts` — substantially different shape (DMG / NSIS / AppImage / deb / rpm targets via electron-builder configs).
- **Auto-updater** is `electron-updater` — feature-parity with `tauri-plugin-updater` but uses GitHub Releases + Squirrel (mac) / NSIS (win) / AppImage diff (linux). Different signing mechanism (code-signed vs minisign).
- **`safeStorage` for secrets** lives in Electron — we use it but key-DB-bound, see `keystore.ts:1-40`. Tauri's `keyring` + Linux file fallback is the same idea executed elsewhere.
- **MCP host, sidecar, libsql, 35 migrations, node-pty** all assume Node in main. Porting them to Rust is a multi-month effort.

### What to adopt

1. **Don't migrate to Tauri.** Realistically L+++. Sidecar process + libsql + tRPC + MCP servers + node-pty + 35 SQL migrations all assume Node in main. Replacing libsql with rusqlite is fine, but replacing the MCP host (which speaks stdio JSON-RPC to N child processes) and tRPC over IPC would be a full rewrite of `apps/desktop/src/main/`. Verdict: **Stay on Electron.**

2. **Adopt Tauri's capability-allowlist *pattern* inside Electron** (M). Concrete:
   - Today our preload (`apps/desktop/src/preload/index.ts`) bridges everything via `contextBridge.exposeInMainWorld`. We could add a small declarative allowlist file (e.g. `apps/desktop/src/preload/capabilities.json`) listing which tRPC routers and IPC channels the renderer is allowed to call, gated in main's `registerTrpcIpcHandler`.
   - This makes XSS impact bounded the way Tauri's `default.json` does. Useful when we let webviews load arbitrary URLs in the browser pane.

3. **Add a CSP header** to the renderer HTML (`apps/desktop/src/renderer/index.html`) (S). Mirror Terax's: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; ...`. We need `connect-src 'self' https://api.anthropic.com https://api.openai.com ...` for our direct LLM calls.

4. **Settings-as-separate-window** (M). Right now `SettingsPanel.tsx` is a modal inside the main window — open settings, lose your terminal layout. A separate `BrowserWindow` (like our floating PiP infra already supports) lifecycled to main would mirror Terax's pattern. Not high-impact, but cleaner UX.

5. **`removeUnusedCommands` analog** — at build time, tree-shake unused tRPC procedures. Our 21 routers all register at startup. **Skip** — tRPC's router shape doesn't trivially support this without a custom transformer.

6. **Per-platform window styling** (S). Terax's pattern is `cfg(target_os)` branches in Rust for `decorations: false + transparent: true` on Linux/Windows, native overlay on macOS. We're macOS-only today, but if we add Linux/Windows we should mirror.

### What to skip

- **Tauri plugins themselves** — `tauri-plugin-store`, `tauri-plugin-autostart`, `tauri-plugin-window-state`, `tauri-plugin-log`, `tauri-plugin-opener` — all Tauri-specific. Electron-side equivalents we already have or can add:
  - `store` → SQLite settings table (have)
  - `autostart` → `app.setLoginItemSettings()` (built-in)
  - `window-state` → `electron-window-state` (npm) — **adopt** if we don't already (S)
  - `log` → our `lib/logger.ts` is fine
  - `opener` → `shell.openExternal()` (built-in)

## Area 4: Editor / Diff

### How Terax does it

- **CodeMirror 6 stack** (`src/modules/editor/`):
  - `extensions.ts:1-96` builds shared extensions: `indentUnit("  ")`, `tabSize.of(2)`, `search({ top: true })`, `lintGutter()`, plus a custom `EditorView.theme` that integrates with the app's CSS variables.
  - Compartments (`Compartment` for language, readOnly, wrap, vim) allow runtime reconfiguration without rebuilding state.
  - 8 themes from `@uiw/codemirror-theme-*` (Tokyo Night, Nord, GitHub, Atom One, Aura, Copilot, Gruvbox Dark, Xcode).
  - Vim mode via `@replit/codemirror-vim`.
- **Inline AI ghost autocomplete** (`src/modules/editor/lib/autocomplete/inlineExtension.ts:1-489`):
  - `StateField<Suggestion | null>` holds current ghost; `StateEffect<Suggestion | null>` mutates it.
  - `Decoration.widget` renders the ghost as a `cm-ai-ghost` span (opacity 0.45, italic) at the suggestion anchor.
  - Driver `CompletionDriver` debounces (350ms) cursor + doc changes, gates on `shouldTrigger` (no completion mid-identifier, requires 2+ chars of recent context).
  - **LRU cache** of (prefix_tail || suffix_head || lang) → completion, cap 32.
  - **Trim suggestion** (`trimSuggestion`, lines 360-420) — strips markdown fences, prefix-tail overlap (model echoes what you just typed), suffix overlap, leading indent already typed, then caps to 6 lines.
  - Keymap: Tab accept, Esc dismiss, Mod-ArrowRight accept word, Alt-\ manual trigger. `Prec.highest` so it beats other Tab handlers.
- **Diff cache** (`diffCache.ts:1-104`): LRU 6 entries + in-flight Promise dedup, keyed by `${workspace}|${repo}|${kind}|${mode}|${path}`. Invalidates per-repo on git mutations.
- **AI diff tab** (`AiDiffPane.tsx`, lazy-loaded via `AiDiffStackLazy.tsx`): side-by-side diff via `@codemirror/merge`, hunk-level accept/reject UI handled by `PlanDiffReview.tsx`.
- **Git history viewer** (`src/modules/git-history/GraphRail.tsx:1-60`): SVG-rendered graph rail with `LANE_WIDTH = 14`, max 6 visible lanes, bezier curves for merges. Each row is a `<svg>` with `<line>` (straight) and `<path>` (merge bezier). The `MAX_VISIBLE_LANES` cap keeps the visual width bounded.

### Where Exegol differs

- **Monaco for read-only viewing** (`@monaco-editor/react` in `apps/desktop/package.json:42`). Bundle size of Monaco vs CodeMirror: Monaco is ~5MB minified, CodeMirror ~150KB. We pay ~50× for syntax highlighting.
- **No editing in Monaco** — FileExplorer + Monaco is view-only. We have no inline edit or AI ghost autocomplete.
- **Diff is hand-rolled** (`apps/desktop/src/renderer/components/workspace/diff/`) — not using `@codemirror/merge`.
- **No git history graph**. We have GitPane with Changes / Diff / Oplog tabs but no commit-graph visualization.

### What to adopt

1. **Switch Monaco → CodeMirror 6 for the FileExplorer viewer** (M). Concrete:
   - Add `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/lang-{typescript,python,rust,...}`, `@uiw/react-codemirror`, `@uiw/codemirror-theme-{tokyo-night,github}` (2 themes for dark/light).
   - Create `apps/desktop/src/renderer/components/workspace/CodeMirrorViewer.tsx` mirroring our current Monaco wrapper.
   - **Bundle win**: ~4.5 MB off the lazy `xterm+monaco` chunk (Monaco is ~5MB, CodeMirror+langs ~500KB).
   - **Risk**: Monaco has better TypeScript IntelliSense out of the box. We don't use that today (view-only), so loss is minor.
   - Keep the Monaco fallback gated behind a setting if power users prefer it (probably skip).

2. **Adopt `@codemirror/merge` for diff** (S, after step 1). Replace `apps/desktop/src/renderer/components/workspace/diff/*` with CodeMirror's merge view. We get hunk-level highlighting + accept/reject for free.

3. **Steal `inlineExtension.ts` for an in-editor AI ghost autocomplete** (M, after step 1 + we expose an inference endpoint). Only meaningful if we add file editing — out of scope today.

4. **Build a GraphRail equivalent** for the Oplog tab (M). Our oplog already records branching agent operations; an SVG graph would communicate the parallel-pipeline structure way better than the current list. Use `GraphRail.tsx:1-60` as a starting reference.

5. **Diff cache pattern** (`diffCache.ts:1-104`) — small file, big win for the common "open same file twice" case. Lift the LRU + inflight dedup directly into our Git router. Effort: **S**.

### What to skip

- **Vim mode** unless explicitly requested. `@replit/codemirror-vim` is 200KB. We're not a power-user editor.
- **The 8-theme bundle**. Two themes (dark/light) is enough.

## Library shopping list

| Library | Their use | Our potential use | Bundle/runtime cost | Verdict |
|---|---|---|---|---|
| `streamdown` | Streaming markdown in AI chat | Render agent CLAUDE.md / pipeline output / skills markdown with streaming | ~40KB gzip | **Adopt — S** |
| `tokenlens` | Token counter for chat composer | Per-agent token usage estimate in the Monitor tab | ~30KB | **Adopt — S** |
| `motion` (Framer Motion successor) | UI animations | We already have ad-hoc CSS animations | ~80KB | **Skip** — we'd need an animation strategy reset first |
| `react-resizable-panels` | Workspace layout | We already use it (`apps/desktop/package.json:65`) | already in | Match |
| `@tanstack/react-virtual` | Large list virtualization (agent list / commits) | We already have it (`apps/desktop/package.json:25`) | already in | Match |
| `radix-ui` umbrella | Single-package Radix import | We import per-primitive (lighter trees) | – | **Skip** — per-primitive is cleaner |
| `cmdk` | Command palette | We have our own CommandPalette | ~40KB | **Skip** — would be a refactor with no functional gain |
| `use-stick-to-bottom` | Auto-stick-to-bottom chat scroll | Terminal scrollback + Oplog stream + scoring activity | ~5KB | **Adopt — S** (use in TerminalPanel + future activity feed) |
| `@replit/codemirror-vim` | Vim mode | Power-user request only | ~200KB | **Skip unless requested** |
| `hugeicons` | Icons (~free pack) | Alt to lucide-react | comparable | **Skip** — lucide is fine, just borrow specific icons |
| `@iconify-json/catppuccin` | File-type icons | FileExplorer file type icons | data only | **Adopt — S** if we want better file icons; otherwise skip |
| `@uiw/react-codemirror` | CodeMirror React wrapper | Drop-in if we move off Monaco | ~150KB | **Adopt with editor swap** |
| `@codemirror/merge` | Diff view | Replace our hand-rolled diff | ~80KB | **Adopt with editor swap** |
| `@fontsource-variable/inter` + `@fontsource/jetbrains-mono` | Fonts via fontsource | We bundle Nerd Fonts directly (`assets/fonts/`) | their is smaller; ours has more glyphs | **Keep ours** — we need NF glyphs for status icons in terminals |
| Vercel `ai` + `@ai-sdk/anthropic` | LLM client | Replace our raw fetch in `diff.ts` + `scoring.ts` | ~120KB (anthropic only) | **Adopt — S** |
| Rust `ignore` + `grep-regex` + `grep-searcher` + `grep-matcher` + `globset` | Fuzzy file search + grep tools | Add fast filesystem search to our Rust core for agent tools | adds ~1MB to .node | **Adopt — M, very high ROI** |
| Rust `keyring` | OS keychain | We use `safeStorage`; keep | – | **Skip** — Electron path is fine |
| Rust `portable-pty` | PTY | We use node-pty | – | **Skip** unless we move PTY into Rust |
| Rust `shared_child` | Concurrent-safe `Child` waits | n/a (we use Node) | – | **Skip** |
| Tauri plugins (`tauri-plugin-window-state` etc.) | OS integrations | Most have Electron analogs | – | **Adopt `electron-window-state` npm package — S** if we don't have it |

## Configuration & build tuning

**Vite manual chunks** (Terax `vite.config.ts:32-67`): Each `@ai-sdk/*` provider gets its own chunk, xterm + addons their own, codemirror + uiw themes + replit-vim into one, streamdown / motion / react / radix each isolated. This means the initial bundle is mostly app code; provider chunks only download when configured.

Our `electron.vite.config.ts:1-55` only configures main inputs (sidecar entries) — no `manualChunks` on the renderer side. We lean on lazy `import()` boundaries for code splitting. **Action: add `manualChunks` to the renderer rollupOptions** for xterm, monaco (or future codemirror), and any AI SDK we adopt. Effort: **S**.

**Vite esbuild config** (`vite.config.ts:16-22`): production build drops `debugger` statements and treats `console.debug/info/trace` as pure (eliminated). We don't do this — `console.debug` calls ship to users. Action: copy the `esbuild: { drop, pure }` block. Effort: **S**.

**Vite build target** (`vite.config.ts:24-25`): `chrome120` on Windows (WebView2), `es2022` elsewhere. We're locked to Electron's Chromium version so we can target much higher (`chrome134` for Electron 41). Action: bump our build target to `chrome134` to get smaller output (no polyfills for class fields, top-level await, etc.). Effort: **S**.

**Tailwind v4 config-in-CSS** (`@theme` directive inside `App.css`): no `tailwind.config.ts` at all. Our codebase still uses the v3 config pattern. Action: migrate Tailwind config into `apps/desktop/src/renderer/styles/globals.css` `@theme` block. Effort: **S-M** (one-time refactor; mostly mechanical).

**Vitest** (`package.json:11`): they run `vitest run` plain. We run via `vitest run` too. No tuning gap.

**TypeScript / Biome / pnpm**: Terax uses pnpm + npm workspace; we use Bun + Turborepo. Both fine. **Biome version**: we're on 2.4.7 (per CLAUDE.md); Terax doesn't use Biome (uses ESLint/Prettier implicit). Keep ours.

## Anti-patterns / things to NOT copy

1. **Settings webview with `always_on_top: true`** (`lib.rs:50-59`). On macOS this fights Mission Control + Stage Manager. Their `parent: main` lifecycle is good, but always-on-top is too aggressive for a settings window. Keep it normal.

2. **Reading `TERAX.md` on every send with a 30s cache** (`transport.ts:8-33`). 30s cache is too short — for a doc that's static during a session, mtime-based with no TTL is sufficient. Don't copy the 30s window; copy the *pattern*.

3. **Bundling 8 CodeMirror themes** (~600KB). Two is enough for our use.

4. **Their direct LM Studio / MLX / Ollama provider plumbing** has 4 separate code branches in `agent.ts:174-211` that are all `createOpenAICompatible` with different defaults. If we add local model support, write *one* abstraction with a base-URL + name + key + headers config, not 4 cases.

5. **OSC 7 emitted from interactive command's stdout**: their handler correctly *rejects* OSC 7 during `inCommand` (`osc-handlers.ts:27-32`). If we adopt OSC 133 + 7, make sure to mirror this guard — otherwise a remote SSH session can spoof our cwd badge.

6. **WebGL context-loss "recovery" by re-attaching after 250ms**: clever, but if the GPU is actually gone, this will infinitely retry. Their code stops because `attachWebgl` no-ops if already attached, but if we copy this, add a max-retry counter.

7. **Single-package frontend (no monorepo)**: they only have one front-end + one back-end, so a single `package.json` works. Don't backport — our monorepo with `@exegol/shared` + `@exegol/ui` + `@exegol/core-rust` is genuinely better for our scope.

## Bonus findings (not in the original 4 areas)

### Voice input pipeline (Terax `src/modules/ai/lib/composer.tsx:36`, `useWhisperRecording`)
Streamed transcription, toggled from the composer. We have nothing like this. **Adopt only if we add an in-app composer for non-CLI agents.** Skip for now.

### Sub-window for settings deep-linking (`open_settings_window` in `lib.rs:32-86`)
`open_settings_window(tab: Some("models"))` emits `terax:settings-tab` which the settings window picks up via Tauri event API. We have settings as a modal in main, with our own tab state. Deep-linking from elsewhere in the app (e.g. "No API key — open Settings → API Keys") is a useful pattern; we can do this without a separate window via Zustand action. Effort: **S**.

### Slash commands + snippets (`src/modules/ai/lib/{slashCommands,snippets}.ts`)
Reusable prompt fragments and tool-bundles surfaced in the composer. **Borrow conceptually for our Prompts & Skills tab** if/when we add a unified compose surface. Effort: **M**.

### Status bar `CwdBreadcrumb` (`src/modules/statusbar/`)
Handles Unix paths, Windows drive letters, and home `~` segments via `pathUtils.segmentsFromCwd`. We render cwd as a plain string. Effort: **S** for a nicer breadcrumb component.

### Tabs are hidden, not unmounted (`TERAX.md:47`)
> Tabs are tagged-union (`{ kind: "terminal" | "editor" | "preview" | "ai-diff", … }`) and **not** unmounted on switch — they're hidden via `invisible pointer-events-none` so PTYs and dev servers keep streaming in the background.

We already do something similar with our pane system but verify floating PiP doesn't trigger unmounts. Worth a code-review pass.

### `removeUnusedCommands: true` in Tauri config
Tree-shakes IPC commands at build. Our tRPC has no equivalent. Could be a future TODO for bundle size but **not actionable today**.

### `globset` + `ignore` crates for fast respect-gitignore file walking
If we add an Exegol-side fuzzy file search or grep tool for AI agents, the `ignore` crate (which powers ripgrep) + `globset` is the right tech. Better than spawning `rg` because we get structured results without parsing. Effort: **M** to add to our `packages/core-rust`.

### Lazy AI provider import via `await import()`
`agent.ts:93-208` switch-case lazily imports each `@ai-sdk/*` package inside the case. This is what makes the `manualChunks` config actually pay off — the chunk only loads when the user picks the provider. **When we adopt the SDK, mirror this pattern**.

## Open questions for the Exegol team

1. **Do we ever plan to ship an in-process AI flow** (Exegol-owned agent, not spawned CLI)? If yes, Vercel AI SDK + the tools/approval/plan-mode patterns are very valuable. If no, we'd only adopt the SDK for our two utility calls (commit message + Tier-3 scoring) — much smaller ROI but still positive.

2. **What's our Windows roadmap?** If it's "next quarter", we should pre-port the SPAWN_LOCK + Job Object + drop-order patterns into our sidecar now (cheap to do alongside macOS work). If "someday", just file an issue.

3. **Are we willing to take a ~5 MB bundle hit on Monaco** vs ~500 KB on CodeMirror? Switching is M effort, but only worth it if we eventually want inline edit / AI ghost. If FileExplorer stays view-only forever, Monaco's TypeScript IntelliSense is a free win we'd lose.

4. **OSC 133 vs our `status_parser.rs` — full replacement or coexistence?** OSC 133 only works for *shell* panes (we control the init script). It does NOT help for agent CLI panes (we don't control Claude Code's prompt). So our Rust parser stays for agents; OSC 133 is purely additive for shells. Confirm we're OK maintaining both.

5. **`safeStorage` vs `keyring`-Rust for secrets:** today our keys live as `encrypted:<base64>` in the SQLite `settings` table (`keystore.ts:8-23`). If a user resets the DB, keys are lost. Terax's per-account keychain entry survives DB resets. Do we want this guarantee? If yes, swap to `keytar` (npm) or implement a small Rust napi helper using the `keyring` crate.
