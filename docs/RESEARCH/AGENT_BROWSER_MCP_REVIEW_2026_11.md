# Agent browser and MCP review (2026-11-06)

Run live as an agent (`browser_*` over the shim, Exegol 0.5.29) against two local lab pages, plus a code read of `main/mcp`, `main/browser` and agent messaging. Compared with the MCP specification 2026-07-28, Playwright MCP and Orca (`src/main/browser`, CDP input).

## Usage so far

33 audited actions in the whole DB, all but one on localhost; `browser_snapshot` and `browser_logs` are not audited. `browser_eval` failed 7 of 7: it is off in all 35 projects and still advertised. 28 agent messages ever, the last in August.

## Why it is unclear to agents

- No `instructions` in the MCP handshake. The only guide is the managed block in AGENTS.md/CLAUDE.md, absent from repos without those files.
- `browser_open` creates a pane, reuses one or navigates, and differs by access mode. `browser_navigate` overlaps it.
- Every action answers the same `status: ok` with url and title, whether or not anything happened.

## Reproduced live

| Finding | Evidence |
|---|---|
| `click` is `el.click()`: no pointer or mouse events | A `pointerdown` menu (Radix, shadcn) stayed closed, tool said ok |
| `type` sets the value: no key events | No `keydown` on the input |
| `submit: true` without a form does nothing | Tool said ok; `browser_press` Enter worked |
| Failed navigation is ok | `chrome-error://chromewebdata/` with status ok |
| One hung subresource blocks everything | `browser_navigate` hit the 30 s shim timeout; `executeJavaScript` waits for the load, so `browser_snapshot` timed out at 10 s |
| Transparent page bodies capture as black | JPEG of a page with no background: black text on black |
| Snapshot misses open shadow DOM, iframes and divs with handlers | `Inside shadow`, `Inside iframe` and the onclick div were not listed |
| Snapshot size | 250 flat elements plus 8 KB of text, about 17 KB; no paging |
| Blocked popup is ok | Tool said ok, only `browser_logs` shows it |

## From the code, not reproduced

- `browser_open` reuses the first pane with no owner check: two agents can drive one pane, and an agent can navigate the user's.
- No `browser_close`, wait, scroll or hover. Panes and floating windows pile up.
- `browser_snapshot`, screenshots and logs are refused while the user has control, though reading harms nothing.
- A page flagged `needs_user` (any `/login` on localhost) turns `isAgentActing` off, so the network guard stops while the agent keeps working on it.
- A docked pane unmounts on a project switch; the agent sees "no pane" (TASK_TODO: main-owned WebContentsView).

## Protocol

- 2026-07-28 removes `initialize`, adds a required `server/discover`, and clients may probe it on stdio; the shim answers -32601.
- The shim echoes any requested protocol version instead of negotiating.
- Tools carry no `title` or `annotations`. Errors lose their JSON-RPC code in the shim.
- Tool order is already deterministic.

## Fixed already

`agent_send` could paste into a shell, and a queue could reach the prompt after a CLI exited (#484). `agents_list` returned 69 rows, about 9 KB, per call (#484).

## Plan

1. Split to under 500 lines per file (this PR).
2. Honest results: load failures, bounded load, what changed after an action, full pointer sequence on click, compact snapshot with shadow DOM and iframes, screenshot background.
3. MCP `instructions`, intent-first descriptions, annotations, `server/discover`, version negotiation, `browser_wait`, scroll, hover.
4. Pane ownership between agents, `browser_close` (closing needs ownership, so it moved here from 3), reads while the user has control, `browser_eval` hidden where off.

Two protocol points stay as they are. Exegol's -32020..-32029 sit in the range the spec reserves, but they are socket codes between shim and server and never reach the MCP wire, so nothing was renumbered. The shim answers a tool error as `isError` content, the form MCP asks for, so keeping the code through it would add nothing an agent reads.

Decision kept for the user: whether `browser_eval` should default to on for local hosts.

## Left for later (found while simplifying the split)

- A read can still raise or clear `needs_user` on a pane another agent holds or the user took over, because `inspect` sets it. It changes an alert, not who drives.
- Floating or docking a pane loses `openedBy` and the lease: they live with the webview, not the pane. The agent then gets `not_yours` on close.
- A write with no `pane` on the only pane open still acts on it, even if the agent never used it. It needs a ref from a snapshot, except `browser_navigate`.
- A running session keeps the tool list it read, so turning `browser_eval` on reaches new sessions only.
- `browser_wait` does not keep `isAgentActing` alive: a wait past 15 s stops auto-closing page dialogs. `noteRead` while polling would fix it, at the cost of a store push each time.
- `browser_wait` polls `innerText` every 200 ms. A MutationObserver would avoid re-reading an unchanged page, but it misses CSS-only changes and must re-arm after a navigation.
- `tools/list` answers `ttlMs: 0` because the list follows the app. A short TTL or `listChanged` would save round trips for clients that honor them; no client's behavior was checked.
- `mcp/exegol-identity.ts` `ancestorPids` forks up to 3 `ps` before any SQL. Asking the DB with `[ppid]` first avoids them for a CLI with no wrapper, but it changes which row wins for a nested agent, so it needs its own change.
- `browser/tool-screenshot.ts` runs about 53 synchronous filesystem calls per capture in the main process. Move to `fs.promises`, create the folder once, prune every Nth capture.
- `browser/tool-handlers.ts` `handleEval` accepts `args.code`, which the schema does not declare. Drop it with the tool description pass.
