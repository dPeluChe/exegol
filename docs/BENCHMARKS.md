# Exegol Benchmarks

Performance baselines and improvements tracked over time.

## How to measure

- **Bundle size**: `ANALYZE=1 bun run --cwd apps/desktop build` produces
  `apps/desktop/dist/bundle-stats.html` (rollup-plugin-visualizer treemap).
- **Startup time**: check main process logs after launching dev or packaged
  build — `[Startup] dbInit: Xms`, `[Startup] criticalPath: Xms`,
  `[Startup] windowCreated: Xms`, `[Startup] firstPaint: Xms`. All values
  are measured from `app.whenReady()`.

## Renderer bundle

| Chunk               | Baseline | Pass 1 (T86/T87) | v0.3.0 final | Δ total |
| ------------------- | --------:| ----------------:| ------------:| :-----: |
| `index.js`          | 1,987 KB |         986 KB   |    1,026 KB  | **−48%** |
| `TerminalInstance`* |    (in)  |         595 KB   |      595 KB  |  lazy   |
| `settings` (Zod)    |    (in)  |         113 KB   |      113 KB  |  lazy   |
| `PipelineSection`*  |    (in)  |          43 KB   |       43 KB  |  lazy   |
| `TasksSection`*     |    (in)  |          47 KB   |       47 KB  |  lazy   |
| `PromptsSkills`*    |    (in)  |          53 KB   |       53 KB  |  lazy   |
| `SettingsPanel`*    |    (in)  |          51 KB   |       51 KB  |  lazy   |
| `Resources/Tokens`* |    (in)  |          31 KB   |       31 KB  |  lazy   |
| `CodeViewer` (Mon.) | 7,617 KB |       7,617 KB   |    7,617 KB  |  lazy   |
| **Fonts (bundled)** |       —  |              —   |    6,800 KB  |  +new   |

> v0.3.0 grew `index.js` by +40 KB vs pass 1 because of the FamilyBadge
> / FontGroup / FontCard additions and the new recovery logging surface.
> The Nerd Fonts themselves (6.8 MB) are loaded via `@font-face` lazy —
> only the active font is actually fetched from disk at runtime.

`*` denotes chunks that are not loaded on first paint. They are fetched
on demand when the user opens that section, terminal, modal, or editor.

### Remaining weight in `index.js` (~986 KB)

Top modules still in the initial chunk:

1. `react-dom` — 134 KB (unavoidable)
2. `react-resizable-panels` — 82 KB (needed for workspace layout)
3. `tailwind-merge` — 72 KB (used by `cn()`, correctness-critical)
4. Radix primitives (scroll-area, popper, floating-ui, dismissable-layer) — ~100 KB
5. TanStack Query runtime — ~45 KB
6. Default workspace pane code (GitPane, FileExplorer, DiffSection) — ~60 KB
7. `lucide-react` icons — 32 KB across 71 modules (already tree-shaken)
8. Zustand store, app shell, sidebar, status bar — ~100 KB

Further reductions would require replacing `tailwind-merge` with a
lighter alternative or extracting GitPane/FileExplorer into lazy chunks,
both of which carry UX/correctness risk and are not pursued in the
pre-launch polish wave.

## Main process startup

Measured on dev mode (M1 Pro). Log lines appear in the main process
console and `~/.exegol/logs/exegol.log`.

```
[Startup] dbInit: Xms           # initializeDatabase() + migrations
[Startup] criticalPath: Xms     # DB + registry + tRPC + IPC + paths
[Startup] windowCreated: Xms    # BrowserWindow constructed + loadFile
[Startup] firstPaint: Xms       # window ready-to-show fired
```

The startup flow is:

1. App ready → initialize DB + migrations (`dbInit`)
2. Load provider registry + register tRPC/IPC handlers (`criticalPath`)
3. Create window + load renderer URL (`windowCreated`)
4. Renderer paints, ready-to-show fires (`firstPaint`)

Everything else (skills, wrappers, stale cleanup, metrics collector,
scheduler, queue, pipeline executor recovery, sidecar connection, agent
reattach) runs in background IIFEs after the window is visible.

### Measured on M1 Pro, dev mode, 2026-04-10 (post T86/T87)

```
[Startup] dbInit:        9ms
[Startup] criticalPath:  12ms
[Startup] windowCreated: 100ms
[Startup] firstPaint:    391ms
```

Breakdown:
- `dbInit` → `criticalPath`: **3 ms** (provider registry + IPC handler
  registration + path resolution; trivial)
