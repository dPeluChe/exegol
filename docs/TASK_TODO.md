# Exegol — Task Board V3 (Terminal & Performance)

> Tasks focused on terminal scalability, native performance, and production hardening.
> Inspired by **Superset** (subprocess isolation, binary IPC, backpressure) and **T3 Code** (dual PTY adapter, debounced persistence).
>
> **GHQ root**: `/Users/peluche/dPeluCheData/PROJECTS/dPeluChe/_code_/_repos_2_learn`
>
> **Quality gate before PR**:
> - `npx @biomejs/biome check --fix apps/ packages/shared/src/ packages/ui/src/`
> - `npx tsc --noEmit -p apps/desktop/tsconfig.node.json && npx tsc --noEmit -p apps/desktop/tsconfig.web.json`
> - Max 400-500 LOC per file
> - Log work in `docs/tasks_completed/2026_03.md`

---

## Inspiration Registry

| Repo | ghq path | Key Patterns |
|------|----------|-------------|
| **Superset** | `github.com/superset-sh/superset` | PTY subprocess isolation, binary framing IPC (5-byte header), backpressure (8MB high/4MB low watermark), shell readiness marker (OSC-777), headless emulator (@xterm/headless), mode tracking (DECSET/DECRST), session snapshots, concurrent spawn semaphore, process tree-kill escalation |
| **T3 Code** | `github.com/pingdotgg/t3code` | Dual PTY adapter (Bun + node-pty), debounced persistence (40ms), matched scrollback limits (5K front = 5K back), thread-scoped sessions, Effect-TS contracts, shell candidate fallback chain, subprocess activity polling |

---

## Cluster F — Terminal Scalability & Native Performance

> Touches: `main/terminal/` (new), `main/agents/manager.ts`, `renderer/components/terminal/`, `packages/core-rust/`

### T35 — PTY Subprocess Isolation + Backpressure
**Complexity**: High
**Priority**: CRITICAL — blocks all other terminal scaling work
**Study before implementing**:
- Superset: `apps/desktop/src/main/terminal-host/pty-subprocess.ts` — separate Node.js process owns PTY, binary IPC
- Superset: `apps/desktop/src/main/terminal-host/pty-subprocess-ipc.ts` — 5-byte binary framing (1 byte type + 4 bytes u32 LE length)
- Superset: `apps/desktop/src/main/terminal-host/session.ts` — per-session state, multi-client attach/detach, queue management
- Superset: `apps/desktop/src/main/terminal-host/terminal-host.ts` — session manager, concurrent spawn limiter (semaphore max 3)
- T3 Code: `apps/server/src/terminal/Layers/BunPTY.ts` — Bun native PTY with TextDecoder streaming
- T3 Code: `apps/server/src/terminal/Layers/NodePTY.ts` — node-pty wrapper with spawn-helper resolution

**Problem**: PTY currently lives in Electron main process. A blocking write or slow PTY freezes the entire UI (all windows, all IPC, all agents). No backpressure — a verbose agent can cause unbounded memory growth.

**What to implement**: Move node-pty into a dedicated child process per agent. Binary IPC protocol between main and subprocess. Backpressure with pause/resume.

**Files**: New `main/terminal/pty-subprocess.ts`, new `main/terminal/pty-ipc.ts`, new `main/terminal/pty-host.ts`, `main/agents/manager.ts` (refactor spawn to use pty-host)

**Acceptance**:
- [ ] PTY subprocess: spawned via `ELECTRON_RUN_AS_NODE=1`, owns node-pty instance
- [ ] Binary framing protocol: 5-byte header (type u8 + length u32 LE), frame types: Spawn, Write, Resize, Kill, Dispose (main->sub), Ready, Spawned, Data, Exit, Error (sub->main)
- [ ] Max frame size: 64MB safety cap
- [ ] Output batching in subprocess: array-based collection, flush at setImmediate or 128KB threshold
- [ ] Input backpressure: high watermark 8MB, low watermark 4MB, hard limit 64MB per session
- [ ] Write backpressure: async fs.write() on PTY fd, exponential backoff (2-50ms) on EAGAIN
- [ ] Process tree killing: SIGTERM -> wait 2s -> SIGKILL (tree-kill pattern)
- [ ] Concurrent spawn limiter: semaphore max 3 simultaneous PTY spawns
- [ ] AgentManager.spawn() refactored to use pty-host instead of direct node-pty
- [ ] Data flow: subprocess stdout -> binary frame decode -> broadcastToRenderer (existing IPC)
- [ ] Graceful degradation: if subprocess crashes, agent marked as "crashed" with scrollback preserved
- [ ] Document: `docs/applied/T35_pty_subprocess.md`

### T36 — Headless Emulator + State Recovery
**Complexity**: Medium
**Priority**: High — enables proper session recovery and multi-window
**Study before implementing**:
- Superset: `apps/desktop/src/main/terminal-host/headless-emulator.ts` — @xterm/headless for server-side state tracking, mode parsing (DECSET/DECRST), snapshot generation, CWD tracking (OSC-7), shell-ready marker (OSC-777)
- Superset: `apps/desktop/src/main/lib/agent-setup/shell-wrappers.ts` — marker injection into shell profile
- Superset: `apps/desktop/src/main/terminal-host/session.ts` — snapshot on attach, pre-ready stdin queue

