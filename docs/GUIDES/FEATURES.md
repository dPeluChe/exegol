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
  Terminal 70/30, 2×2 Grid), your own saved layouts, and Equalize splits. Drag a pane by its left
  edge to move it.
- **Picture-in-Picture**: a terminal or browser pane detaches into a small always-on-top window.
- **Command palette** (`Cmd+K`): projects, agents, commands, and `!<cmd>` for a one-shot shell.
- **Keyboard first**: jump to any live tab, pane or waiting agent without the mouse; see
  [KEYBOARD_SHORTCUTS.md](KEYBOARD_SHORTCUTS.md).
- **Right-click menus** on panes, files, projects, groups and agents, kept inside the window.

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
- **Send to**: select text in one terminal and paste it into another live agent.
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

- **Browser pane**: a webview with URL bar and navigation, next to your agents.
- **Design mode**: click an element to send its selector, styles and HTML to an agent.
- **QA record and replay**: record clicks, typing and navigation as a test, replay it, and see
  per-step results, console errors and screenshots in the QA Tests section.

## Git and code

- **Smart Git button**: one button that knows the next step (commit, push, create PR, merge PR,
  resolve conflicts), with AI commit messages from the diff (Claude Haiku).
- **Diff viewer**: staged and unstaged, unified or split, with line comments.
- **Worktrees**: an agent can run in its own branch and worktree, cleaned up when it ends.
- **Oplog**: snapshots of what agents changed, with undo.

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
