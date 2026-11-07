# Inbox, messages and knowledge: design (2026-11)

Design for T217, second version, after Antonio's review of the first. Nothing here was built or prototyped. Usage numbers are one person's, read from the live DB on 2026-11-06 as counts only. Estimates are guesses. Section 9 lists the decisions pending.

## 1. The short version

**The project is the address, the link says who may talk, the inbox holds what waits, and the docs keep what stays true.**

- A **link** between two projects says they are related and lets their agents write to each other.
- The **inbox** is the project's message tray: from linked projects, other sessions, or a CLI. Nothing gets pasted into a console.
- A **live message** (`agent_send`) is the same idea with a session present: a review chat between two sessions.
- **Knowledge is not a product.** What is true about a project lives in its docs, and what changed lives in git and PRs. An inbox item that teaches something ends as a change to a doc, in a PR.

The first version proposed a knowledge store with entries, an index and proposals. This one drops it.

```
irma landing's agent finds something the blueprint needs
        │  it knows the link exists, nobody has to ask it
        ▼
  blueprint's inbox  ──waits──>  a session there takes it
                                        │
                     PR on the blueprint, doc updated if it teaches something
                                        │
                     answer back in the landing's inbox
```

## 2. What the numbers say

| Thing | Count |
|---|---|
| Projects, sessions | 35, 405 (319 Claude Code, 21 Devin, 13 Antigravity, 12 Codex, 11 OpenCode, 4 Droid, 25 shells) |
| Exegol memories | **0**, though `memory_save` reaches every MCP session in write mode |
| Projects with `.exegol/knowledge` | **0** found, this repo included |
| Project groups, agent links | **0**, **0** |
| Agent messages | 28, all within 24 h on 2026-08-12, none since |
| Claude Code's own memory notes | 504 |
| Hand-written `BLUEPRINT_FEEDBACK.md` | 3 clones, summarized by hand in the base's `docs/GUIDES/LESSONS_FROM_CLONES.md` |

What this shows:
- Exegol's memory and knowledge are built and unused. Claude's notes exist because it writes them alone. Nothing here tells whether agents would use a tool they were pushed toward, so low use is not proof of no value, but nothing shows a need.
- **The inbox already exists, on paper.** `lizaceves-landing/docs/BLUEPRINT_FEEDBACK.md` opens with "each point goes as an issue" to `landings-base`, which has 3 issues. A clone's agent records what it found, and a person carries it across. That is the workflow to automate, and the reason to build this.

## 3. What outside evidence says

- **Docs handed to every session do not help by themselves.** ETH Zurich's study of `AGENTS.md` (arXiv 2602.11988, v3, September 2026): context files did not generally raise task success and raised inference cost by over 20%, for generated and hand-written files. Instructions were followed; repository overviews did not help. Redundant content was the problem: with docs removed from the repo, generated files helped (DAIR.AI's reading of it). Limit: these are single-repo issue tasks. It says nothing on cross-project work.
- **Plain files hold up against memory tools.** Letta scored 74.0% on LoCoMo with file tools, above Mem0's reported 68.5%. Limit: a vendor's result on a conversation benchmark, and Mem0 reports higher numbers of its own.
- **The cross-agent gap is real, and others are filling it.** `ai-memory` feeds 20+ harnesses one store, because native notes live on one machine and belong to one agent. Its strongest case is handing off a task between CLIs and across machines or a team, which is not Antonio's case today.
- **Memory goes stale.** Per Mem0's survey, one harness validates citations against the current branch and expires memories after 28 days. A store needs that kind of upkeep; docs reviewed in PRs get it for free.
- **Links are an established answer.** `mcp_agent_mail` keeps projects separate, suggests related ones, and still requires an explicit contact approval before agents exchange messages.

## 4. Do we need knowledge? Recommendation: no

Antonio's doubt is right. Four questions, four existing answers:

| Question | Answer lives in |
|---|---|
| How does this project work? | Docs, read on demand |
| What changed lately? | `git log`, PRs, `CHANGELOG`: an agent can check them, and they cannot go stale |
| What rules apply here? | A short `AGENTS.md`: instructions, not overviews |
| What did an agent discover? | A doc or the code, in the same PR |

Claude cannot see Devin's notes, true. But a discovery only one CLI knows is a discovery not yet written down. Sharing the notes treats that symptom; writing it in the repo cures it, and reaches people too.

So:
1. **Polish the skills, as Antonio suggested.** One rule: a finding the code cannot show goes into the docs in the same PR. `doctos` and `standup` carry it. This repo already works that way.
2. **Keep `AGENTS.md` short and made of instructions**, because of the ETH result. Journals and research are read when needed, never loaded at start.
3. **Freeze Exegol's Memory and Knowledge sections.** No new features. Fix the false "automatically extracted" text. Deciding whether to remove them comes later.

What would change this: real teamwork where people lose context the docs do not hold, or handing tasks between CLIs often. Handoff between CLIs is its own small feature if it comes up, not a knowledge base.

## 5. Project links

A project can only write to projects it is linked to.

| Field | Notes |
|---|---|
| `from_project`, `to_project` | Plus `from_repo`, `to_repo`, optional |
| `relation` | Free label: "built from", "uses", "documents" |
| `direction` | One way or both. Default both: answers must get back |
| `note` | What to send through it: what the agent reads |