**Problem**: If renderer crashes or user switches tabs, terminal visual state is lost. Current SerializeAddon only runs in renderer (client-side). No shell readiness gating — terminal shows escape sequence noise during shell init.

**What to implement**: Server-side headless terminal emulator in main process. Tracks terminal state independently of renderer. Enables snapshot/restore on re-attach.

**Files**: New `main/terminal/headless-emulator.ts`, `main/terminal/pty-host.ts` (integrate), `main/agents/manager.ts`

**Acceptance**:
- [ ] @xterm/headless instance per session in main process, receives same data stream as renderer
- [ ] Mode tracking: mouse tracking, bracketed paste, cursor visibility, alternate screen (DECSET/DECRST)
- [ ] Snapshot generation via SerializeAddon server-side (not just renderer)
- [ ] CWD tracking via OSC-7 escape sequence parsing
- [ ] Shell readiness gating: inject OSC-777 marker in shell profile, buffer output pre-ready
- [ ] Ready timeout: 15s (degrade gracefully if marker not detected)
- [ ] Multi-window support: same session attachable from 2+ renderer windows without corruption
- [ ] On renderer re-attach: send snapshot + rehydrate sequences + current mode state
- [ ] Replace current raw scrollback persistence with headless emulator snapshots
- [ ] Document: `docs/applied/T36_headless_emulator.md`

### T37 — Scrollback & Persistence Optimization
**Complexity**: Low
**Priority**: Medium — quick win
**Study before implementing**:
- T3 Code: `apps/server/src/terminal/Layers/Manager.ts` — debounced persistence (40ms batching), 5K line history limit, safe file naming
- Current: `main/agents/manager.ts` — writeFileSync every 30s (blocks main), 1MB cap, 10K line xterm scrollback

**Problem**: Scrollback flush uses synchronous writeFileSync every 30s, blocking main process. Frontend scrollback (10K lines) doesn't match backend buffer (1MB bytes). 30s flush interval means up to 30s data loss on crash.

**What to implement**: Async persistence with debounced writes. Matched scrollback limits. Move accumulation to subprocess.

**Files**: `main/terminal/pty-host.ts` (or subprocess), `renderer/components/terminal/TerminalInstance.tsx`

**Acceptance**:
- [ ] Replace writeFileSync with worker_threads or fs.promises.writeFile
- [ ] Debounced writes: 100ms batching (not 30s intervals)
- [ ] Matched scrollback: 5K lines in xterm = 5K lines in headless emulator
- [ ] Scrollback accumulation moved to pty-subprocess (not main process)
- [ ] Persistence on agent exit: final flush from headless emulator snapshot
- [ ] Crash safety: max 100ms data loss (vs current 30s)
- [ ] Document: `docs/applied/T37_scrollback_optimization.md`

### T38 — WebGL Context Pooling
**Complexity**: Medium
**Priority**: Low — only needed at 20+ visible terminals
**Study before implementing**:
- Current: `renderer/components/terminal/TerminalInstance.tsx` — 1 WebGL context per terminal, onContextLoss disposes addon, no re-init
- xterm.js docs: WebGL addon lifecycle, context limits

**Problem**: Each terminal creates a new WebGL context. GPU memory exhausted after ~50-100 terminals. Browsers limit active WebGL contexts (typically 8-16 active). No context reuse or virtualization.

**What to implement**: Pool active WebGL contexts. Only terminals in viewport get WebGL; offscreen terminals use canvas or headless.

**Files**: `renderer/components/terminal/TerminalInstance.tsx`, new `renderer/lib/webgl-pool.ts`

**Acceptance**:
- [ ] IntersectionObserver detects terminal viewport visibility
- [ ] Terminals in viewport: WebGL renderer active
- [ ] Terminals outside viewport: WebGL disposed, buffer retained in memory
- [ ] Re-entering viewport: WebGL re-created from buffer (no flicker)
- [ ] Max active WebGL contexts: 6-8 (configurable)
- [ ] Fallback: canvas renderer when pool exhausted (no crash)
- [ ] Performance: smooth tab switching with no visible re-render delay (<100ms)
- [ ] Document: `docs/applied/T38_webgl_pooling.md`

---

## Remaining Minor Items (deferred from V1/V2)

| Source | Item | Status |
|--------|------|--------|
| T03 | Parse Codex or Aider JSONL logs (not just Claude Code) | Deferred |
| T03 | Token cost in sidebar AgentMiniCard | Deferred |
| T04 | Filter tasks: all / pending / completed | Deferred |
| T07 | Conflict warning for duplicate ports | Deferred |
| T19 | Dynamic model catalog (DB-backed, not hardcoded) | Partial |
| T33 | Tier 3 LLM-as-judge quality eval | Future |

---

## Execution Order

