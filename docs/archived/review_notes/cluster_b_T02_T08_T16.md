# Review Notes — Cluster B: Diff Viewer, Terminal Split Panes, Scrollback Persistence

## Tasks completed
- T02: Diff Viewer — replaced placeholder DiffSection with a real git diff viewer. Manual unified diff parser, per-file collapsible sections, unified/split view modes, unstaged/staged toggle, auto-refresh, stats bar.
- T08: Terminal Split Panes — extracted TerminalInstance from TerminalPanel, created TerminalSplitView with tree-based split layout using react-resizable-panels, added Cmd+D / Cmd+Shift+D hotkeys. Each new pane starts unassigned with an agent picker UI — true multi-agent split support.
- T16: Terminal Scrollback Persistence — per-agent scrollback buffer in AgentManager (1MB cap), periodic flush every 30s + final flush on exit, read-only xterm replay for stopped agents with re-launch button.

## Post-implementation improvements (before PR)
1. **use-hotkeys.ts perf fix**: Removed `agents` and `focusedAgentId` from useEffect deps and `Object.values()` outside selector. Now reads store snapshots via `useAgentStore.getState()` inside the keydown handler — eliminates unnecessary re-renders and re-registrations.
2. **Periodic scrollback flush**: Added 30s interval timer per agent. Survives app crashes (up to 30s data loss vs total loss). Timer cleaned up on process exit before final flush.
3. **Per-pane agent assignment**: New panes from split start with `agentId: null` and show a `PaneAgentSelector` UI with list of all project agents. User picks which agent to display. Added `setPaneAgent` store action and `PaneAgentSelector` component. Close pane button visible on split panes.

## What I'd improve with more time
- T02: Word-level diff highlighting within changed lines (not just line-level coloring)
- T02: Binary file detection (show "Binary file changed" instead of garbled output)
- T02: File tree sidebar for navigating large diffs
- T02: Virtualized list for very large diffs (>5MB / 10k+ lines)
- T08: Persist split layout to Zustand persist so it survives reload
- T08: Keyboard-based pane focus cycling (e.g., Cmd+Alt+Arrow to move between panes)
- T16: Compress scrollback files (gzip) to reduce disk usage for long sessions
- T16: Scrollback cleanup/pruning for old sessions (currently grows unbounded on disk)

## Edge cases not handled
- T02: Very large diffs (>5MB) — `maxBuffer` is set to 5MB, rendering 10k+ lines may cause jank
- T02: Binary files produce garbled diff output — no binary detection
- T02: Renamed files (`rename from/to`) not explicitly parsed (shows as delete + add)
- T08: Closing all panes in a split removes the layout (falls back to single terminal — safe behavior)
- T16: Up to 30s of data can be lost if app crashes between periodic flushes
- T16: Scrollback captures raw terminal escape sequences — xterm replays fine, but raw log files aren't human-readable

## Shared file conflicts risk
Files touched that other clusters may also modify:
- `router.ts`: added `diff: diffRouter` and `scrollback: scrollbackRouter` (lines 2, 5, 16-17)
- `use-trpc.ts`: added `useDiff` and `useScrollback` hooks (lines 161-180)
- `use-hotkeys.ts`: refactored to use `getState()` snapshots + added Cmd+D/Cmd+Shift+D (full rewrite of deps)
- `terminals.ts`: added `PaneNode` type, `paneLayouts` state, `setPaneAgent` action (lines 13-198)
- `AgentsSection.tsx`: changed `TerminalPanel` import to `TerminalSplitView` (lines 8, 39)
- `manager.ts`: added scrollback buffers, periodic flush timer, flushScrollback method (lines 2-3, 53-55, 115-122, 149-157, 245-264)

## Performance notes
- Diff parser is O(n) single-pass — handles typical diffs efficiently
- Scrollback buffer capped at 1MB per agent, periodic flush every 30s
- TerminalSplitView renders PanelGroup only when actual splits exist (single pane = direct TerminalPanel)
- Auto-refresh in DiffSection uses 5s interval (not polling on every render)
- use-hotkeys useEffect now has only 2 stable deps (`toggleSidebar`, `setActiveView`) — registers once

## New files created
- `apps/desktop/src/main/ipc/procedures/diff.ts` — tRPC router for git diff queries
- `apps/desktop/src/main/ipc/procedures/scrollback.ts` — tRPC router for scrollback file read (with path traversal guard)
- `apps/desktop/src/renderer/components/terminal/TerminalInstance.tsx` — reusable xterm.js component (extracted from TerminalPanel)
- `apps/desktop/src/renderer/components/terminal/TerminalSplitView.tsx` — tree-based split pane layout with close buttons
- `apps/desktop/src/renderer/components/terminal/PaneAgentSelector.tsx` — agent picker UI for unassigned split panes
- `apps/desktop/src/renderer/components/workspace/sections/diff/diff-parser.ts` — unified diff parser
- `apps/desktop/src/renderer/components/workspace/sections/diff/DiffFileView.tsx` — collapsible per-file diff section
- `apps/desktop/src/renderer/components/workspace/sections/diff/DiffHunkView.tsx` — hunk renderer with unified/split views

## New DB migrations
- None (no schema changes needed)

## New tRPC routes
- `diff.projectDiff` — returns unstaged git diff for a project (input: `{ projectId }`)
- `diff.stagedDiff` — returns staged git diff for a project (input: `{ projectId }`)
- `scrollback.get` — returns scrollback file content for an agent (input: `{ agentId }`)
- `scrollback.exists` — returns whether scrollback exists for an agent (input: `{ agentId }`)
