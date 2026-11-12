# MCP processes per session and the load of a full restart

> Research, 2026-11-12. Feeds T227. Nothing here is implemented. Measured on one machine
> (macOS 15, Apple Silicon, 10 cores, 64 GB) after a reboot that brought back 65 sessions.
> Not measured on Linux or Windows.

## The question

After a reboot Exegol resumed every session. One of them reported "195 zsh, 37 Claude sessions,
38 bun processes and 26 MCP servers, all started at once". Two things to settle:

1. Does Exegol start one MCP server per session, instead of one for the whole app?
2. What makes a full restart heavy, and what can Exegol do about it?

## Short answers

1. **One server, one small bridge per session.** The Exegol MCP server is a single socket in the
   main process. MCP's stdio transport makes every CLI start a command, so each session starts a
   bridge (`exegol-mcp-shim-bin.js`) that forwards to that socket. A bridge holds 17 MB of its
   own memory and starts in under 0.1 s.
2. **The 38 bun processes and the 26 MCP servers are not Exegol's.** They come from the
   person's own Claude Code configuration (two stdio servers registered at user scope,
   so every Claude session in every project starts a copy of each).
3. **Exegol's bridges are 0.8 GB of about 25 GB** under the PTY sidecar. The CLIs themselves are
   the bulk, then the third-party MCP servers (4.9 GB).
4. **The restart was heavy because 65 sessions came back in two minutes**, each Claude session
   starting three to five processes of its own. The stagger limits how many CLIs start at once,
   not what each one starts, and it frees its slot before the CLI's MCP servers are up.

## What happened in the restart

From `exegol.log` and `sidecar.log` (times in UTC):

| Time | Event |
|---|---|
| 18:07:42 | Quit confirmed with 48 open agent sessions, none working |
| 18:08:25 | Sidecar exits on SIGTERM with 75 live sessions (the reboot) |
| 18:09:44 | App starts: `dbInit` 10 ms, `firstPaint` 667 ms |
| 18:09:47 | Sidecar connected empty; 75 sessions marked crashed and offered for auto-resume |
| 18:09:47 to 18:11:53 | Auto-resume: 65 resumed, 0 failed, 2 skipped (no pane), 8 kept suspended (shells idle 5 to 6 days) |
| 18:11:45 | Sidecar trims 8 rings from 8 MB to 2 MB (its own 256 MB ring budget, logged as "memory pressure") |

Resumed: 38 Claude Code, 7 Devin, 2 OpenCode, 1 Codex, 1 Antigravity, 16 shells.

Sessions created by the sidecar per 10 s window, from 18:09:40:
`5, 4, 3, 12, 9, 3, 3, 3, 3, 13, 5, 1, 3`. The windows with 12 and 13 include shells, which the
stagger does not wait for.

Warnings, all between 18:09:50 and 18:12:40, no errors:

- `event loop blocked` for 1.8 s and 2.4 s in the main process
- `[ShellPromotion] Tick failed: process table: timed out`, twice
- `Shell ready marker timed out`, 13 shells, 11 of them within the same second (18:11:34)

The 1 minute load average 17 minutes after the restart was still 14.9, and the 15 minute one
136 on 10 cores. That number includes everything the reboot started (login items, other apps),
so it cannot be attributed to Exegol alone.

## What runs under the sidecar

Census about 25 minutes after the restart. "Own memory" is the physical footprint from
`footprint <pid>` (what the process would give back if it exited). RSS is shown because it is
what `ps` and Activity Monitor's default view report, and it counts shared pages in every
process that maps them.

| Process | Count | Own memory, total | Own memory, each | RSS, total |
|---|---|---|---|---|
| Claude Code CLI | 38 | 7,085 MB | 186 MB | 12,631 MB |
| Devin (CLI and helpers) | 32 | 1,342 MB | 42 MB | 2,144 MB |
| MCP server run from source with bun | 38 | 2,327 MB | 61 MB | 2,257 MB |
| npm MCP server A (`npm exec` wrapper) | 7 | 1,064 MB | 152 MB | 1,774 MB |
| npm MCP server A (node) | 7 | 314 MB | 45 MB | 522 MB |
| npm MCP server B | 14 | 727 MB | 52 MB | 1,227 MB |
| `uvx` MCP servers | 8 | 338 MB | 42 MB | 346 MB |
| Native MCP binary of a desktop app | 28 | 125 MB | 4.5 MB | 162 MB |
| **Exegol MCP bridge** | **49** | **816 MB** | **16.7 MB** | **2,467 MB** |
| Exegol sidecar | 1 | 71 MB | | 82 MB |
| Exegol main process | 1 | 149 MB | | 277 MB |