Repos matter: an Exegol project is often a workspace. "Irma Projects" holds `lizaceves-landing`, and "Blueprints" holds `labs-landings-base`. Linking those two folders is the real relation, and `repo` already travels with GitHub tasks.

Links are made by hand in Edit project. Exegol can suggest some and a person confirms, as `mcp_agent_mail` does: a repo cloned from a blueprint, a `BLUEPRINT_FEEDBACK.md`, or a sibling repo mentioned in docs. Suggestions come after the manual version.

`project_groups` does not fit: a group is for the sidebar and has no direction or note, and it has no rows.

Links gate `inbox_post`. `agent_send` stays as it is for now, unchecked across projects, and should move under the same rule when T221 is built.

## 6. Inbox

The first version's data model holds, with `repo` and without `knowledge_proposal`: table `inbox_items`; `project_id` null means personal; states `open`, `taken`, `done`, `dismissed`; an answer is a new item in the sender's inbox; closed items kept 90 days. No existing table fits: `messages` needs a live agent, attention items live in the renderer, `handoffs` and `task_queue` are unused.

Tools: `inbox_post`, `inbox_list`, `inbox_get`, `inbox_take`, `inbox_close`.

### An agent must know it can write

This is the core of the feature, and the riskiest part. Antonio wants a landing's agent to write to its blueprint without being told, so it has to know the link exists and when to use it.

Ways to tell it:

| Channel | Reaches | Problem |
|---|---|---|
| Spawn context | New sessions with a task | Skipped with no task and on resume |
| MCP `instructions` | MCP sessions | Static in the shim today, and whether each CLI shows them is unverified |
| `inbox_post`'s description | MCP sessions | Claude Code can defer tool schemas, so it may go unread |
| Managed block in `AGENTS.md` | Any CLI | Edits the repo; an Exegol-only fact in a shared file |
| `exegol inbox add` run by the agent | Any CLI with a shell | It still has to know |

Recommendation: spawn context fixed to reach resume and quick launches, plus MCP instructions, then measure across Claude Code, Codex and Devin before building more. The line names the link and its note: "This repo is built from labs-landings-base. Bugs or missing features in the base go there with inbox_post, without asking." Without a test of whether agents really do it, the rest is worth little.

### How it is received

Nothing is pasted. A count on the project's card, and one line with the count when a session opens there. Not a question: no amber dot, like Unread.

### Messages and inbox

| | `agent_send` | Inbox |
|---|---|---|
| Needs a live session | Yes | No |
| Survives a restart | Queue does not | Yes |
| Good for | Review chat between open sessions | Anything that can wait |

Whether they should share one tool, `send(project, session?)`, can wait: the two have different promises, and `agent_send` has no use today to migrate.

### Other developers

A local inbox cannot reach another machine. For a team the transport already exists: GitHub issues, which Exegol's GitHub menu reads. An item gets a "Send as issue" action. Antonio's own feedback file already says each point should become an issue, so this also closes that step. No server needed.

### Ways in

In order: from inside Exegol; `exegol inbox add` for scripts and other CLIs; a deep link that opens a dialog a person confirms, because any web page can fire one; app tokens that can only post. A share from a phone needs something always on, Orbital being the candidate, and comes last. Details as in the first version: no localhost HTTP, and a URL is stored, not fetched.

## 7. Security

An item is text from another agent that a privileged agent will read.
- Links narrow who can write. A page that hijacks one agent reaches only its linked projects.
- Bodies come back marked as data, with the sender shown. Nothing runs by itself: a person or an explicit `inbox_take` starts work.
- Rate limits per sender. Content never reaches logs or bug reports.

Since agents will now post unasked, expect noise. Measure it before loosening anything.

## 8. Plan

| Step | Content | Estimate |
|---|---|---|
| 0 | False UI text; spawn context on resume and quick launch | 1 day |
| 1 | Project links, by hand, in Edit project | 2-3 days |
| 2 | `inbox_items`, tools, sidebar view, count line | 1 week |
| 3 | Tell the agent; **stop and measure on the real Irma and blueprint case** | 2-3 days |
| 4 | Send as issue, `exegol inbox add` | 2-3 days |
| 5 | Deep link, app tokens, suggested links, phone: only if step 3 worked | Unknown |

Outside this repo: the documentation rule in the `doctos` and `standup` skills.

## 9. Decisions for Antonio

1. **Drop the knowledge store and go with docs?** Recommended.
2. **Freeze Memory and Knowledge in the app, or remove them?** Recommended: freeze now, decide later.
3. **Links by project, with an optional repo?** Recommended.
4. **Links in both directions by default?** Recommended, so answers get back.
5. **May an agent post without asking, inside a link?** It is what you described, so recommended, with noise measured at step 3.
6. **Team reach through GitHub issues?** Recommended, instead of a server.

## Sources

- Gloaguen et al., [Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988); Saravia, [DAIR.AI's reading](https://academy.dair.ai/blog/agents-md-evaluation)
- Letta, [Benchmarking AI Agent Memory](https://www.letta.com/blog/benchmarking-ai-agent-memory/)
- [ai-memory](https://github.com/akitaonrails/ai-memory), [mcp_agent_mail](https://github.com/dicklesworthstone/mcp_agent_mail)
- Claude Code, [memory docs](https://code.claude.com/docs/en/memory)
- Mem0, [State of Memory in Agent Harness](https://x.com/mem0ai/article/2061822612398014782): search excerpt only, not read in full
