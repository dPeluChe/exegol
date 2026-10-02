# Keyboard Shortcuts

In the app, `Cmd+/` (`Ctrl+Shift+/` on Linux and Windows) shows this list for your platform.

**Linux and Windows**: the app's key is `Ctrl+Shift`, not `Ctrl`, because a focused terminal owns
`Ctrl+letter` (`Ctrl+C` interrupts, `Ctrl+D` is end of input, `Ctrl+W` deletes a word) and the
Super/Windows key belongs to the desktop. A macOS shortcut with `Shift` or `Option` added becomes
`Ctrl+Shift+Alt`. Same idea as GNOME Terminal and the VS Code terminal.

Source of truth: `apps/desktop/src/renderer/lib/keymap.ts` (the rule), `hooks/use-hotkeys.ts`
(the handlers) and `lib/shortcuts.ts` (the list the app shows). A change to a shortcut updates
those and this page.

## Navigation

| macOS | Linux / Windows | Action |
|-------|-----------------|--------|
| `Cmd+K` / `Cmd+Shift+P` | `Ctrl+Shift+K` / `Ctrl+Shift+P` | Command palette (`!<cmd>` runs a one-shot shell) |
| `Cmd+1` | `Ctrl+Shift+1` | Dashboard |
| `Cmd+2`..`Cmd+9`, `Cmd+0` | `Ctrl+Shift+2`..`9`, `Ctrl+Shift+0` | Live tabs: a number set in Edit project first, then the sidebar's order; tabs whose sessions are all pinned go last |
| `Cmd+Option+1`..`9` | `Ctrl+Shift+Alt+1`..`9` | This project's workspace tab by position |
| `Cmd+Shift+]` / `Cmd+Shift+[` | `Ctrl+Shift+Alt+]` / `[` | Next / previous workspace tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | same | Next / previous pane of the tab (works from inside a terminal) |
| `Cmd+]` / `Cmd+[` | `Ctrl+Shift+]` / `[` | Next / previous pane (same as Ctrl+Tab) |
| `Cmd+J` | `Ctrl+Shift+J` | Next agent waiting on you |
| `Cmd+B` | `Ctrl+Shift+B` | Toggle the sidebar |

Every jump puts the cursor in the pane it lands on, ready to type.

## Agents, tabs and panes

| macOS | Linux / Windows | Action |
|-------|-----------------|--------|
| `Cmd+N` | `Ctrl+Shift+N` | Launch dialog (new agent) |
| `Cmd+Shift+N` | `Ctrl+Shift+Alt+N` | Parallel spawn (same task, several agents) |
| `Cmd+.` | `Ctrl+Shift+.` | Stop the focused agent |
| `Cmd+T` | `Ctrl+Shift+T` | New workspace tab |
| `Cmd+W` | `Ctrl+Shift+W` | Close the focused pane (the tab if it is the last) and stop its agent |
| `Cmd+D` / `Cmd+Shift+D` | `Ctrl+Shift+D` / `Ctrl+Shift+Alt+D` | New pane to the right / below |
| `Cmd+L` | `Ctrl+Shift+L` | Browser pane (or floating browser): select its address bar |
| `Cmd+R` | `Ctrl+Shift+R` | Browser pane (or floating browser): reload its page. Elsewhere on macOS Cmd+R reloads the window |
| `Cmd+Enter` | `Ctrl+Enter` | Launch from the spawn dialogs, send a diff comment |

## Window

| macOS | Linux / Windows | Action |
|-------|-----------------|--------|
| `Cmd+,` | `Ctrl+Shift+,` | Settings window |
| `Cmd+/` | `Ctrl+Shift+/` | Shortcuts overlay |
| `Esc`, `Cmd+W` | `Esc`, `Ctrl+Shift+W` | Close the Settings or a floating window (a focused terminal keeps Esc) |
| `Esc` | same | Leave the Projects view, back to the project or Dashboard it was opened from |
| `Cmd+Shift+0` | none | Reset zoom (`Cmd+0` is a live tab slot) |
| `Cmd+Shift+E` | `Ctrl+Shift+E` | Bring Exegol to the front from any app (global, configurable in Settings) |

## Inside a terminal

| macOS | Linux / Windows | Action |
|-------|-----------------|--------|
| `Cmd+C` / `Cmd+V` | `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copy the selection / paste |
| `Shift+Enter` | same | New line without submitting (Claude Code, and TUIs that take Ctrl+J) |
| `Option+←` / `Option+→` | `Alt+←` / `Alt+→` | Word back / forward |
| `Cmd+←` / `Cmd+→` | `Home` / `End` | Start / end of the line |
| `Cmd+Backspace`, `Option+Backspace` | `Ctrl+Backspace`, `Alt+Backspace` | Delete the previous word |
| `Cmd+↓` | `Ctrl+Shift+↓` | Jump to the newest output |
| `Cmd+click` | `Ctrl+click` | Open a file path or URL from the output |
| `Esc` | same | Close the Files peek before the CLI sees the key |

Right-click a terminal pane for Clear Terminal, split, float and layout actions. Select text to
get **Send to**, which pastes it into another live agent without submitting.
