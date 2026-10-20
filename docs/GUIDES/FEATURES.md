# Features

Everything Exegol does today, grouped by area. The README lists the highlights; what changed in
each version is in [CHANGELOG.md](../CHANGELOG.md), pending work in [TASK_TODO.md](../TASK_TODO.md).
How it is built: [CLAUDE.md](../../CLAUDE.md).
Keys are written for macOS; on Linux and Windows `Cmd` is `Ctrl+Shift` (see
[KEYBOARD_SHORTCUTS.md](KEYBOARD_SHORTCUTS.md)).

## Workspace

- **Projects**: any folder or git repo. Each one has its own tabs, name, color or icon, and an
  optional keyboard number (Edit project). Projects can be grouped in the sidebar.
- **Sidebar views**: a selector under Dashboard switches the sidebar between Agents (live
  sessions per project, with an "Active only" filter: working or waiting on you), Projects and Needs attention. Each tab
  shows its count; a new attention item never switches the view by itself. The collapsed rail
  has the same three views as icons.
- **Tabs and panes**: every project has workspace tabs; a tab splits into panes of five types:
  terminal (an agent CLI or a plain shell), browser, files (explorer + Monaco viewer, with a
  Preview of Markdown and HTML; HTML renders offline from the project's files, scripts off until
  "Run scripts"), git, and an
  empty pane with the launcher. The launcher starts from a folder, "📁 project / folder ▾" (the
  project root unless the pane was set to another; / or Cmd+F filters the project's folders, each
  marked git, node, xcode, swift or expo, and the list's refresh finds them again). Agents,
  Terminal, Files, Git, Browser, Finder (Explorer on Windows, the file manager on Linux), the
  editor (the project's IDE, else Settings', shown only when installed) and the folder's commands
  all start there. Keys while the pane has the keyboard: 1-9 the agents, T F G B O E the rest, Option+1..9 (Alt+1..9 off macOS) the folder's commands.
  Picking an agent turns the pane into its launch form ("Claude Code in web"): session, model,
  mode, YOLO, Here or Worktree (a worktree only from the root) and the prompt; Enter launches and
  Esc goes back. The agent can be switched in the form and in the Launch Agent dialog, keeping
  the folder, prompt and mode. Its sessions and "Continue last" are those in that folder. "Split with
  Terminal" in a pane's menu (Cmd+Y) opens a shell beside it in that pane's folder: a shell's
  current folder, an agent's worktree, the open file's folder, else the project root.
- **Layouts**: six presets (Single, Split Horizontal, Split Vertical, Three Columns, Bottom
  Terminal 70/30, 2×2 Grid), your own saved layouts, and Equalize splits. A project keeps its
  own named layouts (its menu > Layouts...) that start its terminals and agents again. Drag a pane by its left
  edge to move it. Move a pane to another tab from its menu (Move to Tab), the Command Palette, or
  by dragging its grip (before the session name, or in its hover bar) onto a tab; onto the tab
  bar or "+" it gets a new tab. A tab left empty closes; the session keeps running.
- **Picture-in-Picture**: a terminal or browser pane detaches into a small always-on-top window.
- **Terminal links**: URLs and file paths in any terminal (agents, shells, Dashboard cards) are
  clickable. A URL opens in the tab's link preview pane; a file (`src/app.ts:42:7`, `./a.tsx`,
  `~/notes.md`, absolute) opens read-only at its line in a movable, resizable window over the
  workspace, images as pictures, PDFs in their app. Esc or Cmd+W closes that window, never the
  session. Only files inside the session's project or its worktrees are links. Cmd+click (Ctrl+click on
  Linux and Windows) opens a URL in the system browser and a file in the IDE at its line;
  Cmd+Shift+click shows the file in Finder. Hovering shows the target and the clicks.
- **Open in IDE**: Settings > General picks the default IDE among the ones installed (VS Code,
  VS Code Insiders, Cursor, Devin Desktop (formerly Windsurf), Zed, Antigravity IDE, Sublime Text,
  Nova, IntelliJ IDEA, WebStorm, PyCharm, GoLand, RustRover, Neovim, Vim, or a custom command);
  the rest show greyed with a link to their download page. Edit project can pick another IDE for
  one project. Files open at their line with each IDE's own syntax; Neovim and Vim open in a new
  terminal tab.
- **Command palette** (`Cmd+K`): projects, agents, commands, and `!<cmd>` for a one-shot shell.
- **Keyboard first**: jump to any live tab, pane or waiting agent without the mouse; see
  [KEYBOARD_SHORTCUTS.md](KEYBOARD_SHORTCUTS.md).
