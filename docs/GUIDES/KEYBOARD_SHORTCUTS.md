# Keyboard Shortcuts

In the app, `Cmd+/` shows this list. macOS keys; the source of truth is
`apps/desktop/src/renderer/lib/shortcuts.ts` (the overlay) and `hooks/use-hotkeys.ts` (the handlers).
A change to a shortcut updates both files and this page.

## Navigation

| Shortcut | Action |
|----------|--------|
| `Cmd+K` / `Cmd+Shift+P` | Command palette (`!<cmd>` runs a one-shot shell) |
| `Cmd+1` | Dashboard |
| `Cmd+2`..`Cmd+9`, `Cmd+0` | Live tabs: a number set in Edit project first, then the sidebar's order; tabs whose sessions are all pinned go last |
| `Cmd+Option+1`..`9` | This project's workspace tab by position |
| `Cmd+Shift+]` / `Cmd+Shift+[` | Next / previous workspace tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous pane of the tab (works from inside a terminal) |
| `Cmd+]` / `Cmd+[` | Next / previous pane (same as Ctrl+Tab) |
| `Cmd+J` | Next agent waiting on you |
| `Cmd+B` | Toggle the sidebar |

Every jump puts the cursor in the pane it lands on, ready to type.

## Agents, tabs and panes

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | Launch dialog (new agent) |
| `Cmd+Shift+N` | Parallel spawn (same task, several agents) |
| `Cmd+.` | Stop the focused agent |
| `Cmd+T` | New workspace tab |
| `Cmd+W` | Close the focused pane (the tab if it is the last) and stop its agent |
| `Cmd+D` / `Cmd+Shift+D` | New pane to the right / below |

## Window

| Shortcut | Action |
|----------|--------|
| `Cmd+,` | Settings window |
| `Cmd+/` | Shortcuts overlay |
| `Cmd+Shift+0` | Reset zoom (`Cmd+0` is a live tab slot) |
| `Cmd+Shift+E` | Bring Exegol to the front from any app (global, configurable in Settings) |

## Inside a terminal

| Shortcut | Action |
|----------|--------|
| `Shift+Enter` | New line without submitting (Claude Code, and TUIs that take Ctrl+J) |
| `Option+←` / `Option+→` | Word back / forward |
| `Cmd+←` / `Cmd+→` | Start / end of the line |
| `Cmd+Backspace`, `Option+Backspace` | Delete the previous word |
| `Cmd+click` | Open a file path or URL from the output |
| `Esc` | Close the Files peek before the CLI sees the key |

Right-click a terminal pane for Clear Terminal, split, float and layout actions. Select text to
get **Send to**, which pastes it into another live agent without submitting.