- `criticalPath` → `windowCreated`: **88 ms** (`new BrowserWindow` +
  `loadURL(dev-server)`; Electron-intrinsic)
- `windowCreated` → `firstPaint`: **291 ms** (renderer JS download from
  vite, dependency reoptimization, React hydration, first paint)

The 291 ms renderer phase is where T86/T87 bundle splits pay off.
Packaged builds skip the vite dev server round trip entirely and should
land in the 150-250 ms range — to be measured after next packaged build.

## Baseline targets

- `index.js` initial chunk: **< 1.1 MB** ✅ (1,026 KB)
- First paint (M1, dev mode): **< 500 ms** ✅ (277-391 ms)
- First paint (packaged): **< 250 ms** (pending measurement on v0.3.0 DMG)
- PTY ring buffer total memory (T143): **< 256MB** globally, LRU-evicted to
  disk beyond that for sessions idle 2+ minutes ✅ (enforced in
  `pty-sidecar-eviction.ts`, surfaced in Monitor → Resources)

## Terminal count re-measurement (T143, xterm renderer pool re-scope)

T114 (xterm renderer pool) was deferred pending a measurement pass after
T143's disposal audit and ring buffer hardening. **This pass could not be
run interactively** — the implementing agent operated in a headless
environment with no way to launch the packaged Electron app, open N
terminal tabs, and read GPU/Activity Monitor counters. Recording that
limitation explicitly rather than fabricating numbers.

What the audit *did* establish by reading the code (see T143 PR):

- **Disposal is already correct.** `TerminalInstance.tsx`'s unmount effect
  disposes the WebGL addon before `terminal.dispose()`, which in turn
  disposes `FitAddon`/`WebLinksAddon`/`SerializeAddon` via xterm's internal
  addon manager. No dangling `ResizeObserver`/`IntersectionObserver`/window
  listeners were found. One real leak was fixed as part of this pass:
  `useTerminalStore` (`stores/terminals.ts`) never removed entries on pane
  close — now wired into `workspace.ts`'s `removePane`.
- **WebGL contexts are already gated by visibility** (T38): a hidden pane's
  WebGL context is disposed and only a headless emulator + ring buffer keep
  its state, so the "1 WebGL context per pane" risk T114 was scoped against
  is already bounded to *visible* panes, not total open panes.
- **PTY memory is now bounded independent of the renderer**: the sidecar's
  ring buffers (8MB default / 1MB for plain shells) are capped globally at
  256MB with LRU-to-disk eviction for idle sessions (see T143 PR), so a
  demo with many idle agents no longer scales renderer-adjacent memory
  linearly either.

**Recommendation**: keep T114 deferred. The GPU-context risk it targets
(many *simultaneously visible* xterm/WebGL instances, e.g. a 3x3+ grid
layout) is real but narrower than "N open tabs" — most panes in a tab are
hidden and already shed their WebGL context. Re-measure with a real build
once a grid layout with 6+ concurrently visible terminal panes is a
common usage pattern; until then the disposal fixes in this PR are the
higher-value spend.

**Follow-up needed**: someone with a display should open the packaged app,
create a 3x3 grid layout with 9 live shells, and check Activity Monitor
(macOS) / `chrome://gpu`-equivalent for actual GPU memory before deciding
whether T114 is worth building.

## Recovery telemetry (v0.3.0)

The startup flow now emits structured logs for agent recovery. A
clean startup with no stale agents:

```
[Startup] dbInit: 2ms
[Startup] criticalPath: 4ms
[Startup] windowCreated: 83ms
[PtyHost] Connected to sidecar
[Startup] Sidecar connected — 0 total, 0 alive, 0 dead
[Startup] Crash sweep: marked 0 agent(s) as crashed (0 alive)
[Startup] DB agent counts post-recovery:
[Startup] firstPaint: 277ms
```

A startup that recovers from a dead sidecar session:

```
[Startup] DB agent counts pre-recovery: running=1
[Startup] Sidecar connected — 1 total, 0 alive, 1 dead
[Recovery] Crash sweep: 1 stale agent(s), 0 in skip set
[Recovery] Mark crashed: <id> (crush, status=running, pid=<pid>)
[Startup] Crash sweep: marked 1 agent(s) as crashed (0 alive)
[Startup] DB agent counts post-recovery: crashed=1
```

These logs are intentionally verbose — they can be toned down to
debug-only once we've accumulated confidence in recovery stability.