Reading it:

- The bridge's RSS (50 MB each) is three times its own memory. The difference is the Electron
  framework's code pages, mapped by every bridge and counted once per process by RSS. A first
  reading of `ps` gave 2.5 GB for the bridges; the real cost is 0.8 GB.
- Third-party MCP servers hold 4.9 GB in 102 processes. The bun server alone is 2.3 GB.
- The two npm servers run under the Devin sessions (two processes each per
  session), not under Claude.
- 47 CLIs own the 49 bridges: one per session, plus a second one under one Claude session and
  under the shared `opencode serve` process (one per OpenCode session).

Where the third-party servers come from (the Claude Code user config, scope and transport only):

| Server | Scope | Transport | Processes per Claude session |
|---|---|---|---|
| bun server run from source | user | stdio | 1 |
| native binary of a desktop app | user | stdio | 1 |
| 7 others at user scope | user | HTTP | 0 |
| 3 at project scope | local | stdio | 1, only in that project |

A user-scope stdio server is started by every Claude session in every project, whether the
project uses it or not. The HTTP ones start nothing.

## How Exegol's MCP works today

- **Server** (`mcp/exegol-server.ts`): one listener in the main process on
  `~/.exegol/mcp-server.sock`, mode 0600 (a per-user named pipe on Windows). Newline JSON-RPC
  with four methods: `list_tools`, `session_context`, `check_path`, `call_tool`.
- **Identity**: a token minted per agent at spawn. Access mode is read from the database on
  every call. Claude Code gets the token in its own config file
  (`~/.exegol/mcp/<agentId>.json`, passed with `--mcp-config`); Codex gets it in the session's
  environment. The other CLIs read a project file, so two sessions in one folder share a token,
  and the server tells them apart by the bridge's parent process chain (`exegol-identity.ts`).
- **Bridge** (`mcp/exegol-mcp-shim-bin.ts`, 385 lines): the process the CLI starts. Besides
  forwarding, it:
  - answers `initialize`, `server/discover` and `ping` itself, for both protocol eras
  - answers `tools/list` from its bundle when the app is not running, so the CLI's startup never
    waits on Exegol
  - reconnects to the socket forever with backoff, so it survives an app restart or update, and
    tells the agent whether a call that failed had reached the app or not
  - reads a new token from disk when the app re-armed it
  - sends its parent pid, the disambiguator above
- **Runtime**: the bridge runs on the app's own binary with `ELECTRON_RUN_AS_NODE=1`
  (`system/node-launch.ts`), because Exegol cannot assume Node is installed.
- **Claim guard** (`mcp/exegol-claim-guard-bin.ts`): a Claude Code `PreToolUse` hook on
  `Edit|Write|MultiEdit|NotebookEdit`, also on the app's binary. One process per file write, in
  sessions that share a tree.

Start cost of that runtime, empty script, 5 runs each, same machine under the same load:

| Runtime | Wall | CPU (user + sys) |
|---|---|---|
| Exegol binary as Node | 0.08 s | 0.07 s |
| Node 26 | 0.05 s | 0.05 s |
| Bun 1.2 | 0.01 s | under 0.01 s |
| `/bin/sh` | under 0.01 s | under 0.01 s |

This times the runtime, not the bridge's own bundle, which was not measured apart.

## Why the stagger did not hold the load down

`useAutoResumeLost` resumes 3 sessions at a time (`AUTO_RESUME_CONCURRENCY`). A slot is freed
when the CLI reaches `waiting_input` or `idle`, or after 10 s (`settled`, in
`hooks/use-resume-agent.ts`). Three things follow:

