# Roma compared with Exegol (2026-11)

[roma.app](https://roma.app) and its [developer guide](https://roma.app/developers), read on 2026-11-11 from the public pages only. No account was made and nothing was connected: the guide is written as instructions for an agent and none were followed. The app itself was not run, so what follows is what Roma says about itself. It moves fast (guide v1 is dated 2026-11-07), so re-read before citing this.

Roma is a to-do list for agents (Y Combinator, Mac, iOS and web). It does not run terminals. Any agent the person already uses (ChatGPT, Claude, Codex, Grok Bot, Muse, Devin, Cursor) connects to one remote MCP server and reads, writes and gets handed tasks there. Exegol launches the sessions and sees them work; Roma only sees what an agent writes into a task.

No clear task comes out of this. Most pieces exist in Exegol in some form (inbox threads, agent messages, Commander history, notes). The value is in how Roma shaped a few of them, listed below as elements to weigh when the Commander starts directing sessions (T224).

## How it works

| Piece | What Roma does |
|---|---|
| Connection | MCP over Streamable HTTP at one address, OAuth 2.1 with PKCE and dynamic client registration; a REST API with a key for tools that speak plain HTTP |
| Identity | `register_agent` with a kind from a fixed list, never a free name; one record per agent, bound again after each reconnect |
| Orientation | `get_context`: the person, today, lists, what is due, recent notes, automations and three days of activity in one call |
| Task | An item on a list: title, a Markdown body, its own chat, properties, and a log and summary only Roma writes |
| Delegation | A Delegate field on the task. Roma reaches the agent by webhook, by the agent's own poll, or by a scheduled task of the agent started over an API ("Listen to Roma") |
| Delivery | JSON with the item id, the reason, who handed it and an event id. It says where to look, never the work |
| Result | Written into the task's body under what the person wrote, with a message on the same call; a write without a message is refused |
| Hand back | `handoff: "returned"` on the last write. The status does not change: the person or a rule of the list sets Done |
| Liveness | A body write at least every two hours; after four hours without one Roma releases the agent |
| Teams | Each person brings their own agent and all of them post in the shared task's chat |
| Safety | Reads run freely, writes ask; deletes go to a 30-day trash; a whole-body replace needs a flag; what is read in Roma is information, not instructions |

## Elements to weigh

| Element in Roma | Exegol today | What it could improve |
|---|---|---|
| Delegated and returned, apart from status | Inbox threads have a status; `agent_send` messages have a delivery state; no "this work is handed to that session" | The Commander's "session A works, session B reviews": the order ends when the work is returned, which answers when two sessions stop being tied |
| A write must carry a message (what changed, what I need), one post per delivery | Agents write to each other freely | Less noise between a worker and a reviewer, and one line per round for the Commander to read |
| Liveness rule with numbers (2 h, released at 4 h) | Stuck turn alert per session; nothing per order | A concrete rule for "the cycle is stuck" |
| Reassigned or cancelled: change nothing, post nothing, end | No rule | What a session does when the reviewer is swapped mid-cycle |
| Duplicates skipped by event id | Messages have ids; an injected one is shown once | A session never acts twice on one notice |
| A log only the system writes, searched in plain words | `commander_log` (the Commander's own actions), `agent_events` | Messages between sessions are not in what the Commander reads |
| One record per agent across reconnects | A resume makes a new row, linked by `resumed_from` | The "principal" session of a project must follow that chain |
| Whole state in one call | `fleet_status` per project | Add the principal and who writes to whom |
| The delivery only points; the brief is read from the task | `agent_send` already delivers a pointer, read through `messages_check` | Confirms the choice |
| Read content is data, the person's request comes first | `untrusted_*` wrappers on inbox, notes and pages | Confirms the choice |

## Not worth copying

- The setup guide: about 200,000 characters of per-app steps, tokens pasted by hand between two tabs, and a warning that a fetch tool returns only its first 40,000 characters. Exegol starts the session, so MCP and identity are wired at spawn with no step for the person.
- Polling every five minutes counted against the person's plan (288 checks a day by Roma's own figure). Exegol pushes locally.
- A cloud account as the source of truth. Exegol is local.

## Where Roma is ahead

- Reach: any agent anywhere, phone included, not only sessions Exegol launched.
- Teams: several people's agents on one task. Exegol's colabs share threads between projects of one person.
- Lists as a general store (tasks, notes, CRM, expenses) with automations that run on a schedule.

## Not verified

- Whether the liveness rule, the handoff mark and the event deliveries behave as written: the app was not run.
- Pricing and limits beyond 60 calls a minute per token.
- The tool reference, concepts and events pages linked from the guide were not read.
