# Hide compared with Exegol (2026-11)

[with-hide/hide](https://github.com/with-hide/hide), read from a local clone on 2026-11-06. Licence FSL-1.1-ALv2: ideas and designs only, never code. It moves fast, so re-read the repo before citing this.

Hide has no visual office like Company. Its Desk is a chat that hands work to sessions, and its Overview is a map of who launched whom. Per-session view is where Exegol leads.

## Where each one leads

| Topic | Leads | Why |
|---|---|---|
| View of each session | Exegol | Rooms, desks and live activity |
| Hooks isolation | Exegol | `--settings` per agent; Hide edits `~/.claude/settings.json` |
| Agent browser and pinned CI actions | Exegol | Its GitHub actions are pinned by SHA; the browser side was not audited in code |
| Splitting one request across agents | Hide | A chat decides where it goes; Exegol agents cannot launch others |
| Triage | Hide | Needs You, Unread, Working, Seen |
| Summary at the end of a turn | Hide | What it did, why it stopped, what you missed |
| Live sessions across an update | Hide | A small Rust holder per pane, run from a versioned copy outside the app |
| Agents watching agents | Hide | The parent hears when a child stalls; Exegol only tells the user |
| Messages between agents | Hide | No paste over a draft, and proof of delivery |
| Real OS tests | Hide | System tests and an install-and-open package job in CI |
| Electron hardening | Hide | `sandbox: true` and fuses; Exegol has `sandbox: false` in three windows and no fuses |

Not worth copying: one process per pane, remote machines and its 51-job CI are too much for a small team.

## What came of it

| Item | State |
|---|---|
| Ban on macOS-only habits, real OS tests, Linux job | Done, #498 |
| Unread group | Done, #499 |
| Sessions across an update | Part done, #500: a compatible sidecar stays. T219 is open for Windows and forced replacement, waiting on Rigo and Neptali's Windows feedback |
| Draft guard, delivery proof, `watch` role | T221 |
| Install-and-open package in CI | Not on the board |
| Turn-end line | Not on the board |
| PR list by whose move it is | Not on the board |
| `sandbox: true`, fuses | Not on the board |