- **Right-click menus** on panes, files, projects, groups and agents, kept inside the window.
- **Status bar and title bar**: widgets you pick in Settings > Bars (or the status bar gear), each hidden or placed
  left, center or right of the status bar, or left or right of the title bar, in your order: project, branch, agents (need you / working / waiting,
  click for the list), plan usage, and opt-in tokens today, resources (the whole machine's CPU and RAM, as percent or GB), CLI and Exegol updates,
  unread alerts, focused session, git state, reconnect progress and a clock.

## Agents

- **14 built-in CLIs**: Claude Code, Codex, Gemini, Antigravity, Devin, Aider, Goose, OpenCode,
  Amp, Kiro, Kilo Code, Crush, Factory Droid and a plain shell, plus your own custom CLI.
  Settings enables, configures or installs each one.
- **Sessions that survive**: terminals run in a detached PTY process, so a reload, a crash or an
  update does not kill your agents; the app reattaches and replays the screen. If the terminals
  stop answering, a banner offers Retry (reconnect, sessions keep running) and Restart terminals
  (sessions end and come back as crashed, resumable).
- **Live status**: running, waiting on you, done, failed, crashed. Claude Code reports it through
  hooks; the others through output parsing. A pulsing dot on the tab shows who is busy.
- **Attention**: agents waiting on you show in the sidebar (Needs attention), the title bar queue
  and a desktop notification with the pending question. `Cmd+J` goes to the next one.
- **Shell to agent**: type a CLI in a plain terminal and that terminal becomes the agent (name,
  status, Dashboard); when the CLI exits, Continue resumes it.
- **Watch PR**: opt in from a session's toolbar and Exegol checks its branch's PR every 3 minutes
  (needs `gh`). Failing checks, new review comments and merge conflicts are sent to the agent at
  its next turn (never over a permission prompt) and land in Needs attention. At most 3 messages
  of each kind per pushed commit and 10 per watch; the agent's own comments are skipped.
- **Idle auto-suspend**: a session with no output and no typing for 7 days (Settings > General >
  Sessions: Off, 1, 3, 7 or 14 days) frees its memory. Agents are suspended (Resume continues
  them, the worktree stays as it is), terminals at their prompt close. Never one that is working,
  pinned in Watching, on Watch PR, waiting on you, in a pipeline, with uncommitted worktree
  changes or a server listening, nor a terminal running anything. A toast links each session
  with its project; suspended sessions carry a "Suspended" mark in the sidebar.
- **Send to**: select text in one terminal and paste it into another live agent or terminal
  (the floating Send to button, or right-click > Send selection to). Sessions of the pane's own
  project come first; other projects sit behind "Other projects (N)", open when the own project
  has nothing else. By default nothing is submitted: a terminal gets the command at its prompt to
  review and run, a multi-line text is one bracketed paste. Settings > Terminal > Send to can press
  Enter after the paste, separately for terminals and agents; an agent asking a question or a
  permission only gets the paste (a toast says so). The list's footer shows the current behavior.
  Arrows, Enter and Esc work in the list. Sessions read "argo · exegoldev" (alias and the CLI's
  session name), terminals "Terminal · folder". In Claude or another TUI that uses the mouse,
  select with Option+drag (Shift+drag on Linux and Windows): a plain drag is the TUI's own.
- **Follow-ups and Steer**: Queue in the terminal toolbar (and on a Watching card) holds prompts
  for an agent's next turn; each is typed when the turn ends, one per turn. Steer (Claude Code,
  Codex) interrupts the turn (Esc), waits up to 20s for the prompt and types right away. The queue lives in memory: it
  is lost on app quit and dropped when the session ends.
- **Launch options**: model (for CLIs with a model flag) and session name in the launcher.
- **Access modes**: read, write or plan per agent or pipeline step, shown as a badge.
- **Resume**: Claude sessions resume with their session id after a restart.
- **Ended session pane**: when a CLI exits (Ctrl+C, /exit, a crash) its pane shows "Claude Code
  ended · name · project / folder" with the status and exit code, Resume (same conversation,
  model, YOLO, mode and name; Restart when the CLI cannot resume), a new session of the same CLI
  in the same place, an agent switcher, and Terminal, Files or Browser in that folder; the output
  stays one click below. A closed terminal offers Reopen terminal here (its last folder).
  Keys: R, N, T, F, B, 1-9.
- **CLI updates**: a session offers Restart to update when its CLI has a newer install, and
  Update when a newer release is out; the conversation resumes on the new version. The update
  command matches how the running copy was installed; Settings > CLIs lists duplicate installs
  and how to remove the extras; a CLI that updated itself offers Restart session.