```
Phase 1: T35 (PTY Subprocess Isolation)     <- CRITICAL, unblocks T36+T37
Phase 2: T36 (Headless Emulator)            <- after T35 (uses pty-host)
          T37 (Scrollback Optimization)      <- can parallel with T36
Phase 3: T38 (WebGL Pooling)                <- independent, only if scaling demands
```

---

## Cluster G — UI Polish & Workspace Improvements

> Touches: `renderer/components/workspace/sections/DiffSection.tsx`, `renderer/components/workspace/`

### T39 — Diff Viewer UX Improvements
**Complexity**: Low
**Priority**: Medium

**Problem**: File list in diff viewer jumps directly to expanded content. No overview of changed files. Default view is not optimal for quick review.

**Files**: `renderer/components/workspace/sections/DiffSection.tsx`, `renderer/components/workspace/diff/DiffFileView.tsx`

**Acceptance**:
- [ ] File list shows all changed files collapsed by default (filename + stats only)
- [ ] Click file to expand/collapse its diff
- [ ] Default view: side-by-side (split) comparison
- [ ] "Expand All" / "Collapse All" toggle button
- [ ] File status icons visible in collapsed state (added/modified/deleted)

### T40 — Tab Auto-Naming & Icons by Pane Type
**Complexity**: Low
**Priority**: Medium

**Problem**: New tabs all show a generic name. When a pane is browser or git, the tab doesn't reflect the content type. Hard to identify tabs at a glance.

**Files**: `renderer/components/workspace/WorkspaceTabBar.tsx`, `renderer/components/workspace/WorkspacePane.tsx`, `renderer/stores/workspace.ts`

**Acceptance**:
- [ ] Tab name auto-updates based on primary pane type: "Browser" (globe icon), "Git" (git-branch icon), "Files" (folder icon), "Terminal" (terminal icon), agent name for agent terminals
- [ ] Icons rendered next to tab name in WorkspaceTabBar
- [ ] Renaming via double-click still overrides auto-name
- [ ] Tab name updates when pane type changes (e.g., empty → browser)

### T39b — Terminal Loading State
**Complexity**: Low
**Priority**: Medium

**Problem**: When launching an agent, the terminal pane is black for several seconds while the shell initializes. No visual feedback that something is happening.

**Files**: `renderer/components/terminal/TerminalPanel.tsx`, `renderer/components/terminal/TerminalInstance.tsx`

**Acceptance**:
- [ ] Show loading indicator (spinner or skeleton pulse) while terminal is initializing
- [ ] Display agent name + CLI type during loading (e.g., "Starting Claude Code...")
- [ ] Transition smoothly to live terminal once first output arrives
- [ ] Loading state visible for both agent CLIs and plain shells

### T40 — Tab Drag-and-Drop Reorder + Merge to Panes
**Complexity**: High
**Priority**: Medium

**Problem**: Tabs cannot be reordered. Cannot merge tabs into split panes within another tab via drag-and-drop.

**Files**: `renderer/components/workspace/WorkspaceTabBar.tsx`, `renderer/stores/workspace.ts`, `renderer/components/workspace/WorkspaceLayout.tsx`

**Acceptance**:
- [ ] Tabs can be reordered via drag-and-drop in the tab bar
- [ ] Dragging a tab onto another tab's content area merges it as a split pane
- [ ] Drop zones: left/right/top/bottom edges for split direction, center for tab merge
- [ ] Visual drop indicator shows where the pane will land
- [ ] Panes within a tab can be dragged out to create a new tab
- [ ] Works with all pane types (terminal, browser, files, git)

### T41 — Agent Launcher Pane Behavior Fix
**Complexity**: Low
**Priority**: High — current behavior destroys active sessions

**Problem**: Clicking an agent icon in the launcher replaces the current pane even if it has a running agent. This kills the active session without warning.

**Files**: `renderer/components/agents/AgentLauncher.tsx`, `renderer/stores/workspace.ts`

**Acceptance**:
- [ ] If current pane is empty or default → launch agent in current pane
- [ ] If current pane has a running agent → open new tab with the new agent
- [ ] If current pane has a stopped agent → replace it (session is over)
- [ ] Never silently destroy a running session

### T42 — Workspace Tab Keyboard Navigation
**Complexity**: Low
**Priority**: Medium

**Problem**: No keyboard shortcuts to switch between workspace tabs. Mouse-only navigation slows down power users.

**Files**: `renderer/hooks/use-hotkeys.ts`, `renderer/stores/workspace.ts`, `renderer/components/workspace/WorkspaceTabBar.tsx`

**Acceptance**:
- [ ] Cmd+1-9 switches to workspace tab by position (1-based)
- [ ] Cmd+Shift+] / Cmd+Shift+[ cycles next/previous tab
- [ ] Cmd+W closes current tab (with confirmation if agent is running)
- [ ] Cmd+T creates new tab (already exists — verify it works)
- [ ] Shortcuts visible in keyboard shortcuts settings panel

---

## Completed

V1 (T01-T16) and V2 (T17-T34): 34/34 tasks complete.
See `docs/tasks_completed/2026_03.md` for full log.
V2 board archived at `docs/archived/TASK_TODO_V2.md`.
