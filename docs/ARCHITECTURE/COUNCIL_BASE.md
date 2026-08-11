# Council Base (feature definition)

> Status: DEFINED — 2026-07-28. Agreed by Antonio in workspace-dpeluche session. Companion
> to `OWL_FLEET_WATCH.md`; backs T158 (scope) and T160 in `TASK_TODO.md`. This ABSORBS the
> previously planned standalone "council MCP" project — one server, not two.
> `labs-council` (multi-provider research/deliberation tool) stays as-is; nothing new built there.

## What it is

A per-project execution and exchange base inside Exegol:

1. **Structured executions (the council mode)** — distinct from Exegol's live terminal
   sessions. Antonio (or an agent) passes a prompt + expected structure; Exegol spawns the
   CLI **non-interactively** (`claude -p`, `codex exec`, gemini equivalent), runs it to
   completion headless, and delivers the result into the project's store. The value is
   "define what you want, get the result" — not driving a live session.
   - Cross-family review is ONE preset of this (spawn a different-family agent to review
     what was just built, return discrepancies). It is a preset, not the feature's identity.
2. **Exchange bus** — thread/message/status tools on the same MCP server so session agents
   in different repos (henri front ↔ backend, walter client ↔ cloud) post and read instead
   of Antonio relaying by hand (friction #1 of the jul-2026 conversation audit).

## Architecture requirements

- **The MCP server ships inside the app build and runs as a headless daemon** (launchd,
  same `exegol watch` service as Owl collectors). The Electron window is a view, not the
  runtime — the bus and council must work on days the app is never opened.
- One store: council results, bus threads, and Owl digests share the project-scoped SQLite.
- **Per-project activity view** (UI): for each registered project, surface what's new —
  new threads, council reviews delivered, Owl updates — with the same seen/unseen marks as
  Owl. One feed per project, three producers.

## Trade-off (accepted 2026-07-28)

This couples Antonio's personal workflow infra to a product evolving toward market. Accepted
because: the MCP daemon is a small module, always extractable later, and it removes an
entire second project (council-MCP standalone) from the roadmap.