1. **Shells do not wait.** `settled` returns at once for a shell, so 16 shells went through as
   fast as the three workers reached them, each running an interactive `zsh` with the person's
   startup files. That is the 12 and 13 in the timeline, and likely the 11 shell-ready timeouts
   in one second.
2. **"At its prompt" comes before the session's MCP servers are up.** 49 CLIs took about 120 s.
   At a full 10 s per slot they would have taken about 160 s, so slots were freed early, while
   each CLI was still starting its servers.
3. **The limit counts CLIs, not processes.** A Claude session here starts the CLI, the bridge,
   the two user-scope servers and the project's own: four to six processes for one slot. The
   comment that set the limit (36 CLIs took memory from 11.2 to 15 GB) predates this many
   servers per session.

## Options

### A. Exegol's MCP over HTTP on loopback, no bridge

The spec's other transport is Streamable HTTP: the server is its own process and clients post
to a URL. What the CLIs accept, from their documentation (read 2026-11-12, none tried here):

| CLI | HTTP server in config | Token |
|---|---|---|
| Claude Code | `"type": "http"`, `url`, `headers` | `headers`, with `${VAR}` expansion, or `headersHelper` |
| Codex | `url` in `config.toml` | `bearer_token_env_var`, `env_http_headers` |
| Gemini CLI | `httpUrl`, `headers` | static header |
| OpenCode | `"type": "remote"`, `url`, `headers` | header, `{env:NAME}` |
| Devin | HTTP documented for the cloud product | local CLI file not verified |
| Antigravity | not verified | not verified |

What it would save: the bridges of the CLIs that carry a token per session. Claude Code and
Codex are 39 of the 49, about 650 MB of own memory at this session count, and one process
start of 0.08 s each. The CLIs that share a token per folder cannot move: without a bridge
there is no parent pid to tell two sessions apart.

What it would cost:

- **A wider door.** The socket is a file only this user can open. A loopback port is reachable
  by every local user and by any web page that can make a request to `127.0.0.1`, including the
  pages in Exegol's own browser panes. The spec requires validating `Origin` (403 when invalid)
  and asks for binding to 127.0.0.1 and authentication. The token would be the only gate where
  today there are two.
- **A port to manage.** Configs outlive a launch, so the port must be fixed or every config
  rewritten at start, and a running session keeps the old URL.
- **Weaker survival of an app restart.** The bridge reconnects forever. Claude Code retries a
  dropped remote server five times with a doubling delay from 1 s, then marks it failed until
  someone reconnects it in `/mcp`. An update or a restart that takes longer than that leaves
  sessions without Exegol's tools.
- **No offline answer.** Today a CLI started with Exegol closed still lists the tools and gets
  a clear "the app is not running" on a call. Over HTTP it gets a connection error at startup.
- A second server implementation to keep in step with the socket one, which the remaining CLIs
  and the claim guard still need.

Verdict: 650 MB of about 25 GB (2.6%), paid with a security review and two regressions.

### B. A native bridge

Replace the JavaScript bridge with a small compiled binary (Rust, built with the app). It would
forward bytes between stdio and the socket and keep the reconnect and the token re-read; the
handshake and the tool list can come from the main process, with a short built-in answer when
the app is closed.

- Saves most of the 17 MB per session (the own memory of a small native process is around
  1 to 2 MB; an estimate, not measured) and brings the start under 10 ms.
- The same binary can serve as the claim guard, where the start cost is paid on every file
  write.
- Costs: a second implementation of the handshake rules, one more binary to build, sign and
  notarize per platform, and the app-relocation paths that name it.

Verdict: about 0.75 GB at 49 sessions and a faster guard. Worth doing when the guard's cost
shows up, not urgent on memory alone.

### C. A restart that brings back less at once

- **C1. Free a slot when the session is really up.** Wait for the bridge to connect
  (`mcp:status`) and a short quiet period, not only for the prompt. Shells take a slot for a
  moment too. Small change in `settled`.
- **C2. Follow the machine.** Before each resume, read the load (`os.loadavg()` against the core
  count) and hold while it is above a limit, with a cap on the wait. Slower on a loaded
  machine, same as today on a free one.
