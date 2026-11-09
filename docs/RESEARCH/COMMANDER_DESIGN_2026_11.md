# Commander: one conversation about every session (T224)

**Date**: 2026-11-09 | **Status**: phases 1-3 built, phases 4-5 planned | **Source**: Antonio

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
- Every change it makes, and every refusal, is a row in `commander_log` that is never pruned: the person reads it under History, the Commander with `my_history`.

## Phases

| Phase | Content | State |
|---|---|---|
| 1 | Project, brief, role, tools, Dashboard tab, start and resume | Built |
| 2 | Feed: turn ends, sessions that wait on the person, closed sessions, stuck turns and new inbox threads reach it as one message while it is at its prompt, at most one per 2 minutes and 10 an hour, so it reports without being asked. `session_restart` moves a session onto a newer installed CLI | Built |
| 3 | It calls the person: `alert_person` plays a chime and shows a notice and a toast, once a minute at most. Its chat in a floating always-on-top window. A history of what it did, kept for good (`my_history`, History) | Built |
| 4 | Voice (T222): its replies read aloud. Kokoro first, see below | Planned, research first |
| 5 | Retry after an API or network error (T218), through the Commander's rules | Planned |

## Voice engines (phase 4, read 2026-11-09)

Everything here is from each vendor's own page; nothing was listened to.

| Engine | Size | Spanish | Licence | Runtime |
|---|---|---|---|---|
| Kokoro 82M | 327 MB | Yes | Apache-2.0 | sherpa-onnx, already in the app |
| Phonon 40m-es (Gradium) | 74.6 MB | Yes (Spain) | CC BY-NC 4.0 | its own (`ptts`: Rust, C, npm), GGUF weights, files behind a Hugging Face login |
| Supertonic 3 (Supertone) | 398 MB | Yes, 31 languages | OpenRAIL-M | ONNX Runtime; sherpa-onnx support not checked |
| Phonon 31m-en | 64.5 MB | No | Apache-2.0 | its own |
| Woof (ConwayResearch/Underdog-Woof) | 31.7 MB one voice, 40.6 MB two | No | Underdog Non-Commercial License 1.0, credit "Voice by Underdog Woof" shown in the app | Python with numpy (`woof_int8.npz`), no ONNX file |

- Woof is the smallest and leads its own table (English, Gradium's hard cases), but it is
  English only, non-commercial with a mandatory credit, and has no runtime the app can load.
  Out for a Commander that speaks Spanish.
- Phonon 40m-es beats Kokoro in Gradium's own blind test in Spanish (Elo 2103 against 1629).
  Its licence allows only a person's own non-commercial download, never a bundle.
- Kokoro is the only one with Spanish, a free licence and no new dependency: the first engine,
  as a model downloaded from Settings > Models. The engine stays swappable.
- Before building: the same Spanish sentence through Kokoro and Supertonic 3 for Antonio to hear.

## Open

- The feed's window (2 minutes), cap (10 an hour) and what counts as worth a wake, measured on real days.
- Whether the Commander's project should stay out of Company and the project lists.