- **Terminal or chat view**: switch any agent between the raw terminal and a readable chat.
- **Agent tools (MCP)**: every agent gets an Exegol MCP server: shared memory, project knowledge,
  messages between agents, and file claims so two agents do not edit the same paths.

## Dashboard

- **Fleet** (`Cmd+1`): every live agent across projects with status, uptime, tokens and cost,
  and its message thread with other agents.
- **Watching**: pin sessions to see them as live terminals side by side (one to three columns,
  collapsible, reorderable); type into a card after clicking it.
- **Right-click menus**: a Watching card offers Go to session, Copy (with text selected),
  Collapse/Expand, Fit session to card, A-/A+, Float to window and Unpin; an ended pin offers
  Resume, Open project and Unpin; a fleet card offers Go to session, Watch, Mute, Suspend, or
  Resume and Archive once it ended.

## Browser and QA

- **Browser pane**: a webview with URL bar and navigation, next to your agents. It remembers
  the page it was on, and can show it at a device size (desktop, laptop, tablet, mobile).
  Zoom per pane (address bar or Cmd+= / Cmd+- / Cmd+0), and a camera button that saves the
  visible area or the full page as PNG or JPEG, or copies it.
  A page's `alert()`, `confirm()` and `prompt()` show as a bar inside the pane, never as a
  window-wide dialog. A page asking for location, camera, microphone, notifications, MIDI or to
  open another app gets a bar too: Allow once, Always allow on this site, or Block. Saved answers
  are per project and site, in Edit project > Site permissions (× forgets one). On macOS the
  first location Allow asks macOS for Location Services access.
- **Design mode**: click an element to send its selector, styles and HTML to an agent.
- **Agents in the browser**: agents drive the project's browser pane through the Exegol MCP
  tools (`browser_open`, `browser_snapshot`, `browser_click`...), live in the same pane you see.
  Each project has its own browser session; agents only reach local hosts (localhost,
  127.0.0.1, *.localhost) and the hosts listed in Edit project > Agent browser hosts (add `.local`
  names there too); adding a host copies your logins for it. While an agent drives, requests to
  other hosts are blocked. `browser_eval` (JavaScript in the page) is off until you tick it in
  Edit project. A banner shows who is driving, with Take over and Hand back. At a login page the
  agent stops and asks you (an alert opens the pane), and resumes when you click "Done, hand
  back". Agents are told never to type passwords; Exegol also refuses fields it recognizes as
  passwords, but treat that as a safeguard, not a guarantee.
- **Ask agent**: from the browser bar, send an agent the page you are on, a note and a picked
  element; it arrives at the agent's next turn.
- **QA record and replay**: record clicks, typing and navigation as a test, replay it, and see
  per-step results, console errors and screenshots in the QA Tests section.
- **Simulator pane** (macOS with Xcode): pick an iOS Simulator device, boot it and see it live
  in a pane; click to tap, drag to swipe, type when the pane has the focus (US keyboard
  characters, Enter, Backspace, Tab, Esc; paste works). Toolbar: Home, copy or save a screenshot,
  Open in Simulator.app, boot or shut down. Open it from the launcher's Simulator button (key S),
  the pane menu's Split with Simulator, or the Command Palette. Not offered on Linux or Windows. Needs AXe (MIT):
  `brew install cameroncooke/axe/axe`; the pane shows that command when AXe is missing and
  never installs anything itself.

## Git and code

- **Smart Git button**: one button that knows the next step (commit, push, create PR, merge PR,
  resolve conflicts), with AI commit messages from the diff (Claude Haiku).
- **Diff viewer**: staged and unstaged, unified or split, with line comments.
- **Worktrees**: an agent can run in its own branch and worktree, cleaned up when it ends. Its
  pending work is first committed and pushed to that branch (Settings > General > Worktrees,
  on by default); if that cannot be done safely the worktree is kept.
- **Oplog**: snapshots of what agents changed, with undo.
- **Undo a turn**: after each Claude Code turn that changed files, the terminal toolbar shows
  "N files changed"; it opens that turn's diff and offers Undo turn (with a confirmation). Undo
  puts back only the files you have not edited since, and commits nothing.

## Project

- **Tasks and History**: the project's task list and a timeline of past agent sessions.
- **Pipelines**: agents in sequence on a shared worktree, with review and fix loops, evaluator
  gates (ship, hold or retry) and an exported evidence report.
