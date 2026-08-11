# Owl — Fleet Watch (feature definition)

> Status: DEFINED — 2026-07-28. Agreed by Antonio in workspace-dpeluche session (conversation
> audit → watcher idea → architecture review). This doc is the definition backing tasks
> T156–T159 in `TASK_TODO.md`. Supersedes the "external watcher project" idea: Owl is a
> native Exegol feature, not a separate repo.

## What it is

A background fleet-watch module: Exegol registers repos (same registry as orchestrated
projects), watches them even when no session is open, and surfaces **what Antonio has NOT
seen or reviewed** — real pending state, not just git deltas: stale TASK_TODO entries,
half-finished journals, unattended team PRs, docs whose claims drifted.

Consumers: the Exegol UI (read/review/assign) and any external Claude session via the
existing MCP layer (`main/mcp/`) — e.g. kickoff resume mode reads the digest instead of
re-scanning the repo.

## Why Exegol (and not a new project)

- Repo registry, agent orchestration, SQLite store, FTS5 + Ollama embeddings
  (`nomic-embed-text`), attention monitoring, desktop UI: all already here.
- MCP tools layer already exists (`main/mcp/registry.ts`) — Owl extends it, doesn't build it.
- Only Exegol can close the loop: digest → "launch an agent to do the deep review".
- Salvage source: `_code_/_archive_/labs-cli-proman` (Dev-Agent v1.6) — 28 CLI commands
  (`status`, `git-status`, `wip`, `blocked`, `review`, `next`, `time-status`, `sync-git`...)
  over a global multi-project SQLite. Its WORKSPACE_PLAN.md "Repository Explorer" mock is
  essentially Owl's UI without the autonomous engine.

## Architecture — two-stage, deterministic first

```
scheduler (interval / on-wake)
  → collectors per repo (NO LLM): git/gh deltas, TASK_TODO vs TASK_COMPLETED,
    journal delta, docs freshness, team PRs/comments → facts JSON
  → delta? → small local LLM: notable-or-noise · priority · 1-2 line summary · who cares
  → store (SQLite) with seen/unseen marks per item
  → outputs: UI fleet view · MCP tools (fleet_digest, repo_status, mark_seen) ·
    actions (create task / open session / launch review agent)
```

**Hard rules (agreed):**
1. Collectors are deterministic scripts; the LLM never sees raw diffs — only structured
   facts. A 4B model synthesizing ordered facts is reliable; discovering facts it is not.
2. Owl is **read-only** toward repos. It writes only to its own store.
3. Every digest line carries its verifiable facts (SHA, PR#, timestamp) — a pointer to
   check, never a truth claim.
4. Attention tracking is the product: seen items go quiet, unseen items insist.
   ("Report what you have NOT reviewed" — the core ask.)

## Inference — Ollama first, embedded as the goal

- **Phase A (validate)**: generative small model via Ollama (start: Qwen3 4B; SmolLM3-3B /
  Gemma 3 4B interchangeable), reusing the existing plumbing. Note: the model living in
  Exegol today (`nomic-embed-text`) is EMBEDDINGS-only (search); the Owl model is a second,
  GENERATIVE one. Both roles stay separate, same runtime.
- **Phase B (goal)**: model embedded in-process (node-llama-cpp, or llama.cpp via the
  existing Rust/napi layer). Rationale: Ollama is a shared server (contention with other
  consumers) and unloads models on keep_alive idle — a watcher waking every N minutes pays
  a multi-second reload almost every cycle. Embedded = resident, always warm, app-managed
  download/resources. Cost: ~2.5–3 GB RAM for a 4B Q4, and a mandatory single-flight
  **queue with priorities** (interactive UI > background digest) since llama.cpp serves one
  inference per context.
- **Non-negotiable**: ONE `InferenceProvider` abstraction (`ollama | embedded`) from day
  one — this is T122's abstraction extended, and TERAX review already warned: "write ONE
  abstraction, not 4 cases". Backend swap must be config, not rewrite.

## Build phases (each useful alone)

1. **Collectors + store + raw digest in UI** (no LLM): port cli-proman commands, loop over
   the active repos (start: henri ×2, walter ×2, skysset, dpeluche.dev). Already kills the
   manual "¿qué no he visto?" scan.
2. **Small-model synthesis + seen/unseen**: classification, priority, summaries via
   InferenceProvider (Ollama backend). Model bake-off happens here.
3. **MCP exposure + actions**: `fleet_digest` / `repo_status` / `mark_seen` tools on the
   existing MCP registry; digest actions (create task, open session, launch review agent).
   Embedded backend lands when the feature has proven value.

## Competitive note

Herdr (terminal agent multiplexer, Rust/Ratatui) is Exegol's competitor category — its
per-agent state sidebar is the pattern worth studying for live-session tracking. Owl is the
complement neither has: fleet awareness BETWEEN sessions. (Caveat: herdr.org markets a
separate enterprise product under the same name — verify before citing.)
