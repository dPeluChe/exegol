# Performance audit, October 2026

Five read-only passes over `main` at 0.5.27 + #443 (2026-10-22): renders, bundle, requests and
caching, database, assets and packaging. Nothing here is implemented yet; each finding has an id
so the board can pick which ones become tasks. Paths are relative to `apps/desktop/src/` unless
they say otherwise. Effort: S (hours), M (a day or two), L (more).

## Decision table

Ranked by gain for effort. "Pick" is for the review of this PR.

| Id | What | Gain | Effort | Pick |
|---|---|---|---|---|
| R1 | App-level hooks re-render the whole tree on every agent push | Several full-tree renders per second with ~40 agents | S | |
| R2 | `syncFromDb` replaces every agent object even when nothing changed | Every per-agent selector and memo breaks every 30/60 s | S | |
| R3 | `ProjectContext` value changes on any agent change | Whole workspace subtree re-renders | S | |
| Q1 | Agent status written to the DB on every parser step | Fewer writes per output chunk, WAL bigger than the DB today | S | |
| Q2 | `SELECT a.*` reads `final_output` (up to 16 KB) on every agent read | Lighter rows on 44 `getAgent` call sites and every list | S | |
| N1 | `ps -A` every 3 s for shell promotion, plus a second `ps` every 10 s for metrics | ~38 full process-table reads a minute, on the main thread, even minimized | S/M | |
| N2 | Git pane polls `diff.status` and `diff.gitState` separately, 15 s, in hidden tabs too | ~20 git spawns a minute per Git pane | S/M | |
| P1 | Renderer-only deps (mermaid via streamdown, tokenlens...) copied into `app.asar` | ~110-125 MB unpacked, ~40 MB of the 176 MB DMG | S | |
| P2 | 1,004 sourcemaps from `node_modules` shipped | 66 MB unpacked (overlaps P1) | S | |
| P3 | 55 Electron locales shipped | ~45 MB unpacked, ~15 MB DMG | S | |
| B1 | Monaco imported whole: every language worker emitted | 13-16 MB on disk, MBs of parse when Files opens | M | |
| B2 | Markdown preview (streamdown) loaded with every code view | 866 KB per code view | S | |
| B3 | Eager panes and dialogs in the startup chunk (Browser, Git, Files, dialogs, dictation overlay) | ~300 KB off `index.js` (1.29 MB today, 812 KB on 2026-09-29) | S each | |
| F1 | Terminal fonts as TTF | 7.2 to 3.05 MB, faster parse of the active one | S | |

Everything else is in the sections below. One regression was found and fixed during the audit:
#444 briefly put the 616 KB xterm chunk in the startup modulepreload (counters read from
`terminal-webgl.ts`); they moved to `webgl-counts.ts`.

## 1. Unnecessary renders

Baseline: almost no `memo` boundaries (`ProjectCard`, `FileWindowBody`, `HistoryRow` only), so a
render high in the tree walks every mounted pane of the 3 kept projects. Selectors are mostly fine
(`selectPanes`/`selectTabs` return stored references, `updateAgent` skips no-op updates); the cost
is where `s.agents` is subscribed. Reasoned from code, no profiler trace.