- **C3. Resume what is on screen, the rest on demand.** At restart only the sessions in the
  visible tabs, the pinned ones and the Commander come back. The others stay suspended with
  their pane showing "Resume", and resume when their tab is shown, when a message arrives for
  them, or all at once from one button. This is the 3 day rule that exists today, extended
  from "old sessions" to "sessions nobody is looking at".
  - Largest effect: a restart starts a handful of sessions, not 65.
  - Changes what "everything came back" means: a background session cannot receive
    `agent_send` or be read by the Commander until something resumes it.

### D. Third-party servers per session

These are the person's configuration, so Exegol can inform and offer a switch, not decide.

- **D1. Scope.** Move the two user-scope stdio servers to the projects that use them.
  No code. At this session count that removes most of 2.4 GB.
- **D2. One process for the bun server.** If it served MCP over HTTP from one long-lived
  process, every session would connect to it and start nothing. See the last section.
- **D3. A per-project "only these servers" switch in Exegol.** Claude Code's
  `--strict-mcp-config` loads only what `--mcp-config` names. Exegol passes its own config
  already and leaves the flag off on purpose (`agent-spawn-flow.ts`, "the user's own servers
  still load"). A project setting could turn it on with a chosen list.
- **D4. Show it.** A per-session count and memory of the processes it started, MCP servers
  named, in Monitor > Resources. Not checked how much of this Resources already shows.

## Recommendation

1. **C1 now**, small and safe, and **decide on C3**: it is the one that changes what a restart
   costs, and it changes behaviour, so it is a product decision.
2. **D1 today** (configuration), **D2 as a request** to that server's developer, **D3/D4** as one
   task if the per-project switch is wanted.
3. **B** together with the claim guard, when there is a reason beyond memory.
4. **Not A.** The saving is small and it trades a file socket for a port.

## Decisions asked of Antonio

| # | Decision | Default if none |
|---|---|---|
| 1 | C3: restart resumes only what is on screen, the rest on demand? | Keep resuming everything |
| 2 | C1 and C2: go ahead as one small task? | C1 only |
| 3 | D3: a per-project switch that limits a session's MCP servers? | Not built |
| 4 | D4: per-session process and memory view? | Not built |
| 5 | B: native bridge and guard? | Parked |
| 6 | A: HTTP transport? | Not done |

## What a per-session stdio server can do

For the author of any MCP server that a CLI starts once per session (the bun server above is
the example: 38 copies, 61 MB each, all started within two minutes):

1. Serve Streamable HTTP from one long-lived process (bound to 127.0.0.1, with a token), so
   sessions connect to a URL and start nothing.
2. If stdio stays, load nothing until the first tool call (database, indexes, project scan).
3. Exit when stdin closes, so no copy outlives its session.
4. Ship a built entry point, so N starts do not transpile the source N times.
5. Register per project where only some projects use it.

## Not measured

- CPU per process during the burst; only counts, timing and memory after it.
- The bridge's start with its real bundle; only the runtime with an empty script.
- Anything on Linux or Windows.
- HTTP transport was read in the documentation, not tried with any CLI.
- Whether the second bridge under one Claude session is a subagent or a reconnect.
- The own memory of a native bridge is an estimate.

## Sources

- Local: `~/.exegol/logs/exegol.log`, `sidecar.log`; `ps`, `footprint`, `/usr/bin/time` on
  2026-11-12; the Claude Code user config (scope and transport only).
- Code: `mcp/exegol-server.ts`, `mcp/exegol-mcp-shim-bin.ts`, `mcp/exegol-mcp-config.ts`,
  `mcp/exegol-identity.ts`, `agents/spawn-env.ts`, `agents/agent-spawn-flow.ts`,
  `system/node-launch.ts`, `renderer/lib/auto-resume.ts`, `renderer/hooks/use-resume-agent.ts`.
- MCP specification 2025-11-25, Transports: <https://modelcontextprotocol.io/specification/2025-11-25/basic/transports>
- Claude Code, MCP: <https://code.claude.com/docs/en/mcp>
- Codex, MCP: <https://developers.openai.com/codex/mcp>
- Gemini CLI, MCP servers: <https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html>
- OpenCode, MCP servers: <https://opencode.ai/docs/mcp-servers/>
- Devin, MCP: <https://docs.devin.ai/work-with-devin/mcp>
