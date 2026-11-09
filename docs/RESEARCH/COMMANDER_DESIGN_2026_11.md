# Commander: one conversation about every session (T224)

**Date**: 2026-11-09 | **Status**: phase 1 built, phases 2-4 planned | **Source**: Antonio

## What it is

One conversation with Exegol about every other session. The Commander reports what needs the
person, what finished and what is stuck; hands the person's requests to the right session; answers
a session's question when it is sure; and keeps notes of what was decided.

## Decisions (Antonio, 2026-11-09)

- It answers a session's text question when sure, and asks the person otherwise. A setting turns
  that into "asks me first". It never answers a tool permission or a dialog.
- It can add projects, inbox threads, notes, and messages to sessions (which are the tasks, as the
  person would ask them).
- It has its own notes, and writes notes about the last work done.
- Its CLI and model are picked at start: Claude Code first, any CLI that takes a prompt.
- It can put a finished session away (suspend) and restart one to update its CLI.
- Voice: it makes a sound, the person comes to listen in the same chat or in a floating window.
- The system right click and the browser extension for capture wait (T217 step 7, part 2).

## Shape

The Commander is an ordinary agent session, not a new runtime. That reuses spawn, resume, the
sidecar, the chat view, the MCP server and the message queue, and lets anyone run it on the CLI
they already pay for.

| Piece | Where | Why |
|---|---|---|
| Its project | A project row named Commander on `~/.exegol/commander`, id in setting `commander_project_id` | A session needs a project; its notes folder, inbox and pane come for free |
| Its brief | `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` in that folder, rewritten on every start, plus one line in the MCP handshake | Works on any CLI; the rules are Exegol's, not the model's memory |
| Its role | `isCommander`: the caller's project is the Commander's, read from the DB per call | A session cannot claim it; no token or env carries it |
| Its tools | `fleet_status`, `session_read`, `session_suspend`, `project_add`; a `project` argument on the inbox and note tools | Listed and answered only for its session |
| Its view | Dashboard > Commander: start card (CLI, model, how it answers), then its chat or terminal | One place to talk to it; the session also has a normal pane |

## What it reads

Signals Exegol already has, never every terminal: session state from the DB, `needsUser` (a hook
approval or a dialog on screen), minutes in state and quiet minutes, inbox counts. `session_read`
returns the last turns of one session (text only, 2,000 characters each, 12 at most) under
`untrusted_session_content`, when it decides to look.

## Limits held by code, not by the prompt

- A message never lands on a dialog: `agent_send` waits for a turn boundary and `needsUser` holds it.
- "Asks me first" refuses the Commander's `agent_send`.
- `session_suspend` takes only a session at its prompt, never one working or waiting on the person.
- `project_add` takes an existing git folder; nothing is created or initialised.
- Session, thread and note text reach it marked as data.

## Phases

| Phase | Content | State |
|---|---|---|
| 1 | Project, brief, role, tools, Dashboard tab, start and resume | Built |
| 2 | Feed: attention items, stuck turns, turn ends and new inbox threads reach it as one digest per quiet window, so it reports without being asked. Restart a session to update its CLI | Planned |
| 3 | It calls the person: a sound and a desktop notice from `alert_person`; a floating window with its chat | Planned |
| 4 | Voice (T222): its replies read aloud. Engines to weigh: Kokoro, Phonon, Woof (underdog.ai) | Planned, research first |
| 5 | Retry after an API or network error (T218), through the Commander's rules | Planned |

## Voice engines (phase 4, read 2026-11-09)

Woof (underdog.ai/woof, the vendor's own page and numbers): one voice in 31.7 MB or two in
40.6 MB, 24 kHz, about 18x real time on one CPU thread, its own text normalizer for numbers,
dates and codes. Against it for Exegol: the licence is CC BY-NC 4.0, so like Phonon 40m it could
only be the person's own download, marked non-commercial, never bundled; the page shows English
only, and Antonio works in Spanish; it ships as Python with numpy or PyTorch, and as a browser
build, with no ONNX or sherpa-onnx file named, so a runtime would have to be found or written.
Kokoro (Apache-2.0, Spanish, already loadable through sherpa-onnx in the app) stays the first
engine to try; Woof is worth a listen for English once a runtime exists.

## Open

- The digest's window and what counts as worth a wake, measured on real days before tuning.
- Whether the Commander's project should stay out of Company and the project lists.
