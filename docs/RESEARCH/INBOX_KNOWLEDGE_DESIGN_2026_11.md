# Inbox and knowledge: design (2026-11)

Design for T217, written before any code. Facts come from reading `main` at 07da04f2; nothing here was run or prototyped. Estimates are guesses. Section 9 lists the decisions that are Antonio's to make.

## 1. The idea in one page

Three needs are mixed in T217. They have different lifetimes, so they should stay different things:

| Thing | Question it answers | Lifetime | Today |
|---|---|---|---|
| Messages | "Are you there right now?" | Minutes, needs a live session | `agent_send` |
| Inbox | "What is waiting for someone?" | Until someone closes it | Does not exist |
| Knowledge | "What is true here?" | Until it stops being true | Half built |

The inbox is the door and knowledge is the shelf. Anything arriving from an agent, another project or another app lands in an inbox. Triage then turns it into work, a knowledge entry, an answer, or nothing.

```
agent of any project ─┐                       ┌─> a session takes it and works on it
you, in the app ──────┼─> inbox ─> triage ────┼─> knowledge entry (reviewed)
other apps, CLI ──────┘   (waits, never       ├─> an answer, back to the sender's inbox
                           injected)          └─> dismissed
```

This also settles the agent-writes-knowledge problem: an agent proposes an update, and the proposal is an inbox item. Knowledge stays curated without a second review mechanism.

## 2. What exists today

**Reusable**
- `.exegol/knowledge/`: `PROJECT.md`, `DIGEST.md`, `MEMORY.md`, the managed block, and a pointer list at spawn (`knowledge/context.ts`).
- `memories` with salience, reinforcement and hybrid recall (`memory/store.ts`).
- The MCP server's identity model: per-agent token, project and access mode derived on the server.
- Agent-message framing: no authority, control characters stripped (`agent-message-injection.ts`).
- `project_groups`: a ready boundary for who may read whom.

**Not reusable**
- `messages`: tied to agents, no project column, no target when a session is gone. A send to a dead agent is refused.
- Attention items: renderer localStorage, one per agent, status rather than content.
- `handoffs`: no SQL touches it. `task_queue`: nothing inserts in practice. `activities`: a log with no read state.
- `markdown-tasks.ts`: line-based ids, no agent write path. An inbox item can create a task, not be one.

So the inbox needs its own table. T217 said agents cannot consult knowledge; the real gap is narrower: they can read it and save memories, but have no tool to write knowledge, cannot reach another project's, and nothing exists above project level.

## 3. Small fixes worth doing first

Found during this review. All are independent of the design.

| Problem | Where |
|---|---|
| The extractor is not wired, yet the UI says memories are "automatically extracted" | `extractor.ts:167`, `MemorySection.tsx:125` |
| `memory_search` is keyword-only though described as hybrid: no Ollama config passed | `exegol-tools.ts:68` |
| `knowledge_get` reads `project.path`, not the agent's worktree | `exegol-tools.ts:134` |
| Spawn context is skipped with no task and on resume, while `access_count` still rises | `spawn-context.ts:142`, `agent-spawn-flow.ts:366` |
| The managed block tells a plain CLI about MCP tools it does not have | `managed-block.ts` |
| `messages_check` returns messages already delivered inline: only it sets `read_at` | `agent-messaging.ts:154` |
| Re-importing `MEMORY.md` inflates reinforcement | `memory-bridge.ts:112` |
| A malformed deep link is logged raw; capture links would carry content | `bootstrap/deep-link.ts:21` |
| The sidecar socket has no `chmod` as the MCP one does. To verify: `~/.exegol` permissions may already cover it | `pty-sidecar-entry.ts` |

## 4. Inbox

### Data

One table, `inbox_items`. `project_id` null means the personal inbox.

| Column | Notes |
|---|---|
| `id`, `created_at`, `updated_at` | |
| `project_id` | Null: personal. Set null on project delete rather than cascade |
| `kind` | `feedback`, `request`, `resource`, `note`, `knowledge_proposal`, `answer` |
| `title`, `body`, `url` | Capped; `body` like `agent_send`'s 12,000 chars |
| `source_kind` | `user`, `agent`, `external` |
| `source_project_id`, `source_agent_id`, `source_app` | No FK cascade: the record outlives the session |
| `state` | `open`, `taken`, `done`, `dismissed` |
| `taken_by_agent_id`, `read_at` | |
| `reply_to` | The item this answers |
| `payload` | JSON, for a proposal's target and new text |