| Id | Where | Why it re-renders | Fix | Effort |
|---|---|---|---|---|
| R1 | `hooks/use-cli-updates.ts:115` (`useCliRestarts` in `App.tsx:77`), `use-fleet-sync.ts:16` (`App.tsx:79`) | App reads the whole agents map and `dataUpdatedAt` | Move App-level hooks into an `<AppEffects/>` child that returns null, or read with `getState()` inside effects | S |
| R2 | `stores/agents.ts:509-565` | `syncFromDb` builds new objects for unchanged agents | Keep `existing` when shallow-equal (`modelRoles` by JSON); return the same state when nothing changed | S |
| R3 | `contexts/ProjectContext.tsx:33,55-68` | `agents` and `runningAgentCount` in the value; 17 of 18 consumers read only the project | Drop them from the context; `ResourcesSection` selects its own | S |
| R4 | `terminal/use-send-to.ts:32-36,61` | Every terminal and browser pane subscribes to all agents while Send to is closed | Select only when the menu is open | S |
| R5 | `WorkspacePane`, `TerminalPanel`, `TerminalInstance`, `WatchCard` | No memo, so R1/R3 multiply | `memo` once props are confirmed stable | M |
| R6 | `sections/WatchingSection.tsx:67-68` | Any push re-renders every card, up to 6 live mirrors; `dragProps(id)` new each render | `useShallow` over the watched agents, memo `WatchCard` | S/M |
| R7 | `sections/AgentDashboard.tsx:131-132` | Regroups and re-renders all cards per push | Memo the card (works once R2 keeps identities) | S |
| R8 | `WorkspaceTabBar.tsx:43-50` | Whole agents and attention maps, new `Set` each render | Per-tab child selecting its own primitives | M |
| R9 | `layout/SidebarViews.tsx:108-160,308-315` | `JSON.stringify(card)` twice per card per push in `sameCardProps` | Compare tab keys and agent ids | M |
| R10 | `CommandPalette.tsx:75`, `StatusBarAgents.tsx:41`, `StatusBarMcp.tsx:11`, `SidebarRail.tsx:17`, `ProjectsSection.tsx:141`, `CliUpdatesNotice.tsx:68`, `BrowserPaneContent.tsx:170` | Global `s.agents` subscribers | Counts or primitives, `useShallow`, early return when closed | S each |

Fine as is: the shared 15 s `useNow` timer (leaves only), `useSidebarCounts` (numbers), the 30 s
queries (structural sharing keeps `data` stable).

## 2. Bundle and lazy loading

