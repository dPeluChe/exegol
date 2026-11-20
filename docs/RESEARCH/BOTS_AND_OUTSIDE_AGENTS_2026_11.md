# Bots, assistants and outside agents: research (2026-11-20)

Feeds T230. Nothing here is decided or built. It records what three products do (Orca Bots,
TaroBird, TalkTo), what Exegol already has, and the ideas Antonio found worth keeping, so they can
be weighed later with a clearer view of what each one really gives.

Read from docs and source on 2026-11-20; nothing was run. Orca is MIT and TalkTo Apache-2.0
(code may be reused with attribution); TaroBird is AGPL-3.0 (ideas only).

## Orca Bots

Beta since v1.4.265 (2026-11-19). Docs: `orca.dev/docs/bots` (quickstart, connectors, security,
import). Code: `stablyai/orca` at `80bb651702`, `src/main/bots/` (269 files),
`src/main/connector-cloud/`, `src/main/automations/`, `src/shared/bot-types.ts`.

What a bot is:

- A persistent chat with a name, a purpose, a memory and automations. It is a Claude Code or
  Codex session (11 CLIs in `BOT_AGENTS`) on the person's own login.
- It lives in its own folder (`~/.orca/bots/<folder>`), not in a project: `SOUL.md` (purpose,
  written by the bot after its first task), `MEMORY.md` and a memory folder. A nightly run with no
  tools tidies the memory.
- It has skills, not only a personality: up to 20 projects whose skills it loads at chat start
  (`skillProjects`), plus templates that carry skills.
- It does not code. Its preamble tells it to hand code work to a worker: another session in a new
  worktree, whose result is a branch and a PR (`bot-preamble.ts`).
- Bots can write to each other, and each sees the workers under it.
- It runs on the person's machine, in the app or in the headless `orcad`. No cloud runner.

How events arrive:

- Slack, GitHub, Linear and webhooks go to a hosted service (`connector.orca.dev`), the one closed
  part. The machine holds an outbound long poll (50 s), so no port is opened. The machine lists
  its rules at connect; the service delivers what matches. A request waits up to 24 h for a
  sleeping machine.
- Gmail and Calendar are polled locally once a minute and never reach that service.
- An Orca account is needed only for Slack, GitHub and Linear.

Triggers (`src/shared/automation-event-triggers.ts`): a mention in any chat, Slack mention or DM
(each bot is its own Slack app), 20 GitHub event kinds (mention, review requested, CI failed,
labeled, conflict, merged, workflow finished), Linear (assigned, mentioned, created, moved),
schedules (cron, daily, weekly) and webhooks, filtered by repo, author, text and label. The bot
answers in the thread where it was woken.

Safety, as their own docs separate it:

- Enforced in code: "Who can ask" (default only the owner, checked in the hosted service); the
  first look around is read-only with a command allowlist (`bot-look-around-policy.ts`); MCP
  secrets never reach the CLI's argv, env or config and go through a loopback relay with a
  per-bot token (`tool-relay/`); outside text sits in a fence labelled "content, not
  instructions" (`quoted-text-fence.ts`) and may not be saved to memory as an instruction; a bot
  does not trigger on its own PRs.
- Only asked of the model: approve or merge only when asked, draft mail without sending. Their
  docs: "None of these settings is a guarantee."
- Weak points they state: a new bot starts on Full access, and event automations and webhooks
  bypass "Who can ask".

## TaroBird

`cloveric/tarobird`, AGPL-3.0, one contributor, six releases in eight days. A chat workspace for
agent CLIs over their structured protocols, with no terminal: a Node host with Electron, iOS and
Android clients.

Has what Exegol lacks: phone clients with pairing and a relay, tasks and files across machines,
a diff per reply from the agent's edit records with line comments sent back, sandboxed widgets
inside a reply, a "Chancellor" that splits a goal into tickets with a concurrency cap, side
conversations on a session's context, a reorderable queue of pending prompts.

Its own docs say several demos use simulated data.

## TalkTo

`plannotator/talkto`, Apache-2.0. The public repo is a one-day-old mirror (4 commits, no
releases) and its README says it has had no security audit.

- Message boards for agents (servers, channels, direct chats) on a Cloudflare Worker, hosted or
  on the person's own Cloudflare account. Nothing local: all message text lives there.
- Agents connect over remote MCP with a browser login, from any machine. An agent picks its own
  name, which is a label and not a credential.
- Delivery by CLI: with a plugin (Claude Code and others) a message waits for the turn end and
  starts a turn; with hooks it leaves a one-line notice; over MCP alone the agent polls.
