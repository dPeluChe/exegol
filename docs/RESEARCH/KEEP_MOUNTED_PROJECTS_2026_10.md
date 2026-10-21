# Keep recent projects mounted (analysis, 2026-10-16)

Question: keep the last N projects' workspaces mounted (hidden) so switching back to one skips the
xterm rebuild, the snapshot replay and the reflow. Phase 1 is built (2026-10-21, see
[Phase 1 built](#phase-1-built-2026-10-21)); the rest of this page is the analysis it followed.

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

## Phases

1. Terminals only: kept projects render their terminal, files and git panes; a browser pane in a
   hidden project unmounts as today. Gets the switch-back win with no webview memory risk.
2. Measure (below) and pick N.
3. Browser panes by option (a) or (b), or wait for (c).

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

## Phase 1 built (2026-10-21)

Branch `feat/keep-mounted-projects`. Terminals, files, git and launcher panes of the last 3
projects stay mounted; browser panes do not.

- **List**: `mountedProjects` in the workspace store (in memory, not persisted), set by
  `switchProject` through `keepMounted` (`stores/workspace/helpers.ts`, `MOUNTED_PROJECTS_MAX` 3,
  the active one counts). No project shown (null) empties it, since WorkspaceView then renders no
  Agents section. A deleted project leaves it in `useDeleteProject`.
- **Render**: `AgentsSection` maps `mountedLayers` (the list plus the active project, sorted so an
  LRU reorder never moves a layer's DOM) to `ProjectLayer`s: the active one `h-full`, the others
  `invisible absolute inset-0` and `inert` (set on the element). A project change dispatches
  `exegol:refit-terminals`, so the hidden layer's terminals go `display: none` and the shown
  ones fit.
- **Scope**: `contexts/ProjectScope.tsx` (`ProjectScope`, `usePaneProject`: project id, project,
  `shown`) wraps each layer. WorkspacePane, PaneToolbar, the files pane, TerminalPanel,
  EmptyPane, BrowserPane, GitPane, SmartGitAction, DiffSection and OplogSection read it instead of
  `useProjectContext`; the tab bar, quick launch, layout presets, pane switcher, hotkeys and the
  project sections stay on the active project. Selectors `selectPanesOf`, `selectTabsOf`,
  `selectActiveTabIdOf`.
- **Writers**: `updatePane`, `removePane`, `equalizeSplits` and `setSplitSizes` find the project
  holding the pane or tab (`projectOfPane`, `projectOfTab`, active first); a hidden project's
  change never moves the focus. This also fixes a spawn that finished after a switch (its
  `updatePane` used to land nowhere) and a split drag saved 200 ms after one.
- **Browser panes**: `ScopedBrowserPane` renders a placeholder in a hidden layer, so a webview
  only ever mounts in the active project, with its partition, as before.
- **Focus**: a layer being hidden blurs the element it held (layout effect, before paint); a layer
  shown again without a remount sends `exegol:focus-pane` to the active pane after two frames when
  nothing else holds the focus (what a mounting terminal's `takeKeyboard` did).
- **Polling**: `diff.status` (GitPane, TerminalPanel toolbar), `diff.gitState` (SmartGitAction),
  the oplog lists and Diff's auto refresh are `enabled` only while `shown`; they refetch when the
  project is shown again.
- **Log**: `[ProjectSwitch] <id> mounted N terminals (...), K already mounted, in Xms, ...`: `K`
  is `mountedTerminals` of the project when it was kept (terminal panes with a session, not
  floating, not invalid).

Not verified without running the app: memory per kept project (the estimate above stands),
focus after a switch by sidebar click versus Cmd+n, and whether `inert` plus the blur cover every
focus path (an open context menu or Radix popover in the hidden layer).

## What remains

- **Phase 2**: measure renderer RSS, JS heap, live xterms and WebGL contexts with N = 1, 3, 4 and
  the `[ProjectSwitch]` "already mounted" counts in real use; pick N (maybe a setting).
- **Phase 3**: browser panes, by option (a) or (b) above, or the main-owned `WebContentsView` (c).
