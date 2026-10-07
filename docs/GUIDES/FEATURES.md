# Features

Everything Exegol does today, grouped by area. The README lists the highlights; what changed in
each version is in [CHANGELOG.md](../CHANGELOG.md), pending work in [TASK_TODO.md](../TASK_TODO.md).
How it is built: [CLAUDE.md](../../CLAUDE.md).
Keys are written for macOS; on Linux and Windows `Cmd` is `Ctrl+Shift` (see
[KEYBOARD_SHORTCUTS.md](KEYBOARD_SHORTCUTS.md)).

## Workspace

- **Projects**: any folder or git repo. Each one has its own tabs, name, color or icon, and an
  optional keyboard number (Edit project). Projects can be grouped in the sidebar.
- **Tabs and panes**: every project has workspace tabs; a tab splits into panes of five types:
  terminal (an agent CLI or a plain shell), browser, files (explorer + Monaco viewer), git, and an
  empty pane with the agent launcher.
- **Layouts**: six presets (Single, Split Horizontal, Split Vertical, Three Columns, Bottom
  Terminal 70/30, 2×2 Grid), your own saved layouts, and Equalize splits. A project keeps its
  own named layouts (its menu > Layouts...) that start its terminals and agents again. Drag a pane by its left
  edge to move it.
- **Picture-in-Picture**: a terminal or browser pane detaches into a small always-on-top window.
- **Terminal links**: URLs and file paths in any terminal (agents, shells, Dashboard cards) are
  clickable. A URL opens in the tab's link preview pane; a file (`src/app.ts:42:7`, `./a.tsx`,
  `~/notes.md`, absolute) opens read-only over the terminal at its line, images as pictures, PDFs
  in their app. Only files inside the session's project or its worktrees are links. Cmd+click (Ctrl+click on
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
- **Status bar**: widgets you pick in Settings > Status bar (or its gear button), each placed
  left, center or right in your order: project, branch, agents (need you / working / waiting,
  click for the list), plan usage, and opt-in tokens today, resources, CLI and Exegol updates,
  unread alerts, focused session, git state, reconnect progress and a clock.

## Agents

- **14 built-in CLIs**: Claude Code, Codex, Gemini, Antigravity, Devin, Aider, Goose, OpenCode,
  Amp, Kiro, Kilo Code, Crush, Factory Droid and a plain shell, plus your own custom CLI.
  Settings enables, configures or installs each one.
- **Sessions that survive**: terminals run in a detached PTY process, so a reload, a crash or an
  update does not kill your agents; the app reattaches and replays the screen.
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
- **Send to**: select text in one terminal and paste it into another live agent.
- **Follow-ups and Steer**: Queue in the terminal toolbar (and on a Watching card) holds prompts
  for an agent's next turn; each is typed when the turn ends, one per turn. Steer (Claude Code,
  Codex) interrupts the turn (Esc), waits up to 20s for the prompt and types right away. The queue lives in memory: it
  is lost on app quit and dropped when the session ends.
- **Launch options**: model (for CLIs with a model flag) and session name in the launcher.
- **Access modes**: read, write or plan per agent or pipeline step, shown as a badge.
- **Resume**: Claude sessions resume with their session id after a restart.
- **CLI updates**: a session offers Restart to update when its CLI has a newer install, and
  Update when a newer release is out; the conversation resumes on the new version.
- **Terminal or chat view**: switch any agent between the raw terminal and a readable chat.
- **Agent tools (MCP)**: every agent gets an Exegol MCP server: shared memory, project knowledge,
  messages between agents, and file claims so two agents do not edit the same paths.

## Dashboard

- **Fleet** (`Cmd+1`): every live agent across projects with status, uptime, tokens and cost,
  and its message thread with other agents.
- **Watching**: pin sessions to see them as live terminals side by side (one to three columns,
  collapsible, reorderable); type into a card after clicking it.

## Browser and QA

- **Browser pane**: a webview with URL bar and navigation, next to your agents. It remembers
  the page it was on, and can show it at a device size (desktop, laptop, tablet, mobile).
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

## Git and code

- **Smart Git button**: one button that knows the next step (commit, push, create PR, merge PR,
  resolve conflicts), with AI commit messages from the diff (Claude Haiku).
- **Diff viewer**: staged and unstaged, unified or split, with line comments.
- **Worktrees**: an agent can run in its own branch and worktree, cleaned up when it ends.
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
  again to insert, or hold it while you talk; Esc cancels. Transcribed on this machine; the text
  goes only into the focused pane (pasted into a terminal without Enter, a browser page's focused
  field, the code editor's cursor), else it is copied. Overlay with waveform, timer and live words
  for the streaming model; Settings > Dictation for the shortcut, mic, limits and history; a mic
  button in the status bar.
- **Speech models** (Settings > Models): local speech-to-text models for voice dictation,
  downloaded on request into `~/.exegol/models`, resumable and checked against a pinned
  SHA-256. Each lists what it is best for, languages, size and license; a non-commercial model is
  badged and asks before download or set as default.
- **Storage** (Settings > Storage): Exegol's disk use by kind and the free space, with open
  folder, clear screenshots, clear old logs, delete a model and clear a project's browser cache; Worktrees opens the Dashboard.
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
