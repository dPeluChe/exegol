# Remote workers in sandboxes: research (2026-11-20)

Feeds T229. Nothing here is decided or built. Antonio's position when this was written: the idea is
interesting, but as it stands it would add work and a dependency without a clear gain in quality or
speed. This document keeps what was found so the question can be reopened with a clearer idea of
the benefit.

Prices and features were read on the vendors' own pages on 2026-11-20 by three web sweeps. They
move fast (two products in this space closed during 2026, see the end). Hourly figures are
computed from published unit rates for 4 vCPU and 8 GB. "360 h" is the reference load: 3 workers,
4 hours a day, 30 days. Nothing was run or signed up for.

## The idea

A worker is a session given one task from the backlog. It works in a sandbox outside the
developer's machine, opens a PR, and the sandbox is destroyed when the PR merges. The project's
main session, local, reviews and integrates the PRs and prepares the release.

What would make it different from the harnesses that already do this on their own (Claude Code
cloud sessions, Codex cloud, Cursor background agents, Devin): the person can enter each worker's
terminal and ask for more before the PR closes.

## The problem it answers

Local worktrees share one machine:

- Disk: each worktree with its dependencies is large (about 1.2 GB in this repo).
- Interference: a migration, a dependency upgrade or a service on a port affects every session
  working there. A worktree isolates files under git, not the machine.
- Cleanup: temporary files and caches stay until someone removes them.

A sandbox removes the interference, which a worktree cannot do. Disk alone has cheaper local
answers (see "Local alternatives").

## What Exegol would need

A terminal pane can run the provider's console command (`ssh` or its CLI), with the agent CLI
running on the remote. No remote daemon is required for a first version.

Keeps working: the live terminal, session status reported through the terminal stream (OSC),
follow-ups typed into the pane.

Lost without more work, because they are local:

- Exegol's MCP tools inside the worker (agent messages, inbox, notes, agent browser).
- The Company chat, which reads the CLI's transcript from the local disk.
- The Files and Git panes over that work.
- The browser pane on the worker's dev server (it would need the sandbox's public URL).

Antonio accepted a first version without chat or inbox: a worker is assigned, works alone and
sends its PR. A local webhook between Exegol and the sandbox could come later.

What would decide whether it works well:

1. How the task is handed over. With no inbox, the whole brief travels in the first prompt plus
   what the repo already holds (`AGENTS.md`, `CLAUDE.md`, the board).
2. How Exegol learns it is done. The PR is the signal: PR watch already polls `gh`.
3. Git access limited to one repo with a short-lived token made on the developer's machine per
   worker (a GitHub App installation token), never the person's full credential in the sandbox.
4. Nothing left running. Destroy on merge, and warn about sandboxes idle for long.

## Limits found

- Sandboxes are Linux. Lint, typecheck and tests run; a macOS build, signing or a DMG do not. For
  Exegol itself a remote worker could prepare a PR but not validate it the way it is validated
  today. Web projects have no such limit.
- Agent login. Claude Code: `claude setup-token` gives a one-year token for
  `CLAUDE_CODE_OAUTH_TOKEN` on a paid plan, which "can only make model requests". Anthropic's terms
  allow the person's own use and forbid a product from routing requests through, collecting or
  relaying subscription credentials on behalf of its users. So the person places the token in their
  own provider account; Exegol must never hold or relay it. Whether several workers in parallel on
  one subscription count as "ordinary, individual usage" was not confirmed. Codex:
  `codex login --device-auth`; an API key is what OpenAI recommends for programmatic use, billed
  at API rates.
- No published numbers for keystroke latency of a terminal over these services.
- Dev servers need the provider's URL or a tunnel, not localhost.

## How Orca does it (read in its code, MIT)

`stablyai/orca` at `80bb651702`. It integrates no sandbox provider. Three remote modes:

- SSH host: on first connect it installs its own daemon (`orcad`) on the host
  (`src/main/managed-server/install/`). Terminals and agents run there; the client reaches it
  through an SSH port forward.
- Paired server: `orca serve` on a machine of the person's, paired with a code and an end to end
  key. Its docs say to use a LAN or Tailscale, not a public port.
- A VM per workspace: shell scripts written by the user and declared in `orca.yaml`
  (`environmentRecipes`: `create`, `suspend`, `resume`, `destroy`,
  `src/main/environment-providers/shell-recipe-driver.ts`). `create` prints JSON with SSH details
  or a pairing code. A rejected result runs `destroy`. No idle teardown exists
  (`idleStopMs: null`). Its guide has an agent build a base snapshot and a second one with the
  agent CLI logged in.

Degraded over a remote there: chat, local attachments, the folder picker, browser panes on a
server-only install.

The lesson: a recipe per project (create, enter, destroy) ties the app to no provider.

## Hosted providers

Best fits for an evaluation, across the three sweeps:

| Provider | Per hour | 360 h | Minimum | Free | Access | Notes |
|---|---|---|---|---|---|---|
| boat.dev | $0.036 | about $13, billed as $20 | $20/month | 7-day trial, card | `boat ssh` | Full VM, Claude Code and Codex preinstalled, stopped is free |
| Shellbox | $0.04 | about $14 | none, $10 top-up | none | plain SSH | Firecracker; the SSH key is the account; one region, no backups |
| Fly Sprites | billed on use | about $21 | none | $1 trial | console, exec | No compute charge idle; pauses about 30 s after going quiet |
| Daytona | $0.33 | about $119 | none | $200 credit (about 600 h) | SSH, PTY API | Self-host option; idle stop needs configuring |
| Novita | $0.23 | about $84 | none | $100 after a survey | not checked | Credit may expire |
| Upstash Box | $0.20 per active CPU-hour | about $10 to $20 (estimate) | none | 5 CPU-h a month, recurring | SSH, PTY | Container, not a microVM; built-in Claude Code and git to PR |
| Hetzner (plain VPS) | EUR 0.0144 | about EUR 5 if deleted after use | none | none | root SSH | Bills until deleted; no per-worker isolation by itself |
| Agent37 | about $0.012 | about $4 | none | $5 credit, card | API and HTTPS; SSH not confirmed | gVisor, not a VM |
| machine0 | $0.104 | about $37 | $5 top-up | none seen | SSH | A stopped VM bills in full |
| Vers | $0.24 | about $86 | none | $55 in credits | SSH | Firecracker with VM branching |

Also priced, less suited: E2B (1 h sessions on the free plan, 24 h needs $150/month), Modal (no
pause, 5 minute default lifetime), Vercel Sandbox, Blaxel, Morph, Freestyle, Cloudflare
Containers, Northflank, GitHub Codespaces, Fly Machines, Hopx ($200 credit, shell access not
confirmed), exe.dev ($15/month minimum), Beam ($20/month plan), Tensorlake, Docker Cloud
Sandboxes (needs a subscription), Superserve, Namespace, Together Code Sandbox, Tenki, InstaVM,
Islo, Aether, boxes.dev, Orgo.

Do not fit: Depot and Railway (price), Koyeb (paid plan, exec only), Kernel (browsers), AWS
AgentCore and Azure dynamic sessions (no shell), Agentuity, Ona (contact sales), and the vendors'
own runners (no sandbox cost, but their chat UI and no terminal the app owns).

Abstractions over several providers: ComputeSDK (one router, 26 providers in its benchmark),
Rivet Sandbox Agent SDK (a server inside the sandbox that unifies Claude Code, Codex and others
over HTTP; it would answer "talk to the worker through an API, not only a terminal").

## Open source and self-hosted managers

Antonio already runs an image-based setup for parallel agents in another project. Whether that
setup is enough, or has something to learn from these, is part of the open question; it was not
reviewed here.

The three to study first:

- `open-inspect/background-agents` (MIT): a full control plane from session to sandbox to PR.
- `smol-machines/smolvm` (Apache-2.0): branchable microVMs, network closed by default, brokered
  secrets.
- `madarco/agentbox` (MIT): parallel agents in VMs, local or cloud.

Others seen: Docker Sandboxes local (`sbx`, free, a microVM per sandbox), microsandbox
(Apache-2.0), OpenSandbox (Docker or Kubernetes, Claude Code and Codex examples), Apple
`container` (Apple silicon, macOS 26), Arrakis (Linux and KVM, AGPL), Coder (heaviest setup),
boxlite, gondolin (egress control plane), `kubernetes-sigs/agent-sandbox`, coi (Incus), brig,
matchlock, k7, amika, `dagger/container-use` (last release 2025-08).

## Local alternatives

OS-level sandboxes on the developer's machine, no VM: `anthropics/sandbox-runtime` (Seatbelt on
macOS, bubblewrap on Linux, a proxy allowlist), nono, agent-safehouse, fence, landrun, sandvault.
They limit the files and network an agent touches. They do not remove shared disk and
dependencies, but they keep a worker from breaking things outside its folder, and macOS builds
still work.

## Not verified

- Reliability: no status history was read for any vendor.
- Several comparisons are written by vendors that rank themselves first.
- boat.dev looks like the renamed "Box by ascii.dev" (inferred from the page author).
- Agent37's SSH access; Shellbox's rendered price table; whether Tenki or Islo need a card;
  the Aether and boxes.dev prices (their pricing pages returned errors).
- Runloop was reported as winding down by a competitor's comparison, not by its own page.
- Not researched: Capy, Superconductor, Cased, Warp Oz, Jules, Cursor cloud, Lightning AI, GKE and
  Cloud Run sandboxes, Val Town, Nitric.
- Closed during 2026: Terragon (2026-02-09) and Conductor's cloud (reported 2026-11-20).

## Questions to answer before building anything

1. What does a remote worker give that a local session with its own worktree does not, measured:
   tasks finished per day, review time on the main session, machine load?
2. Is the cost of the main session reviewing PRs it did not write lower than doing the task
   locally?
3. Is the existing image-based setup of the other project enough, with a terminal to enter?
4. Is an OS-level local sandbox plus worktree cleanup enough for the interference problem?
5. Which projects qualify (web, Linux toolchains) and which never will (macOS builds)?

A cheap way to find out, with no code in Exegol: one sandbox, one real task of a web project,
opened from an Exegol terminal, through to the PR.