Startup JS (built from #444's branch after the counters fix): `index` 1,291 KB, `react-vendor` 228 KB,
`radix` 207 KB, `trpc` 122 KB; CSS 129 KB (17.5 KB gzip). No module duplicated across chunks.
Main is 1.2 MB unminified with deps external; preload 24 KB.

| Id | Saving | Where | Fix | Effort |
|---|---|---|---|---|
| B1 | 3-5 MB of the 8.1 MB Monaco chunk, ~16 MB of workers on disk | `CodeViewer.tsx:4` `import * as monaco from "monaco-editor"`, no `MonacoEnvironment` | `monaco-editor/esm/vs/editor/editor.api` + needed `basic-languages`; drop ts/css/html/json workers for the read-mostly viewer | M |
| B2 | 866 KB per code view | `CodeViewer.tsx:6` imports `Streamdown` statically | Lazy `MarkdownPreview` | S |
| B3a | ~58 KB | `WorkspacePane.tsx:41` `BrowserPane` (address bar, QA record/replay, design capture) | `React.lazy` like `TerminalPanel` | S |
| B3b | ~72 KB | `WorkspacePane.tsx:39-40` `GitPane`, `FileExplorer` + `FilePreview` | `React.lazy` | S |
| B3c | ~66 KB | `App.tsx:9` `DictationOverlay` + `ModelChooser` + `lib/dictation` | Load on the first dictation chord, keep only the listener | M |
| B3d | ~56 KB | `ReleaseNotesDialog` (`App.tsx:11`, `UpdateButton.tsx:11`), `BugReportDialog` (`TitleBar.tsx:7`), Appearance/Layouts dialogs (`ProjectItem.tsx:43-44`), `ParallelSpawnModal` (`WorkspaceView.tsx:6`), `LayoutPresets` | `React.lazy` on open | S |
| B3e | ~45 KB | `AgentIcon.tsx:7` eager glob inlines icons under 4 KB as base64 | `?url&no-inline` or `assetsInlineLimit` | S |
| B4 | 361 KB raw | `@tokenlens/models` is 81% of `ResourcesTokensSection` | Cost lookup in main over tRPC, or only the used tables | S/M |
| B5 | ~105 ms of main startup | `main/system/auto-updater.ts:7` imports `electron-updater` eagerly | `await import()` in `initAutoUpdater`, after the window shows | S |

Not worth it: tailwind-merge (94 KB, `cn()` needs its config), `@xterm/headless` in main (reattach
needs it early), minifying main (parse time only).

## 3. Requests and caching

About 70 process spawns a minute at baseline before any pane opens, from main-process timers that
keep running when the window is hidden. Renderer polls already stop when hidden
(`refetchIntervalInBackground` is off; `staleTime: 5_000`, no focus refetch). IPC payloads are small.

| Id | What | Rate and cost | Fix | Effort |
|---|---|---|---|---|
| N1 | `main/agents/shell-promotion.ts:170,208` `readProcessTable()` (`ps -A ... args=`, 8 MB buffer) | Every 3 s while any terminal is live | Use the shell integration's preexec/OSC hooks; keep `ps` as a 15-30 s fallback or only while a shell has a foreground job | M |
| N1b | `main/system/resources.ts:67,175,308` metrics collector | Every 10 s, always: `ps -A`, `vm_stat`, `df`, a broadcast | Pause with no visible window or subscriber; share one `ps` with N1 | S |
| N2 | `GitPane.tsx:42` `diff.status` + `SmartGitAction.tsx:217` `diff.gitState`, 15 s each | 1 + 4 git spawns per 15 s per Git pane, `git status -uall` twice, hidden tabs included | 2 s cache on `readGitStatus(cwd)`, one query for both, `fs.watch` on `.git/index` and `HEAD` pushing `git:changed` | S/M |
| N3 | `ProjectItem.tsx:48` `useProjectPorts` (10 s per sidebar project) | 2 `lsof` (3 s cache) + 4 uncached config reads per project per tick | One global ports query or a push; config ports cached by mtime | S |
| N4 | `ipc/procedures/oplog.ts:131` `listSnapshots` | Sync napi git2 walk of 200 commits on the main thread every 15 s while Oplog is open | `*Async` variant; refetch on `agent:turn-changes` | S |
| N5 | `ipc/procedures/github.ts:77` `listIssues` | Network every 60 s, 100 issues with bodies, no cache | 5 min `staleTime`, no `body` in the list, ETag | S |
| N6 | `useAgents`, `useAgent` per pane, `useFleetSync`, `useRecentSessions` | 30-60 s polls of data already pushed | Drop the intervals or 5 min; pushes already invalidate | S |
| N7 | `integrations/github/gh.ts:4` `detectGhCli` | A missing gh spawns `gh --version` every 15 s per pane | Cache the miss 60 s, clear when the login PATH lands | S |
| N8 | `use-trpc-tokens.ts:25,49,60,71`, `bar-widgets.tsx:300` | 5 token queries every 30-60 s for data that changes only after a scan | Push `tokenUsage:changed` | S |
| N9 | `AgentQuestion.tsx:16` `agents.screenDialog` | Every 2 s per question card | Push when the dialog fingerprint changes | S |

Already cached and fine: cli-versions, release notes, project-detect, resources `du`, history
listings, `gh pr view`, Claude and Codex plan usage, tray menu. pr-watch has no backoff on offline
or auth errors (small).

## 4. Database: slow queries and N+1

Live DB `~/Library/Application Support/Exegol/exegol.db`: 3.2 MB plus a 4.1 MB WAL; agents 289 rows
(212 archived), `final_output` 1.68 MB total. WAL, `synchronous=NORMAL`, `busy_timeout=5000`.
`dbInit` 3-10 ms. Every plan checked uses an index; no slow query today. The cost is write volume,
fat rows and loops. (`~/.exegol/exegol.db` is an empty stale file.)

| Id | What | Fix | Effort |
|---|---|---|---|
| Q1 | `agents/agent-session-callbacks.ts:396,406` call `updateAgentStatus` (`db/queries/agents.ts:290`) on every parser step, unchanged or not | Last status/step in memory, write on change, step-only writes throttled to ~1 s | S |
| Q2 | `SELECT a.*` in `listAgents` (`agents.ts:40`), `getAgent` (`:230`), `listActiveAgents` (`:20`), `listAgentsByIds` (`:242`) reads and validates `final_output`, then drops it | One explicit column list without it | S |
| Q3 | `getMcpAgentStates` (`mcp/exegol-server.ts:146`) runs the 4-table join for id + cli_type | `SELECT id, cli_type ... WHERE status IN (...)` | S |
| Q4 | `recoverStaleAgents` (`agents.ts:439`) and `auto-resume-plan.ts:45-63`: one statement and commit per agent at startup (~120 with 39 sessions) | One transaction, prepared once, `listAgentsByIds` | S |
| Q5 | `resolveWatched` (`ipc/procedures/agents-resume.ts:94`): a query per resume hop per pin, temp B-tree sort | Recursive CTE + index `agents(resumed_from, started_at DESC)` | S/M |
| Q6 | Unindexed foreign keys scanned on every agent or project delete: `worktrees`, `handoffs` (2), `task_queue`, `memories`, `agent_links.to_agent_id`, `scheduled_results`; `prompts`, `pipeline_templates`, `scheduled_tasks`, `dictation_history` by project | Indexes in a `w3_` migration | S |
| Q7 | No retention for `activities`, `messages`, `token_usage`, `agent_scores`, `oplog`; unbounded `listProjectScores` (30 s poll), `listAgentOplog`, `getProjectTokenUsage` | LIMITs + a housekeeping retention step | S/M |
| Q8 | `db.prepare` on every call in all 22 query modules | Cached statements for the hot ones (`updateAgentStatus`, `getAgent`, `isAgentQuiet`, `setAgentLastActivity`) | M |
| Q9 | No `ANALYZE` / `PRAGMA optimize`; `listAgents` sorts in a temp B-tree | Daily `PRAGMA optimize`, index `agents(project_id, archived_at, started_at DESC)` | S |
| Q10 | `stopIdle` reloads the live list per stop (`agents/idle-suspend-sweep.ts:138`); reattach prepares `SELECT path FROM projects` per agent (`agents/reattach-sidecar-agents.ts:206`) | Lookup by id; one project path map | S |

Startup's 2.1 s reattach is the 24.8 MB of ring snapshots, not the DB.

## 5. Images, fonts and scripts (and packaging)

Measured on `dist/0.5.27/mac-arm64/Exegol.app` (475 MB, DMG 176 MB): Electron Framework 261 MB
(47 MB of `.lproj`), `app.asar` 164 MB (192 MB of `node_modules` inside), `app.asar.unpacked` 43 MB
(sherpa-onnx 33 MB, libsql 7.5 MB, node-pty 2.8 MB).

| Id | Saving | Where | Fix | Effort |
|---|---|---|---|---|
| P1 | ~110-125 MB unpacked, ~40 MB DMG | `apps/desktop/package.json` | Renderer-only deps (`streamdown`, `tokenlens`, `@radix-ui/react-dialog`, `@tanstack/react-virtual`) to `devDependencies`: Vite already bundles them (mermaid 74 MB, cytoscape 14.6 MB, katex 4.4 MB come with them) | S, smoke-test the packaged main |
| P2 | 66 MB unpacked | `electron-builder.ts` `files` | `!**/node_modules/**/*.map`, `!**/*.md`, `!**/*.d.ts`, test and docs folders | S |
| P3 | ~45 MB unpacked, ~15 MB DMG | `electron-builder.ts` | `electronLanguages: ["en"]` (plus any UI language wanted) | S |
| P4 | ~33 MB | `asarUnpack` sherpa-onnx | Download the dictation runtime on first use, like the speech models | L |
| F1 | 7.2 to 3.05 MB | `styles/fonts.css` + `assets/fonts` | WOFF2 (`format("woff2")`); keep all glyphs (TUIs use the Nerd icons) | S |
| F2 | Clarity | `index.html`, `globals.css` | `Inter` is named but never shipped (CSP blocks remote fonts): state the system stack, or bundle one Inter WOFF2 subset (~25 KB) | S |
| I1 | 266 KB | `extraResources` `tray-icon.png` | 256 or 512 px copy | S |
| I2 | ~14 KB SVG, ~50 KB PNG | `assets/icons` | svgo; byte-identical light/dark pairs (ollama, codex) as one file; crush, gemini-cli, aider PNG to SVG or WebP | S |

Fine: fonts are Regular only and only the configured family loads at startup; Tailwind v4 output is
already purged; no sourcemaps in `out/`; no inline or third-party scripts; tight CSP apart from the
intended `frame-src *`.

## Suggested batches

1. **Packaging config** (P1, P2, P3): config only, the biggest size win; needs one packaged smoke test.
2. **Render churn** (R1, R2, R3, R4): small, removes most full-tree renders; then R5-R7.
3. **Main-process timers** (N1, N1b, N2, N7): the hidden-window CPU cost.
4. **Agent DB writes and rows** (Q1, Q2, Q3, Q4, Q6).
5. **Startup chunk** (B2, B3a-e, B5) and **Monaco** (B1) on its own.
6. **Fonts and icons** (F1, F2, I1, I2).