- **Parallel runs**: several agents on the same task, compared side by side.
- **Prompts and skills**: reusable prompts and personas injected when an agent starts.
- **Memory and Knowledge**: facts agents save (recalled by relevance), and an opt-in project
  brief kept in `.exegol/knowledge/`.
- **Lifecycle scripts**: `.exegol/lifecycle.yaml` runs setup, before-agent, after-commit and
  teardown hooks.
- Built but not in the UI yet: the scheduler (cron tasks) and semantic search over the code.

## Monitor

- **Resources and tokens**: CPU, memory and disk, token usage and cost by model, budgets with
  alerts.
- **Scoring**: a score for each finished agent run.

## App

- **Settings window**: its own window, so you can change themes, fonts or keys while agents run.
- **Themes**: light, dark, black (OLED) and system. Three Nerd Fonts are bundled.
- **Voice dictation**: Cmd+Shift+Space (Ctrl+Shift+Space on Linux and Windows) to start and
  again to insert (or Enter while the overlay is open), or hold it while you talk; Esc cancels. Insert waits until the whole text is transcribed ("Transcribing…"). Opt-in Auto insert after silence (5, 7 or 10 s, a 3 s countdown on the card; never presses Enter). Transcribed on this machine; the text
  goes only into the focused pane (pasted into a terminal without Enter, a browser page's focused
  field, the code editor's cursor), else it is copied. Overlay with waveform, timer, where the
  text goes and the words so far (live with the streaming model, phrase by phrase at each pause
  with the others; drag it by its header anywhere inside the pane, it stays there next time,
  the Center button in the header (or a double-click on it) puts it back), a one-line pill in the title bar while its pane is off screen (or always, with Overlay position: Title bar); with no model it offers a choice of three recommended models; Settings > Dictation for the shortcut, mic, limits and history; a mic
  button in the status bar. "Pause music while dictating" (on by default) pauses what is playing
  through the system's Now Playing on macOS (browser tabs included) or MPRIS players through
  playerctl on Linux, and resumes it after; on macOS, "Also control Music and Spotify directly"
  is the fallback that needs Automation access. "Keep recordings for model testing" (off by
  default) saves each dictation's audio and text in `~/.exegol/dictation-audio` for 5 to 30 days
  to compare models offline (`docs/GUIDES/DICTATION_BENCH.md`); also listed in Settings > Storage.
  Cmd+P (Ctrl+Shift+P) or the card's Pause button pauses a dictation and resumes it with the same
  text and target; Settings > Dictation > Input picks the microphone (system default when it is
  missing, said in the card, and again once it is back); its Test button shows a live level for
  15 s. A mic unplugged mid-dictation hands over to the system default without stopping, and a
  dictation that heard nothing says which input to check.
  Settings > Dictation > Vocabulary: terms to recognize as written
  (global plus per project; used by Parakeet TDT v3 as hotwords and Qwen3-ASR in its prompt, other
  models ignore them) and spoken punctuation in Spanish and English ("coma", "punto", "nueva
  línea", "comma", "period", "new line"...). "punto" and "period" count only at the end of a
  sentence; after an article or determiner ("la coma", "a new line") the word stays a word;
  "punto" before a lowercase word stays ("google punto com").
- **Speech models** (Settings > Models): local speech-to-text models for voice dictation,
  downloaded on request into `~/.exegol/models`, resumable and checked against a pinned
  SHA-256. Each lists what it is best for, languages, size and license; a non-commercial model is
  badged and asks before download or set as default. Grouped into Installed (downloads in
  progress too) and a collapsible Available to download; above them a ranking for the dictation
  language by your corrected bench results, else public WER (FLEURS), with speed and source links.
- **Storage** (Settings > Storage): tabs Overview (disk use by kind as a bar and a list, free
  space, open folder, clear screenshots, clear old logs), Speech models (download, set as default,
  delete), Browser (per-project size, clear cache), Worktrees (size, project, branch, dirty or
  clean; cleanup from the Dashboard) and Other (the largest uncounted files and folders, open each).
- **API keys** are encrypted with the system keychain.
- **Updates**: the title-bar button checks GitHub releases, installs the new version and shows
  what's new.
- **Welcome tour** after the first-run setup; reopen it from the command palette.
- **Bug reports**: the bug button collects redacted diagnostics that you review before anything
  is sent.
- **Work guard**: keeps the Mac awake while agents run and asks before quitting with live sessions.
- **Security**: every IPC call goes through an allowlist ([CAPABILITIES.md](../ARCHITECTURE/CAPABILITIES.md)),
  paths and commands from the UI are validated, and the content security policy is strict.
- **Platforms**: macOS (signed and notarized) and Linux (AppImage and `.deb`).
