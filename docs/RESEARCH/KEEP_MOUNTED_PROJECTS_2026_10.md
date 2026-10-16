# Keep recent projects mounted (analysis, 2026-10-16)

Question: keep the last N projects' workspaces mounted (hidden) so switching back to one skips the
xterm rebuild, the snapshot replay and the reflow. Analysis only; nothing here is built yet.

## Today

- `AgentsSection.tsx` (`AllTabsLayout`) renders the active project's tabs keyed by `tab.id`;
  inactive tabs stay mounted as `invisible absolute inset-0`, and `use-xterm` turns that into
  `display: none` (`isShown`) once an `exegol:refit-terminals` arrives.
- A project switch (`switchProject` in `stores/workspace/helpers.ts`, run from the app store
  subscriber in `stores/workspace.ts`) only changes `_activeProjectId` and `focusedPaneId`. Every
  selector goes through `getPw`, which reads the active project, so the old project's tab keys
  vanish and every pane unmounts: xterm, webview, Monaco.
- Coming back = new xterm per terminal, snapshot fetch and write, fit, PTY resize (the remount
  costs #405 to #407 measured and trimmed).

Hidden tabs are not cheap either (checked after the first draft): showing a project mounts every
terminal of every tab, and each one fetches its full snapshot (up to 2 MB; `HIDDEN_SNAPSHOT_BYTES`
applies only to the startup reattach) and builds a full xterm. Only the fit and WebGL are skipped
while hidden. A project with 3 tabs pays for all of them on every switch, and a hidden tab's normal
buffer still reflows once shown. `[ProjectSwitch]` (#410) now logs that cost per switch.

The tab mechanism is the one to extend: one `invisible` layer per kept project, same as per tab.

## What assumes one active project

Breaks at once if a non-active project's panes stay mounted:

| Where | Problem |
|---|---|
| `WorkspacePane.tsx`, `PaneToolbar` | `selectPanes(s)[paneId]` reads only the active project: "Pane not found" |
| `useProjectContext()` in `BrowserPaneContent`, `PageView`, `useRegisterBrowserPane`, `TerminalPanel`, `WorkspacePane` | Returns the active project. A webview's partition (`persist:project-<id>`) cannot change after attach |
| `setSplitSizes` (from `WorkspaceLayout`), `updatePane`, `equalizeSplits`, `removePane` | Write through `getPw`/`setPw`: a kept pane's change lands nowhere or in the wrong project. `setPaneUrl`, `setFilesView`, `releaseAgent` already search every project |

Already safe (they match a global pane id or check the active tab): `use-launcher-keys`,
`pane-focus`, the `exegol:focus-pane` listener, `takeKeyboard` in `use-xterm`, dictation
`paneOnScreen`, the pane switcher MRU (per project already), idle exempt.

Needs care: an xterm of the old project can hold DOM focus until the refit hides it; window
`resize` and refit events reach every mounted terminal (hidden ones skip the fit, small cost).

## Cost per kept project

| Item | Hidden cost |
|---|---|
| xterm | 5,000 lines of scrollback: estimated 2 to 12 MB per terminal by width (not measured) |
| Dormant ring | 256 KB cap, rarely fills: main stops streaming to a hidden view |
| WebGL | Released after `HIDE_DEBOUNCE_MS` while hidden; the cap of 8 stays per renderer |
| Browser pane | The webview stays alive: its renderer process, page JS and timers, often 100+ MB. The main cost |
| Files pane | One Monaco editor and model |
| Git and PR polling | `GitPane`, `SmartGitAction`, `TerminalPanel` poll every 15 s; kept panes multiply it |

Coming back still costs one screen snapshot when the session printed while hidden
(`ipc-handlers.ts`, `consumeMissedOutput`), far cheaper than a mount.

## Proposed design

1. **List**: `mountedProjects: string[]` in the workspace store, in memory (out of `partialize`).
   `switchProject` moves the project to the front and trims to N = 3 (counts the active one; a
   setting later). A deleted project leaves at once.
2. **Render**: `SectionArea` maps `mountedProjects`; each gets a `ProjectScope` provider
   (project id, project, pane lookup) and `invisible absolute inset-0 inert` when not active. The
   switch subscriber dispatches `exegol:refit-terminals` so hidden terminals take `display: none`.
3. **Scope**: selectors with a project id (`selectPanesOf(pid)`, `selectTabsOf(pid)`); the four
   writers above take a `projectId` or find the pane in any project like `setPaneUrl`. Pane
   components read the project from the scope, not `useProjectContext`. Tab bar, pane switcher
   and hotkeys stay on the active project.
4. **Focus**: blur `document.activeElement` when it sits in a project being hidden; `inert` keeps
   keys and Tab out.
5. **Polling**: pane queries `enabled` only while on screen (also the open item on hidden panes
   polling in TASK_TODO).
6. **Browser panes**: the heavy part. Options, cheapest first: (a) evict a kept project with
   webviews first; (b) cap kept webviews across projects (for example 2); (c) the main-owned
   `WebContentsView` per browser pane already in TASK_TODO, which would make this free.

## Hard requirements (from the review, 2026-10-16)

- **Browser panes never share across projects.** Each keeps its `persist:project-<id>` partition
  from its own project id, never the active one; a kept webview from the wrong scope would carry
  another project's cookies. A test must pin it.
- **No pane is lost** across tabs or projects: hiding or evicting only unmounts views, the layout
  and sessions stay in the store.
- **Only the active tab paints on a switch**: hidden tabs' terminals mount lazily (first shown) or
  stay mounted from before, never rebuilt all at once. This is worth doing even without the LRU.

## Phases

0. Measure with `[ProjectSwitch]` and decide.
1. Lazy hidden tabs: a tab's terminals mount the first time it is shown in this project visit.
2. Terminals only: kept projects render their terminal, files and git panes; a browser pane in a
   hidden project unmounts as today. Gets the switch-back win with no webview memory risk.
3. Measure (below) and pick N.
4. Browser panes by option (a) or (b), or wait for (c).

## What to measure before and after (N = 1, 3, 4)

- Renderer RSS and JS heap (`process.getProcessMemoryInfo`), webview process RSS.
- Live xterms and WebGL contexts (must stay at 8 or fewer).
- Switch-back time and reflows from `[TermMount]` and `settled` lines (none expected for kept projects).
- How often `[Visible] on` sends a snapshot on reveal.

## Risks

- The scope refactor touches every pane component; a missed `useProjectContext` shows the wrong
  project's data in a hidden layer. Tests: `stores/workspace-project-switch.test.ts`,
  `stores/workspace/helpers.test.ts`, plus a new one for the LRU list.
- A webview partition picked from the wrong project would leak cookies across projects: phase 1
  keeps webviews out for that reason.
