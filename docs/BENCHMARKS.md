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

| Chunk               | 2026-04-10 baseline | After T86/T87 pass 1 | Δ     |
| ------------------- | ------------------: | -------------------: | :---: |
| `index.js`          |           1,987 KB  |              986 KB  | −50%  |
| `TerminalInstance`* |                (in) |              595 KB  | lazy  |
| `settings` (Zod)    |                (in) |              113 KB  | lazy  |
| `PipelineSection`*  |                (in) |               43 KB  | lazy  |
| `TasksSection`*     |                (in) |               47 KB  | lazy  |
| `PromptsSkills`*    |                (in) |               53 KB  | lazy  |
| `SettingsPanel`*    |                (in) |               51 KB  | lazy  |
| `Resources/Tokens`* |                (in) |               31 KB  | lazy  |
| `CodeViewer` (Mon.) |           7,617 KB  |            7,617 KB  | lazy  |

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

## Baseline targets

- `index.js` initial chunk: **< 1 MB** ✅ (986 KB)
- First paint (M1, dev mode): **< 1.5s** (not yet measured post-changes)
- First paint (packaged): **< 1s** (not yet measured)