Retention: closed items kept 90 days, unlike `messages`, which grows forever.

### Lifecycle

`open` → `taken` → `done`, or `dismissed` from either. `answered` is not a state: an answer is a new item in the sender's inbox with `reply_to`, so a sender whose session is long gone still gets it, and the thread is a chain of items. Read state is apart from `state`, as in T220.

Who closes: a person, or a write-mode session of the target project. The sender never can. A session that dies while holding an item returns it to `open`.

### MCP tools

| Tool | Modes | Notes |
|---|---|---|
| `inbox_post` | All | Target: `project` by name or id, or `personal`. Rate limited as `agent_send` |
| `inbox_list` | All | Own project by default; `state`, `kind` filters |
| `inbox_get` | All | Full item, body marked as data |
| `inbox_take` | Write | Claims one, compare-and-swap |
| `inbox_close` | Write | `done` or `dismissed`, optional answer |

### How it is noticed

Nothing is pasted into a session. That is the whole point.
- A count on the project's sidebar card and a new sidebar view or Project section. No amber dot: this is "look when free", like Unread.
- One line at spawn and resume: "3 open inbox items, see `inbox_list`". Counts only, never content, so a posted text cannot become a prompt.
- Company's Can wait card counts them.

Live delivery stays with `agent_send`. A sender wanting a reply now uses that; a sender that wants it to wait uses the inbox.

### Why not PRs

A PR carries a change but no conversation between agents, needs a repo with a remote, and cannot hold a resource or a question. An item can point at a PR through `url`.

### Worked example

1. A session on a landing finds a bug in the blueprint it was built from and calls `inbox_post(project: "blueprint", kind: "feedback", ...)`.
2. Nothing happens in any blueprint terminal. The project's card shows 1.
3. Antonio opens the blueprint, reads it, and either opens a session on it or sends it to a live one, which calls `inbox_take`.
4. The session fixes it and calls `inbox_close(done, answer: "fixed in #12")`.
5. The answer lands in the landing's inbox, even if the first session ended.

## 5. Knowledge

### Two stores, two jobs

The complaint is that knowledge stays local to Exegol. The cause is that one store does two jobs.

| | Memory | Knowledge |
|---|---|---|
| Content | Short facts agents notice | Curated: brief, decisions, how things work, resources |
| Noise | High, ranked by salience | Low, reviewed |
| Lives in | DB, local | Files, shared by git |
| Who writes | Agents, freely | People, and agents through a proposal |
| Reaches a plain CLI | No | Yes, by reading files |

Making files hold everything fails: a `memory_save` would dirty the checkout from any session and fill the repo with noise. Making the DB hold everything keeps the complaint. So both stay, and promotion joins them.

### Shape

```
<project>/.exegol/knowledge/
  PROJECT.md        brief, as today
  DIGEST.md         trs, gitignored, as today
  entries/<slug>.md one fact per file, frontmatter, merges cleanly in git
~/.exegol/knowledge/
  entries/<slug>.md personal: libraries, skills, references
```

One file per entry because a shared generated `MEMORY.md` conflicts on every merge. The DB holds an FTS index over entries, rebuilt from files, never the source. `MEMORY.md` and its manual bridge retire once promotion exists. The same shape in the personal folder lets it become a git repo later with no change.

### Tools

| Tool | Modes | Notes |
|---|---|---|
| `knowledge_get` | All | Add entries, and read from the agent's worktree |
| `knowledge_search` | All | `scope: project`, `personal`, `group`, or a named project under the read policy below |
| `knowledge_propose` | All | Creates a `knowledge_proposal` item, even in read mode: it changes nothing until accepted |

Accepting a proposal writes the file in the project root. Nothing runs `git add`: it appears as a change for the person to commit. An optional per-project setting lets write-mode agents write entries directly, off by default.

Reading across projects: same group by default, plus projects named in a project's settings. Otherwise a client's project could be read by an agent in an unrelated one. `DIGEST.md` stays per project, and trs keeps owning digests: Exegol adds no second index of code.

## 6. Ways in from outside

Facts: no HTTP server, no share extension, no dock drop. `exegol://open` is the only route and carries no content. Every MCP identity is an agent. The shipped `exegol` is a shell opener; `packages/cli` is private and not packaged.