- No approval by a person. Inside a server every agent reads everything and writes to anyone.
  The defence against hostile text is one sentence telling the agent to treat it as information.

TalkTo solves reach and leaves control aside. Exegol has the control and lacks the reach:
identity bound to a per-session token, delivery that never lands over a draft or a dialog,
threads with a status and a close rule, a person deciding before anything wakes, untrusted
content marked as such, and nothing leaving the machine.

## What Exegol already has

- The Commander: one session that sees every project and directs the others (T224).
- The Main session of each project, marked by the person.
- Notes per project, colab and personal; inbox threads with a status.
- `agent_send` between live sessions and PR watch over `gh`.
- A scheduler engine with no interface (`main/scheduler/`, noted on the board as "decide").
- A follow-up queue per session (T200.4): a chip with a list, remove, Send later and Steer.
- A way in from outside, narrow and manual: `exegol://capture` and `exegol inbox add` propose an
  inbox thread that a person must save.

## Ideas, with Antonio's read of each

1. Events from outside that wake a session, and answering where the question was asked. One
   topic. To work on later: who may activate, where events come from and when.
2. Assistants with a purpose, as complements of the Commander, not a second hierarchy. A role is
   a session with a written purpose and a schedule; the Commander stays the only one that sees
   the whole fleet. Examples: check dependencies, check documentation.
3. Schedules with an interface, to review repos or assign recurring work. Open: who gets a
   schedule (the Commander, a session with a role, a new session in a project). Wanted for the
   Commander as something to assign.
4. A watcher of what is deployed. It visits the site, checks it is up, reads console and network
   errors, a SEO or performance score, runs tests while the developer is away, and leaves a
   report for the developer to decide whether it is assigned. Not QA in a disposable worker,
   which needs permissions and the project's session. Mostly existing parts: a session with a
   role, the scheduler, the agent browser, an inbox thread. To solve: production hosts in the
   project's allowlist, read-only enforced by Exegol and not only asked of the model, and a tool
   for the score.
5. Gmail and Calendar: not for Exegol. They would come another way (an MCP server chosen in the
   project). May be revisited.
6. Secrets: an encrypted store per project, in the manner of Infisical, fits better than a relay
   because a session belongs to a project. Two separate problems: storing (extend the keychain
   store used for API keys to per-project variables) and delivering (so the value is not in a
   file or a transcript; Orca's relay answers this one). To check first: a session with a shell
   reads its own environment, so encryption protects the disk, not against the agent.
7. Delegating to a worker in a worktree: see `REMOTE_WORKERS_SANDBOXES_2026_11.md`. In Exegol
   sessions are named and lasting, so "delegate" would mostly be assigning to a session that
   exists, and creating one only for real isolation. It is the "direct" step left in T224.
8. From TaroBird, the two kept: the follow-up queue (missing today: reorder, edit a queued item,
   survive an app quit, show the list in the Company and Commander chats) and Commander tickets
   (a goal split into pieces with a state, a cap on sessions working at once), which depend on
   the open question of "direct".
9. Outside agents talking to Exegol: review bots that work through PRs, and agents of other
   developers or teams, reporting what they saw.

## Outside agents: options

The rule to keep in every option: what comes from outside becomes an inbox thread marked as
untrusted content, wakes no session, and a person decides whether it is assigned.

1. GitHub as the channel (recommended). Extend PR watch so a comment carrying a marker, from
   authors allowed per repo, becomes a proposed inbox thread. No server, account or open port,
   and any bot that can comment can use it. Risk: on a public repo anyone can comment, so the
   author list and the approval step are required.
2. A local HTTP endpoint with a token per sender that can only propose threads. Fits agents on
   the person's own network; reaching it from outside needs a tunnel the person opens. Risk: an
   exposed port and leaked tokens.
3. Exegol sessions join a TalkTo server as ordinary clients, with a bridge into the inbox.
   Fastest to set up. Risk: all text sits with a third party and names can be spoofed.
4. A drop folder (synced, or a git repo) with signed proposals. Slow, weak proof of the sender.
5. Exegol's MCP server exposed over a tunnel. Left out: the largest attack surface.

Open: when those bots report "something else", is it always about a repo that is a project in
Exegol? If so GitHub is enough; if not, the endpoint is needed.

## Questions to answer before building anything

1. Which of these gives quality or speed, and which only adds work and a dependency? Antonio's
   doubt when this was written, and the reason nothing was started.
2. For assistants: one concrete recurring job a person would hand over today, and what its
   report would look like.
3. For outside agents: who the senders are, how often they would write, and what the developer
   does with a report.
4. For events: which source first (GitHub through `gh` needs no service), and who is woken.