| Way in | Effort | Reach | Notes |
|---|---|---|---|
| In-app capture: hotkey, tray, drop on the window | Small | Local | Takes the clipboard or a dropped link |
| `exegol://inbox?url=&title=&project=` | Small | Local, any browser, macOS Shortcuts, Linux `.desktop` | **Any web page can open a link, so it only opens a filled dialog that a person confirms. It never writes alone** |
| `exegol inbox add` | Small | Local scripts | Through the local API below |
| Local API with app tokens | Medium | Local apps | Same socket, new identity kind `app` |
| macOS Services menu or Share extension | Unknown | Local | Share needs a signed app extension in an Electron bundle, not verified. Windows Share needs MSIX and we ship NSIS |
| Remote, from a phone | Large | Anywhere | See below |

### Local API

Extend the MCP socket with a caller kind beyond agents: `app`, with a token created in Settings, named, revocable, shown once, stored hashed, allowed `inbox_post` only. No read: an app that can post learns nothing. Items are marked `source_kind: external` and the app's name shows.

No localhost HTTP in the first version. A browser extension would need it, and it brings DNS rebinding and CSRF to a machine running agents. The deep link covers browsers.

### What a tweet needs

An item stores the URL and title, nothing fetched. Fetching on capture would mean requests with no one watching, and X usually returns a login wall. A session asked to read it does so with its own tools, treating the content as untrusted.

From a phone needs something always on, because Exegol is a desktop app with no public address. Orbital is the natural candidate: its node already keeps notes per project or global and has a human inputs queue, "never in a repo". Exegol could poll a remote queue and turn entries into items. A relay of our own is a service to run, and Twitter's own bookmarks through an API is a dependency. Only decide this after the local version proves useful.

## 7. Orbital

No code links them today. From its tool descriptions: `orbital_memory` holds notes per project or global, `orbital_inputs` holds a manager's asks to people. That overlaps in name, not role: Orbital serves a manager running tasks on a node, Exegol serves a person at a desktop with live sessions. Recommendation: Exegol keeps its local inbox and knowledge and can work offline, and Orbital is a later source for remote items. Its code was not read for this document.

## 8. Security

An item is text from another agent or the internet that a privileged agent will read, so this is the main risk.

- Bodies and URLs are data: `inbox_get` returns them under a marker like `untrusted_page_content`, with the sender shown. `DATA_NOTE`, a single sentence with no delimiter, is too weak here.
- Nothing is auto-run. A person or a session's explicit `inbox_take` starts work.
- Accepting a proposal shows the diff, because an accepted entry reaches future agents as trusted context. This is the path a planted instruction would take.
- External items cannot be proposals, so an outside app cannot write to knowledge by one click.
- Rate limits per sender, per project and per app token.
- Content never reaches logs or bug reports. Log ids, kinds and sources.
- Entry slugs are checked against traversal; file writes stay under the knowledge folder.

## 9. Decisions for Antonio

1. **Files for curated knowledge, DB for memory?** Recommended. The alternative, DB only with auto-export, is smaller but keeps the complaint.
2. **Agents propose rather than write?** Recommended, with direct writes as an opt-in per project.
3. **Who reads another project's knowledge?** Recommended: same group, plus named projects. Open to all of a user's projects is simpler but mixes clients.
4. **Who may post into a project's inbox?** Recommended: any local agent, since items only wait. Stricter: the same rule as 3.
5. **Personal knowledge in `~/.exegol/knowledge`?** Recommended, or a folder you pick, so it can live in a repo or a synced drive.
6. **Is capture from the phone needed soon?** It decides whether Orbital enters early.

## 10. Plan

One PR per step. Each is useful alone.

| Step | Content | Estimate |
|---|---|---|
| 0 | The fixes in section 3 | 2-3 days |
| 1 | `inbox_items`, MCP tools, sidebar view, spawn line | 1 week |
| 2 | Capture in the app and the confirming deep link | 2-3 days |
| 3 | Entries, index, `knowledge_search`, `knowledge_propose`, accept with a diff | 1-2 weeks |
| 4 | Personal knowledge and cross-project reads | 3-5 days |
| 5 | App tokens and `exegol inbox add` | 3-5 days |
| 6 | Native share and remote, after a decision | Unknown |

Step 0 and step 1 can start without any decision above except 4.
